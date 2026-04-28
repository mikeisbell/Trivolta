# Trivolta — Code Review Report

Date: 2026-04-27
Reviewer: Claude Code (Opus 4.7)
Scope: All files listed in INSTRUCTIONS_CODE_REVIEW.md (15 screens, 6 lib files, 5 Edge Functions, 4 migrations, app.json, package.json, tsconfig.json).

---

## TypeScript Check

`cd mobile && npx tsc --noEmit` exits 0 with no output. Strict mode is on (`tsconfig.json` extends `expo/tsconfig.base` + `strict: true`). No type errors at compile time. Several `as any` casts deliberately bypass the type system; these are listed in Section 1.

---

## Section 1 — TypeScript & Type Safety

### 1.1 — `as any` casts on Supabase responses [Medium]
`mobile/lib/api.ts` lines 119, 156, 196, 366, 367. `fetchLeaderboard` and `fetchLobbyPlayers`/`fetchLobbyQuestion`/`fetchLobbyResults` cast rows or joined `profiles` to `any` to handle Supabase's nested-relation return type ambiguity. The Supabase JS client returns the joined relation as either an object or array depending on the cardinality inference; without generated types, the call sites use `Array.isArray(...) ? [0]?.x : .x ?? 'Unknown'` defensively. Type safety lost at the data boundary.

### 1.2 — Realtime payload `as any` [Medium]
`mobile/app/lobby/game.tsx` line 137 — `(payload.new as any)?.question_index`.
`mobile/app/lobby/waiting.tsx` line 78 — `(payload.new as any)?.status`.
Realtime payloads have no inferred row type. Defensive optional chaining is correct, but the casts hide schema drift.

### 1.3 — Inline structural type duplicates declared type [Low]
`mobile/app/lobby/game.tsx` lines 26–32 redeclares a local `Question` type that overlaps with `LobbyQuestion` in `mobile/lib/types.ts` (lines 26–35). `mobile/lib/api.ts` line 187–197 returns the same shape with another inline literal. Three near-identical shapes in three files; one canonical type would prevent drift.

### 1.4 — Unused exported types [Low]
`mobile/lib/types.ts` exports `LobbyPlayer` (no callers), `LobbyQuestion` (declared but only inline equivalents are used), `GameSession` (only inline equivalents are used), and `Profile` (used in `UserStats` only). Dead exports.

### 1.5 — `catch (err: any)` pattern [Low]
`mobile/app/auth.tsx` line 33; `mobile/app/(tabs)/profile.tsx` line 124; `mobile/app/lobby/create.tsx` line 42; `mobile/app/lobby/waiting.tsx` line 97. Common pattern in this codebase. TS 4.4+ allows `catch (err: unknown)` with a type guard, which is safer.

---

## Section 2 — API & Data Layer

### 2.1 — `fetchLobbyPlayers` returns rows in arbitrary order [High]
`mobile/lib/api.ts` lines 146–160 has no `.order()` clause. `mobile/app/lobby/waiting.tsx` line 158 uses `index === 0` to render the "Host" badge. Postgres does not guarantee row order without `ORDER BY`. The host *usually* appears first because they were inserted first, but the API contract does not enforce this. The "Host" badge can attach to a random player at any time. Add `.order('joined_at', { ascending: true })`.

### 2.2 — `createGameSession` writes a client wall-clock timestamp [High]
`mobile/lib/api.ts` lines 214–225. `starts_at` is computed as `new Date(Date.now() + 2000).toISOString()` on the **host's device**, then inserted. `CLAUDE.md` explicitly states: *"Server-timestamp timer. Each question has a `starts_at` timestamp written by the server… Never use client clock as the source of truth for timing."* Current implementation violates this. The guest then computes `deadline = starts_at + 20s` and counts down with their own `Date.now()`, so any clock skew between host and guest (or between either device and reality) directly biases the timer.
**Fix direction**: insert with `starts_at` omitted (column has `not null` so this would error) or compute server-side via an Edge Function or RPC that uses Postgres `now()`.

