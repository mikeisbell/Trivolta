# INSTRUCTIONS_BUG_FIXES.md

## Task

Fix all issues identified in TRIVOLTA_CODE_REVIEW.md before beta. This covers all Critical, High, Medium, and Low severity items. Fixes are grouped into logical steps to minimise the number of files touched per step. All 25 existing Maestro tests must pass after every step.

---

## Verifiable Objective

**Critical / High**
- [ ] `solo-question` and `generate-questions` Edge Functions validate the `Authorization` header and return 401 if missing or invalid — no unauthenticated Anthropic calls possible
- [ ] `generate-questions` runs all 10 Anthropic calls in parallel — lobby start time measured below 15 seconds in manual test
- [ ] `fetchLobbyPlayers` uses `.order('joined_at', { ascending: true })` — host is always first row
- [ ] `createGameSession` no longer uses client wall-clock — uses a Supabase RPC `create_game_session(lobby_id, question_index)` that inserts with `starts_at = now() + interval '2 seconds'`
- [ ] Lobby ranking uses computed score (time bonus + streak) not just correct count — `lobby_answers` stores `score integer` column; `fetchLobbyResults` ranks by `score` descending
- [ ] `lobby/game.tsx` "Failed to load question" state has a retry button — tapping it calls `loadQuestion(questionIndex)` again

**Medium**
- [ ] `fetchUserStats` runs its three Supabase queries with `Promise.all`
- [ ] `fetchLeaderboard` uses an RPC `get_leaderboard(period text)` instead of fetching all score rows in JS
- [ ] `lobby_questions` RLS restricted to lobby members only
- [ ] `lobby_answers` RLS restricted to lobby members only
- [ ] `calcScore` extracted to `mobile/lib/scoring.ts` and imported in both `question.tsx` and `lobby/game.tsx`
- [ ] Deep-link params `lobbyId` validated as UUID before Supabase queries in `lobby/waiting.tsx` and `lobby/game.tsx`
- [ ] `lobby/game.tsx` `finishLobbyGame` called only by host — already the case; verify and add a guard
- [ ] Dead ternary in `question.tsx` `handleNext` fixed: `correctCount + (answerState === 'correct' ? 0 : 0)` → just `correctCount`
- [ ] `mobile/app/(tabs)/profile.tsx` rank check uses `stats?.rank != null` not `stats?.rank`
- [ ] Dead refs `playersChannelRef` and `lobbyChannelRef` removed from `lobby/waiting.tsx`
- [ ] Stale npm test scripts removed from `mobile/package.json`

**Low (selected — skip trivial style-only items)**
- [ ] Error responses in all Edge Functions include `'Content-Type': 'application/json'` header
- [ ] `submitLobbyAnswer` duplicate check uses `error.code === '23505'` instead of `includes`

**Database**
- [ ] Migration `supabase/migrations/20240105000000_bug_fixes.sql` applies cleanly — contains: `create_game_session` RPC, `score` column on `lobby_answers`, tightened RLS on `lobby_questions` and `lobby_answers`, indexes on `scores(user_id)`, `scores(played_at desc)`, `lobby_players(lobby_id, joined_at)`, `get_leaderboard` RPC
- [ ] `supabase db reset` completes without errors

**Testing**
- [ ] All 25 existing Maestro tests pass after all changes — `./run_tests.sh`
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `TRIVOLTA_TRACKER.md` updated — Phase 2.5 code review items marked ✅
- [ ] `INSTRUCTIONS_BUG_FIXES.md` added to INSTRUCTIONS Files Written in tracker

---

## Constraints

- Do NOT change any testID used by tests 01–26
- Do NOT change the `calcScore` formula — only move it to a shared file
- The `create_game_session` RPC must use `now() + interval '2 seconds'` for `starts_at` — preserve the 2-second buffer
- `generate-questions` parallelism: all 10 `Promise.all` calls must still insert with sequential `question_index` 0–9 — the index assignment happens after all results are received, not per-call
- The `score` column added to `lobby_answers` must have a default of `0` so existing rows (from seeded tests) are not broken
- Tightened RLS on `lobby_questions` and `lobby_answers` must still allow the Maestro test service role key to read/write — service role bypasses RLS so no change needed for scripts
- The `get_leaderboard` RPC must accept `period text` ('alltime', 'week', 'month') and return the same shape as the current JS implementation: `id, username, avatar_url, total_score, games_played, rank`
- Do NOT remove the existing `leaderboard` view — it may still be used by `fetchUserStats`
- `lobby/waiting.tsx` UUID validation: if `lobbyId` is not a valid UUID, show an error state and do not issue any Supabase queries. A simple regex check is sufficient: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
- Same UUID validation in `lobby/game.tsx`

