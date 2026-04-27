# INSTRUCTIONS_DAILY_CHALLENGE.md

## Task

Implement a real daily challenge system. The `home-daily-challenge` card on HomeScreen is currently hardcoded and tapping it does nothing. Make it functional end-to-end: a server-side challenge record that resets at midnight UTC, a real countdown, completion tracking per user, and a working Play button that marks the challenge done after 10 questions.

---

## Verifiable Objective

- [ ] Migration `supabase/migrations/20240102000000_daily_challenge.sql` exists and applies cleanly via `supabase db reset`
- [ ] Edge Function `supabase/functions/daily-challenge/index.ts` exists and returns today's challenge + completion status for the authenticated user
- [ ] `mobile/lib/api.ts` exports `fetchDailyChallenge()` and `saveDailyChallengeCompletion()`
- [ ] HomeScreen `home-daily-challenge` card shows real countdown to midnight UTC (not hardcoded "14h 22m")
- [ ] Tapping the card when not completed navigates to `/question` with `category` and `challengeId` params
- [ ] Tapping the card when already completed does nothing
- [ ] After completing all 10 questions, `saveDailyChallengeCompletion()` is called (non-blocking, silent fail)
- [ ] Card shows "Completed ✓" after the user finishes the challenge — persists across app restarts (stored in Supabase, not local state)
- [ ] ResultScreen shows "Daily Challenge" label in the detail line when navigated from a challenge
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] All 15 existing Maestro tests still pass — `./run_tests.sh`
- [ ] `TRIVOLTA_TRACKER.md` updated — Daily challenge items marked ✅
- [ ] `INSTRUCTIONS_DAILY_CHALLENGE.md` added to INSTRUCTIONS Files Written in tracker

---

## Constraints

- Do NOT change any existing testID — `home-daily-challenge`, `question-screen`, `results-screen`, and all others used by tests 01–15 must remain exactly as-is
- Do NOT create a new AI/Anthropic Edge Function — daily challenge uses the existing `solo-question` function for question generation (questions are generated per-question on the fly, not pre-generated)
- The Anthropic API key must not appear in any mobile file — all AI calls go through Edge Functions only
- `fetchDailyChallenge()` must be called once on HomeScreen mount, not on every render
- Completion state must be stored in Supabase — not AsyncStorage or local state — so it persists across sessions
- Daily challenge date key is the UTC date string `YYYY-MM-DD` — use `new Date().toISOString().slice(0, 10)`
- Category for v1 is hardcoded to `'Mixed trivia'` — no randomisation needed yet
- The `daily-challenge` Edge Function must use the service role key to upsert the challenge row (bypasses RLS), and the user's JWT to check completion (respects RLS)
- `saveDailyChallengeCompletion()` must silently ignore a duplicate key error — user can only complete once per day, enforced by primary key
- Do NOT modify any existing screen's layout or styles beyond the minimal changes specified in Steps

---

## Steps

### Step 1 — Write database migration

File: `supabase/migrations/20240102000000_daily_challenge.sql`

Create two tables:

**`public.daily_challenges`** — one row per UTC date
- `id` uuid primary key
- `challenge_date` date unique not null — e.g. `'2025-01-15'`
- `category` text not null default `'Mixed trivia'`
- `created_at` timestamptz default now()

**`public.daily_challenge_completions`** — one row per (challenge, user) pair
- `challenge_id` uuid references `daily_challenges(id)` on delete cascade
- `user_id` uuid references `profiles(id)` on delete cascade
- `score` integer not null
- `correct_count` integer not null
- `total_questions` integer not null
- `best_streak` integer not null
- `completed_at` timestamptz default now()
- primary key (`challenge_id`, `user_id`)

Enable RLS on both tables.

RLS policies:
- `daily_challenges`: SELECT for authenticated users only. No INSERT for authenticated users — the Edge Function uses service role.
- `daily_challenge_completions`: SELECT for own rows (`auth.uid() = user_id`). INSERT for own rows (`auth.uid() = user_id`).

Apply: `supabase db reset`

### Step 2 — Write Edge Function `daily-challenge`

File: `supabase/functions/daily-challenge/index.ts`