### 2.3 — Lobby ranking ignores time bonus and streak [High]
`mobile/lib/api.ts` `fetchLobbyResults` (lines 322–386) ranks players purely by correct-answer count. `mobile/app/lobby/game.tsx` `calcScore` (lines 22–24) computes a points value with time-left and streak multiplier exactly like solo, but `submitLobbyAnswer` (api.ts lines 227–248) persists only `answer_index`, never the score. So a player who answers all 10 in the last second beats a player who answers all 10 in the first second only because they got the same count. The displayed "score" is per-player local state and never used for ranking.
Inconsistent with solo scoring and with user expectations from the streak pill UI.

### 2.4 — `fetchLeaderboard` fetches every score row in the period [Medium]
`mobile/lib/api.ts` lines 97–144. Selects all (`user_id`, `score`, `profiles(...)`) rows from `scores` joined to `profiles` with no limit, then groups in JS and slices to top 50. As `scores` grows past a few thousand rows, this becomes slow and bandwidth-heavy. Should use a SQL view (the `leaderboard` view exists but only covers last 30 days) parameterized by period, or an RPC.

### 2.5 — `fetchUserStats` rank uses 30-day leaderboard view but UI implies global [Medium]
`mobile/lib/api.ts` lines 78–86 reads from the `public.leaderboard` view (30-day window, top 50). `mobile/app/(tabs)/profile.tsx` line 173 displays `#{stats.rank} position` with no qualifier. Users with no scores in the last 30 days will see no rank even if they have lifetime scores; users above #50 are silently invisible.

### 2.6 — `fetchUserStats` runs three queries serially [Medium]
`mobile/lib/api.ts` lines 53–95. The `profiles` lookup, `scores` aggregation, and `leaderboard` rank lookup are sequential `await`s with no inter-dependency. `Promise.all` would cut latency roughly in third on the profile screen.

### 2.7 — `saveScore` and `saveDailyChallengeCompletion` swallow errors [Medium]
`mobile/lib/api.ts` lines 259–277 and 299–320. `saveScore` returns void with no error path; the caller in `mobile/app/question.tsx` line 131 chains `.catch(() => {})`. `saveDailyChallengeCompletion` wraps everything in `try { … } catch { /* silently ignore */ }`. A user could finish a quiz, see the results screen, and have nothing persisted — with no signal to the app or telemetry.

### 2.8 — `submitLobbyAnswer` duplicate-detection is fragile [Low]
`mobile/lib/api.ts` line 245: `if (error && !error.message.includes('duplicate') && !error.code?.includes('23505'))`. `error.code` is typed `string | undefined`; `String.prototype.includes('23505')` works, but the convention `error.code === '23505'` is clearer and matches PostgREST's documented error shape.

### 2.9 — Profile-screen rank `if (stats?.rank)` [Low]
`mobile/app/(tabs)/profile.tsx` line 172: `if (stats?.rank)` is falsy when rank is `0` (impossible for ranks but defensive readers may not know that) and when `null`. Use `stats?.rank != null`.

### 2.10 — `fetchLobbyQuestion` returns `null` with no recovery [Medium]
`mobile/lib/api.ts` lines 184–197 returns `null` on Supabase error. `mobile/app/lobby/game.tsx` lines 92–96 calls `setLoading(false)` and returns — the screen renders the "Failed to load question" empty state with no retry button. The host is stuck and the guest sees the same dead end.

---

## Section 3 — Edge Functions

### 3.1 — `solo-question` and `generate-questions` have no auth check [Critical in production]
`supabase/functions/solo-question/index.ts` line 15–17 and `supabase/functions/generate-questions/index.ts` line 10–13 both jump straight from CORS preflight to `req.json()` and call Anthropic. Neither inspects `Authorization`. The deployment guide in `TEST_PLAN.md` instructs `--no-verify-jwt`, which removes the platform-level JWT check too. Combined: anyone with the bundled anon key (or simply nobody — depends on platform config) can spam these endpoints. Each call costs Anthropic credits.
**For production**: add an `Authorization` header check identical to `create-lobby`/`join-lobby`, and serve without `--no-verify-jwt`, or accept that platform-level verify-jwt is the gate.