---

## Steps

### Step 1 — Write migration `supabase/migrations/20240105000000_bug_fixes.sql`

This migration does all database changes in one file:

**1a — `create_game_session` RPC**
Create a function `public.create_game_session(p_lobby_id uuid, p_question_index integer)` that inserts into `game_sessions` with `starts_at = now() + interval '2 seconds'` and returns the inserted row's `starts_at` as `timestamptz`. Use `SECURITY DEFINER` so it runs with elevated privileges regardless of caller. Grant `EXECUTE` to `authenticated`.

**1b — `score` column on `lobby_answers`**
`ALTER TABLE public.lobby_answers ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0;`

**1c — Tighten `lobby_questions` RLS**
Drop `lobby_questions_read` policy. Replace with:
```sql
create policy "lobby_questions_members_read" on public.lobby_questions
  for select using (
    exists (
      select 1 from public.lobby_players lp
      where lp.lobby_id = lobby_questions.lobby_id
        and lp.user_id = auth.uid()
    )
  );
```

**1d — Tighten `lobby_answers` RLS**
Drop `lobby_answers_read` policy. Replace with:
```sql
create policy "lobby_answers_members_read" on public.lobby_answers
  for select using (
    exists (
      select 1 from public.lobby_players lp
      where lp.lobby_id = lobby_answers.lobby_id
        and lp.user_id = auth.uid()
    )
  );
```

**1e — Indexes**
```sql
create index if not exists scores_user_id_idx on public.scores(user_id);
create index if not exists scores_played_at_idx on public.scores(played_at desc);
create index if not exists lobby_players_joined_idx on public.lobby_players(lobby_id, joined_at);
```

**1f — `get_leaderboard` RPC**
Create a function `public.get_leaderboard(period text)` that:
- Accepts `'alltime'`, `'week'`, `'month'`
- Aggregates `scores` joined to `profiles`, filtered by `played_at` for week/month periods
- Returns a table of `(id uuid, username text, avatar_url text, total_score bigint, games_played bigint, rank bigint)`
- Uses `rank() over (order by sum(score) desc)` for ranking
- Limits to top 50
- Grant `EXECUTE` to `authenticated`

Apply: `supabase db reset`

### Step 2 — Create `mobile/lib/scoring.ts`

Extract the shared score calculation. The file exports one function:

`calcScore(timeLeft: number, streak: number, timerSeconds: number): number`

The formula is identical to the current implementations in `question.tsx` and `lobby/game.tsx`:
`Math.round(100 * (timeLeft / timerSeconds) * (1 + streak * 0.1))`

Using `timerSeconds` as a parameter (rather than importing `TIMER_SECONDS`) keeps the function pure.

### Step 3 — Update `mobile/lib/api.ts`

**3a — `fetchLobbyPlayers` ordering**
Add `.order('joined_at', { ascending: true })` to the query.

**3b — `createGameSession` → RPC**
Replace the current implementation with a call to the `create_game_session` RPC:
`supabase.rpc('create_game_session', { p_lobby_id: lobbyId, p_question_index: questionIndex })`
Remove the client-side `Date.now()` timestamp computation entirely.
Return type stays `Promise<void>` — throw on error.

**3c — `submitLobbyAnswer` — store score + fix duplicate check**
Add `score: number` parameter. Pass it to the insert: `score` field in the row.
Fix duplicate check: `error.code === '23505'` (not `includes`).
Update the call signature — callers in `lobby/game.tsx` must pass the score.

**3d — `fetchLobbyResults` — rank by score**
Change the query on `lobby_answers` to also select `score`.
Change the aggregation: sum `score` per user (not count correct answers) for ranking.
Keep `correct` and `accuracy` fields for display, but sort `rows` by `score` descending.
Update the `LobbyPlayerResult` type to add `score: number`.

**3e — `fetchUserStats` — parallel queries**
Wrap the three Supabase queries (`profiles`, `scores`, `leaderboard`) in `Promise.all`. Structure so the `scores`-dependent aggregations run after `Promise.all` resolves.

**3f — `fetchLeaderboard` — use RPC**
Replace the current implementation with:
`supabase.rpc('get_leaderboard', { period })`
Map the result rows to `LeaderboardEntry[]` with the same shape as before.
Keep the existing return type.

### Step 4 — Update `supabase/functions/solo-question/index.ts`

Add Authorization check at the top of the handler (after OPTIONS check):
- Extract `Authorization` header
- If missing, return 401 with `{ error: 'Unauthorized' }` and `Content-Type: application/json`
- Verify the JWT using the Supabase client: create a user client with the anon key + the auth header, call `supabase.auth.getUser()`, return 401 if it fails

Add `'Content-Type': 'application/json'` to the error response on the 503 path.