Behaviour:
1. Accept POST (body ignored — `callFunction` in api.ts always uses POST)
2. Compute today's UTC date string (`YYYY-MM-DD`)
3. Using the **service role client**: upsert a row in `daily_challenges` for today's date (idempotent — `onConflict: 'challenge_date'`), then select it back
4. Using the **user JWT client** (from `Authorization` header): query `daily_challenge_completions` for the returned challenge id and the current user (`maybeSingle()`)
5. Return JSON: `{ id, date, category, completed: boolean, completionScore: number | null }`
6. On any error return 503 with `{ error: string }`

Follow the same CORS header pattern as the existing Edge Functions.

### Step 3 — Add API functions to `mobile/lib/api.ts`

Add at the end of the file:

**`fetchDailyChallenge()`** — calls the `daily-challenge` Edge Function via the existing `callFunction` helper. Returns the JSON response typed as `DailyChallenge`, or `null` on any failure (try/catch, never throw).

**`saveDailyChallengeCompletion(challengeId, score, correctCount, totalQuestions, bestStreak)`** — inserts a row into `daily_challenge_completions` via the Supabase client directly (not an Edge Function). Gets `user_id` from `supabase.auth.getSession()`. Silently ignores any error (including duplicate key `23505`).

**`DailyChallenge` type:**
```
id: string
date: string          // 'YYYY-MM-DD'
category: string
completed: boolean
completionScore: number | null
```

Export the type. Add it to `mobile/lib/types.ts` if a types file is the right place — otherwise export from `api.ts`.

### Step 4 — Update HomeScreen (`mobile/app/(tabs)/index.tsx`)

Add `useState` and `useEffect` imports if not already present.

Add state: `dailyChallenge: DailyChallenge | null`, initialised to `null`. Fetch on mount via `fetchDailyChallenge()`.

Add a pure function `timeUntilMidnightUTC(): string` that computes hours and minutes until the next UTC midnight and returns a string like `"14h 22m"`.

Update the `home-daily-challenge` card:
- Title: `dailyChallenge?.category ?? 'Mixed trivia'`
- Subtitle: `'10 questions · Ends in ' + timeUntilMidnightUTC()`
- Play button: shows "Completed ✓" when `dailyChallenge?.completed === true`; shows "Play →" otherwise
- `onPress`: if `completed` or `dailyChallenge` is null, do nothing; otherwise navigate to `/question` with params `{ category: dailyChallenge.category, challengeId: dailyChallenge.id }`
- `activeOpacity`: `1` when completed (no press feedback), `0.85` otherwise

The `home-daily-challenge` testID must remain on the outermost `TouchableOpacity` — do not move it.

### Step 5 — Update QuestionScreen (`mobile/app/question.tsx`)

Add `challengeId?: string` to the `useLocalSearchParams` destructure.

Add `saveDailyChallengeCompletion` to the import from `../lib/api`.

In `handleNext`, in the branch where `questionNum >= TOTAL_QUESTIONS` (after `saveScore` is called, before `router.replace`): if `challengeId` is present, call `saveDailyChallengeCompletion(challengeId, ...)` non-blocking (`.catch(() => {})`).

Pass `isChallenge: challengeId ? '1' : '0'` as an additional param in the `router.replace` to `/results`.

No testID changes. No layout changes.

### Step 6 — Update ResultScreen (`mobile/app/results.tsx`)

Add `isChallenge?: string` to the `useLocalSearchParams` destructure.

In the `detail` text line, prepend `'🏅 Daily Challenge · '` when `isChallenge === '1'`.

No testID changes. No layout changes.

### Step 7 — Update `TRIVOLTA_TRACKER.md`

Mark the following as ✅:
- "Daily Challenge — real implementation (not just a card)"
- "Daily challenge logic (server-side, resets at midnight)"

Add `INSTRUCTIONS_DAILY_CHALLENGE.md` to the INSTRUCTIONS Files Written section.

---

## Verification

```bash
# 1. Apply migration
cd /Users/mizzy/Developer/Trivolta && supabase db reset

# 2. TypeScript check
cd mobile && npx tsc --noEmit

# 3. Full Maestro suite
./run_tests.sh

# 4. Manual check in simulator
# - Sign in → HomeScreen shows real countdown (changes each second is fine, or static on mount)
# - Tap daily challenge card → question screen loads with category "Mixed trivia"
# - Complete all 10 questions → results screen shows "🏅 Daily Challenge" in detail line
# - Return to HomeScreen → card shows "Completed ✓"
# - Tap card again → nothing happens

# 5. Diff for Mac Claude review
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each step individually. Do not report done until all 15 Maestro tests pass and manual steps are confirmed. Do not commit — Mac Claude reviews the diff first.