### 3.2 — `generate-questions` runs 10 Anthropic calls serially [High]
`supabase/functions/generate-questions/index.ts` lines 40–66. `for (let i = 0; i < 10; i++) { await anthropic.messages.create(...) }`. Each call is ~3–6 seconds; total ~30–60 s. The lobby waiting screen shows "Generating questions…" for the entire duration, blocking the host. `Promise.all` of 10 calls would complete in roughly the slowest single call, at the cost of higher peak token burst.

### 3.3 — Brittle JSON parse with single retry [Medium]
`supabase/functions/solo-question/index.ts` lines 39–51 and `generate-questions/index.ts` lines 53–66 do `try { result = await attempt() } catch { result = await attempt() }`. If the model returns markdown fences or trailing prose, `JSON.parse(text.trim())` throws. One retry; second failure returns 503. No regex extraction of a JSON block, no schema validation of the parsed object (no check that `answers` is a 4-element array, that `correct_index` is in range, etc.).

### 3.4 — Missing `Content-Type` on error responses [Low]
`supabase/functions/generate-questions/index.ts` line 17 returns 400 with `headers: corsHeaders` — no Content-Type. Same in lines of `create-lobby` (lines 20, 36) and `join-lobby` (16, 36, 50, 64). The success path adds `'Content-Type': 'application/json'` but the error path does not. Browsers may render the body as text/plain.

### 3.5 — `error: String(err)` leaks internal detail [Low]
All five Edge Functions stringify the entire error object on the failure path. Stack traces, internal table names, and SQL errors can leak to clients. Map to user-safe messages on the boundary.

### 3.6 — `daily-challenge` completion check ignores auth failure [Low]
`supabase/functions/daily-challenge/index.ts` lines 33–44. `userClient` is created with `Authorization: authHeader ?? ''`. If the header is missing, the SELECT silently fails (RLS denies an unauthenticated `auth.uid()`), `completion` is `null`, and the response reports `completed: false`. An anonymous caller appears to have never completed the challenge. Acceptable degradation but could be surfaced as a 401.

### 3.7 — `Deno.env.get('ANTHROPIC_API_KEY')` not validated [Low]
`supabase/functions/solo-question/index.ts` line 21 and `generate-questions/index.ts` line 21 pass the env value through to the Anthropic SDK without checking for undefined. The SDK will fail on the API call rather than at startup. Documented quirk in `TEST_PLAN.md`, but a startup check would be cleaner.

---

## Section 4 — React & State Management

### 4.1 — `_layout.tsx` deps include `segments` array [Low]
`mobile/app/_layout.tsx` line 18: `useEffect(() => { … }, [session, loading, segments])`. `segments` is a fresh array on each render of `useSegments()`; React compares by reference, so the effect runs every render. The body short-circuits via `loading` and segment compare, so the cost is minor, but `segments[0]` would be a more correct dep.