### Step 5 — Update `supabase/functions/generate-questions/index.ts`

**5a — Auth check**
Same pattern as Step 4 — add Authorization check before processing.

**5b — Parallel generation**
Replace the serial `for` loop with `Promise.all`:
- Build an array of 10 prompt strings
- `Promise.all` all 10 `attempt()` calls simultaneously
- After all resolve, map to `rows` with sequential `question_index` 0–9
- Insert all rows in one batch (already done this way)

Add `'Content-Type': 'application/json'` to all error responses.

### Step 6 — Update `supabase/functions/daily-challenge/index.ts`

Add `'Content-Type': 'application/json'` to the error responses (the 503 path missing it).

### Step 7 — Update `supabase/functions/create-lobby/index.ts` and `join-lobby/index.ts`

Add `'Content-Type': 'application/json'` to all error responses that are currently missing it (400, 401, 404 paths).

### Step 8 — Update `mobile/app/lobby/game.tsx`

**8a — Import `calcScore` from shared module**
Remove the local `calcScore` function. Import from `../../lib/scoring`.
Pass `TIMER_SECONDS` as the third argument.

**8b — Update `handleAnswer` to pass score to `submitLobbyAnswer`**
Compute `pts` before the `submitLobbyAnswer` call (already done for correct answers).
For incorrect answers and timeouts, pass `0`.
Update the `submitLobbyAnswer` call: `submitLobbyAnswer(lobbyId, questionIndex, index, pts)`.

**8c — Add retry button to "Failed to load question" state**
The `if (!question)` branch currently renders only an error text. Add a retry `TouchableOpacity` that calls `loadQuestion(questionIndex)`. Use `testID="lobby-game-retry"`.

**8d — UUID validation**
At the top of the component, before any hooks fire queries, check that `lobbyId` matches the UUID regex. If invalid, render an error state immediately.

### Step 9 — Update `mobile/app/lobby/waiting.tsx`

**9a — UUID validation**
Same UUID check as Step 8d. If `lobbyId` is invalid, render an error state and skip all effects.

**9b — Remove dead refs**
Remove `playersChannelRef` and `lobbyChannelRef` declarations and all assignments. The cleanup in each `useEffect` already uses the closure variable — the refs serve no purpose.

### Step 10 — Update `mobile/app/question.tsx`

**10a — Import `calcScore` from shared module**
Remove the local `calcScore` function. Import from `../lib/scoring`. Pass `TIMER_SECONDS` as the third argument.

**10b — Fix dead ternary**
Change `correctCount: correctCount + (answerState === 'correct' ? 0 : 0)` to `correctCount: correctCount`.

### Step 11 — Update `mobile/app/(tabs)/profile.tsx`

Change `if (stats?.rank)` to `if (stats?.rank != null)` on the rank display conditional.

### Step 12 — Update `mobile/package.json`

Remove the stale `test:e2e` and any other direct `maestro test` npm scripts. They bypass `run_tests.sh` and the `--shards=1` enforcement. If there are any Maestro-related scripts, replace them with `"test": "./run_tests.sh"`.

### Step 13 — Update `TRIVOLTA_TRACKER.md`

Mark Phase 2.5 items as ✅:
- Full code analysis — INSTRUCTIONS_CODE_REVIEW.md ✅
- Bug fixes from code review — INSTRUCTIONS_BUG_FIXES.md ✅

Add `INSTRUCTIONS_BUG_FIXES.md` to INSTRUCTIONS Files Written section.

---

## Verification

```bash
# 1. Apply migration
cd /Users/mizzy/Developer/Trivolta && supabase db reset

# 2. TypeScript check
cd mobile && npx tsc --noEmit

# 3. Full Maestro suite — all 25 must pass
./run_tests.sh

# 4. Manual timing check for generate-questions parallelism
# - Create a lobby via the UI
# - Start the game and time from "Start game" tap to first question appearing
# - Target: under 15 seconds (was 30–60s serial)

# 5. Manual check for lobby ranking
# - Play a lobby game as host (use deep-link / test_14 setup)
# - On results screen, verify rankings match in-game score accumulation, not just correct count

# 6. Confirm auth check on Edge Functions
# - With Supabase local running, make a curl call to solo-question without Authorization header:
#   curl -X POST http://127.0.0.1:54321/functions/v1/solo-question \
#     -H "Content-Type: application/json" -d '{"category":"science","streak":0}'
# - Should return 401, not 503 or a question

# 7. Diff for Mac Claude review
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each verification step individually. Do not report done until all 25 Maestro tests pass, TypeScript is clean, the curl returns 401, and the parallel generation timing is confirmed. Do not commit — Mac Claude reviews the diff first.