### 4.2 — `eslint-disable react-hooks/exhaustive-deps` in two places [Low]
`mobile/app/question.tsx` line 92 and `mobile/app/lobby/game.tsx` line 125, 148 disable the deps lint. The captured closures (`fetchQuestion`, `loadQuestion`, etc.) are screen-scoped and the deps are stable in practice (route params don't change mid-screen), but disabling the rule loses future-proofing.

### 4.3 — Dead refs in `lobby/waiting.tsx` [Low]
Lines 28–30, 64, 85: `playersChannelRef` and `lobbyChannelRef` are assigned but never read. Cleanup uses the closure variable. The refs serve no purpose.

### 4.4 — `auth.tsx` initial-load race [Low]
`mobile/lib/auth.tsx` lines 22–35: `getSession()` and `onAuthStateChange` both call `setSession`. If the auth-state subscription fires before `getSession()` resolves (e.g., right after a sign-in elsewhere), the older `getSession` result can overwrite the newer state. Eventual consistency makes this benign in practice.

### 4.5 — `question.tsx` state racing in handleTimeout [Low]
Lines 51–57: `handleTimeout` resets `streakRef.current = 0` and `setStreak(0)` without checking `answerStateRef`. If the user taps an answer at the same instant the timer fires, both `handleAnswer` and `handleTimeout` run; `handleTimeout` lacks the `answerStateRef !== 'unanswered'` guard that `lobby/game.tsx` line 63 has. Tiny window; rare.

### 4.6 — Realtime double-load race in `lobby/game.tsx` [Low]
Initial `useEffect` calls `loadQuestion(0)`. Realtime INSERT for Q0 may fire before that resolves on the host (and definitely fires for the guest). For the guest, both the initial `loadQuestion(0)` *and* the Realtime INSERT for Q0 run. The two paths converge harmlessly but redundantly.

### 4.7 — `clearSessionHistory` is module-global [Low]
`mobile/lib/gameHistory.ts` is a single mutable object shared across the app. `signOut` clears it, but on hot reload or fast user switching the state could leak. For its scope (avoid repeating the same question in one solo session) this is fine.

---

## Section 5 — Navigation & Routing

### 5.1 — `lobby-results-play-again` routes to lobby/create [Low — product]
`mobile/app/lobby/results.tsx` line 107: `router.replace('/lobby/create')`. "Play again" creates a new lobby rather than restarting with the same players. May surprise users; consistent with current data model (questions are seeded once per lobby and lobby is `finished`).

### 5.2 — `question-back` uses `router.replace('/')` [Low]
`mobile/app/question.tsx` line 196 uses `replace` not `back`. Correct for preventing back-stack pollution into a finished/abandoned game. Note the abandoned game does not save a partial score, which is intentional but undocumented.

### 5.3 — No deep-link param validation [Medium]
`mobile/app/lobby/waiting.tsx` and `lobby/game.tsx` accept `lobbyId` and `isHost` from `useLocalSearchParams()` without validation. A malformed deep link (`trivolta://lobby/waiting?lobbyId=abc`) reaches the Supabase queries unchecked; the app shows the loading state forever. Should validate UUID shape and reject early.

---

## Section 6 — Game Logic

### 6.1 — `calcScore` duplicated [Medium]
`mobile/app/question.tsx` lines 16–20 and `mobile/app/lobby/game.tsx` lines 22–24 implement the same formula. Move to `mobile/lib/scoring.ts` so changes (or a server-authoritative implementation) propagate.

### 6.2 — Pointless ternary in `question.tsx` handleNext [Low]
Line 121: `correctCount: correctCount + (answerState === 'correct' ? 0 : 0)`. Both branches add 0. Either dead code from a previous implementation or a logic bug masked by the typo. Either way, simplify to `correctCount`.

### 6.3 — Lobby uses `lobby_answers` only for binary correctness [High — see 2.3]
Already covered in Section 2.3. Listed here for the game-logic lens.

### 6.4 — Daily challenge generates a different question per user [Medium — product]
`supabase/functions/daily-challenge/index.ts` writes a `daily_challenges` row with a category but no questions. The mobile flow (`question.tsx` with `challengeId`) calls `generateSoloQuestion` per question, which is non-deterministic. Two users on the same day see different questions. A "daily challenge" pattern usually means everyone answers the same question set so leaderboards are comparable.

### 6.5 — Lobby `finishLobbyGame` only called by host [Medium]
`mobile/app/lobby/game.tsx` line 178. If the host crashes or backgrounds the app between Q10 and `handleNext`, the lobby stays `active` indefinitely. No reaper process. Guests see "Waiting for host…" forever.

---

## Section 7 — Security

### 7.1 — Auth-less Edge Functions in production [Critical depending on deploy]
See Section 3.1. With `--no-verify-jwt` (current dev setup) anyone can spam `solo-question` / `generate-questions`. Each call costs real money on Anthropic. Decide before production: (a) remove `--no-verify-jwt` and accept the platform-level JWT check, or (b) add an explicit Authorization check inside the function. Both are quick fixes; not doing either is a budget vulnerability.

### 7.2 — `lobby_questions` SELECT policy is over-broad [Medium]
`supabase/migrations/20240101000000_initial_schema.sql` line 98: `lobby_questions_read for select using (auth.role() = 'authenticated')`. Any signed-in user can read any lobby's questions, including their `correct_index`. A determined cheater could subscribe to `lobby_questions` for the lobby ID they're playing and look up the answer. Restrict to members of the lobby:
```sql
using (exists (select 1 from lobby_players lp
               where lp.lobby_id = lobby_questions.lobby_id
                 and lp.user_id = auth.uid()))
```

### 7.3 — `lobby_answers` SELECT policy is over-broad [Medium]
Same file, line 101. Reveals other players' answers in real time. Same fix pattern as 7.2.

### 7.4 — `lobbies` SELECT policy is over-broad [Low]
Line 91: any authenticated user can read every lobby row, including room codes. Codes are short (4 chars, ~1M space) so enumeration is conceivable but the join function rate-limits naturally via the lobby state check. Lower priority than 7.2 / 7.3.

### 7.5 — Edge function error messages may include stack traces [Low]
See Section 3.5.

### 7.6 — Anon key is bundled with the mobile app [Acceptable]
This is the documented Supabase pattern; RLS is the actual security boundary. No issue, but worth noting that if RLS is mis-set on any new table, anonymous reads/writes become possible.

---

## Section 8 — Redundancy & Dead Code

### 8.1 — `calcScore` duplicated across `question.tsx` and `lobby/game.tsx` [Medium]
See 6.1.

### 8.2 — `mobile/lib/types.ts` partially unused [Low]
`LobbyPlayer`, `LobbyQuestion`, `GameSession`, `Profile` (latter used only inside `UserStats`). `lobby/game.tsx` and `lib/api.ts` define equivalent inline shapes instead.

### 8.3 — Dead refs in `lobby/waiting.tsx` [Low]
See 4.3 — `playersChannelRef` / `lobbyChannelRef` written but never read.

### 8.4 — Dead ternary in `question.tsx` handleNext [Low]
See 6.2.

### 8.5 — Stale npm scripts in `package.json` [Low]
Lines 10–17 define `test:e2e` scripts that bypass `run_tests.sh`. CLAUDE.md mandates running via `run_tests.sh` to enforce `--shards=1`. Stale scripts will tempt future contributors into the parallel-execution trap that already broke tests once (see CLAUDE.md "Maestro Must Run Sequential" entry). Recommend deleting or replacing with calls to `./run_tests.sh`.

### 8.6 — Temporary client in `auth.tsx` signUp [Low]
Lines 44–48 instantiate a fresh `createClient` with the brand-new access token to upsert the profile. The global `supabase` client should already have this session via `onAuthStateChange`, but the order of effects vs. the explicit `supabase.auth.signUp` resolution is not guaranteed. The temporary client is defensive; if the global client is reliably authenticated by this point, the extra instance is redundant. Worth verifying.

### 8.7 — `tab-ranks` testID is on a hero pill [Low — testing artefact]
`mobile/app/(tabs)/index.tsx` line 86 attaches `testID="tab-ranks"` to a "Rank pts" pill that navigates to leaderboard. The actual tab also exists. Maestro tests use the pill because tab-bar taps don't always propagate (CLAUDE.md). It's a workaround, not dead code, but the dual route is confusing.

---

## Section 9 — Database & Schema

### 9.1 — No index on `scores(user_id)` or `scores(played_at)` [Medium at scale]
`fetchUserStats` filters by `user_id`; `fetchLeaderboard` filters by `played_at`. With a few thousand rows this is fine; past ~100k rows the leaderboard query starts hurting. Add `create index scores_user_id_idx on scores(user_id)` and `create index scores_played_at_idx on scores(played_at desc)`.

### 9.2 — RLS on `lobby_questions` and `lobby_answers` too broad [Medium]
Already covered in Section 7. Schema-level note: tighten the policy to lobby membership.

### 9.3 — No reaper for stuck `active` lobbies [Low]
See 6.5. A scheduled job or `lobbies.expires_at` column would clear ghosts.

### 9.4 — Migrations are forward-only with no `down` [Low]
Acceptable for current stage, but harder once production data exists.

### 9.5 — `daily_challenges` table stores no questions [Medium — see 6.4]
The challenge "is" a category and a date. Question generation is per-user at runtime. To make the daily challenge a true shared experience, generate the 10 questions server-side once per day, store them in a `daily_challenge_questions` table, and have all users answer the same set.

### 9.6 — Migration ordering depends on 02 fixing 01's gap [Acceptable but fragile]
`game_sessions` was created without an INSERT policy in `20240101…`; `20240102…` adds it. CLAUDE.md captures this as a gotcha. Future tables should ship SELECT and INSERT policies in the same migration.

### 9.7 — `lobby_players` no `.order()` index pre-set [Low]
Logical fix is at the API layer (Section 2.1) but adding `create index lobby_players_lobby_joined_idx on lobby_players(lobby_id, joined_at)` makes the order query cheap.

---

## Section 10 — Summary

### Issue counts by severity
| Severity | Count |
|----------|-------|
| Critical | 1 (depends on deploy config: 7.1) |
| High     | 4 (2.1, 2.2, 2.3, 3.2) |
| Medium   | 14 (1.1, 1.2, 2.4, 2.5, 2.6, 2.7, 2.10, 3.3, 5.3, 6.1, 6.4, 6.5, 7.2, 7.3, 8.1, 9.1, 9.2, 9.5) |
| Low      | 19 (the remainder) |

(Some items appear under multiple sections; counts above use the primary listing.)

### Top 5 issues to fix before beta

1. **Lobby ranking ignores time/streak score (2.3, 6.3)** — Players get the streak fire pill and watch their score go up during a lobby game, then the results screen sorts purely by correct count. The displayed scoreboard does not match the in-game promise. Persist a computed score in `lobby_answers` (or store time-to-answer + streak-at-answer and compute server-side) and rank by it.

2. **Server-timestamp timer rule violated (2.2)** — Per CLAUDE.md the lobby timer should not depend on client clocks, but `createGameSession` writes a host-clock timestamp. Move the insert to an Edge Function that uses the database `now()`, or have the client insert with `starts_at` defaulted at the database (column would need a default and the explicit value removed).

3. **Auth-less Edge Functions (3.1, 7.1)** — Before turning on a production project, add an Authorization check to `solo-question` and `generate-questions`, or remove `--no-verify-jwt` from the deploy. Without one of these, anonymous Anthropic spam is open.

4. **Host badge attached to arbitrary player (2.1)** — `fetchLobbyPlayers` returns rows in undefined order; the UI uses `index === 0` as the host indicator. Add `.order('joined_at')` and the test that proves it.

5. **`generate-questions` serial loop (3.2)** — 30–60 second wait at the start of every lobby game. `Promise.all` parallelises with no behavioural change.

### Secondary recommendations

- Tighten `lobby_questions` / `lobby_answers` RLS to lobby membership (7.2, 7.3).
- Move `calcScore` to a shared module and replace the two copies (6.1).
- Persist the daily challenge as a shared question set, not a per-user generation (6.4, 9.5).
- Add a retry button to `lobby/game.tsx`'s "failed to load question" state (2.10).
- Remove `as any` casts in `lib/api.ts` by generating Supabase types (`supabase gen types typescript`).
- Add indexes on `scores(user_id)`, `scores(played_at)`, `lobby_players(lobby_id, joined_at)` (9.1, 9.7).
- Validate deep-link UUIDs before issuing Supabase queries (5.3).
- Surface (don't swallow) score-save failures so beta testers can tell us when it breaks (2.7).

### Overall assessment

The codebase is in solid shape for an early beta — TypeScript strict mode passes, all 25 Maestro tests pass, the architecture (mobile + Supabase + Edge Functions) is appropriate for the product. The Phase 1 features map cleanly to the screens, and the lobby flow works end-to-end with realtime sync.

Two structural issues stand out and should be fixed before beta testers see the app: the lobby ranking inconsistency (item #1 above) is a credibility hit because the game tells you one thing and the scoreboard tells you another; and the server-timestamp rule violation (item #2) is the kind of bug that produces "the timer ran out at 14 seconds for me" reports and is then very expensive to debug. The auth-less Edge Functions (item #3) is not user-visible but is a budget risk on day one of any production deployment.

Most other issues are pre-scale concerns (indexes, sequential queries) or test/dev-quality issues (dead code, types). They're worth a cleanup pass but none of them block beta.
