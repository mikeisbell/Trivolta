# Trivolta — Claude Code Context

## What This App Is

Mobile trivia app for iOS and Android. Two modes: solo play and synchronous lobby play (up to 8 players). AI generates questions via the Anthropic API — no static question bank.

**Stack:** React Native (Expo), TypeScript, Supabase (auth + Postgres + Realtime + Edge Functions), AdMob (rewarded ads). TypeScript only — no Python, no separate backend server.

---

## API Key Rule

The mobile app never calls the Anthropic API directly. All AI calls go through Supabase Edge Functions. The Anthropic API key is stored as a Supabase secret — never in the mobile bundle, never in `.env` on the client side.

---

## Answer Shuffle Rule

Answers arrive pre-shuffled from the backend. `correct_index` reflects post-shuffle position. The mobile layer must not re-shuffle — doing so invalidates `correct_index` silently.

---

## Rewarded Ads Only

No interstitials, no banners. Do not add non-rewarded ad placements without an explicit product decision recorded in git.

---

## Lobby Game Rules

**Questions generated before game start — never during.** When a lobby host starts a game, the `generate-questions` Edge Function is called once, generates all 10 questions, and writes them to `lobby_questions`. No question generation happens mid-game.

**Server-timestamp timer.** Each question has a `starts_at` timestamp written by the server to `game_sessions` via the `create_game_session` RPC. Clients calculate `starts_at + 20 seconds = timer_end` and count down locally. Never use client clock as the source of truth for timing. The RPC uses Postgres `now()` — never compute `starts_at` on the client.

**Max lobby size is 8.** Enforced in the `create-lobby` Edge Function — not client-side. Attempts to join a full lobby return a 400 error.

**Room code is the join mechanism for friends-only lobbies.** 4-character alphanumeric code generated at lobby creation. No in-app friend graph needed for v1.

**Lobby ranking is by score, not correct count.** `lobby_answers` stores a `score` column (time bonus + streak multiplier). `fetchLobbyResults` ranks by summed score descending. Never rank by correct count alone — the in-game score display would then contradict the results screen.

---

## JSONB Arrays Must Not Be Double-Encoded

The `answers` column in `lobby_questions` is JSONB. Insert actual arrays — not `JSON.stringify()`'d strings. Inserting a stringified value stores a string literal in the JSONB column, which silently breaks all answer rendering. Always pass the raw array:

```js
// Correct
answers: ['Mars', 'Venus', 'Jupiter', 'Saturn']

// Wrong — stores a string, not an array
answers: JSON.stringify(['Mars', 'Venus', 'Jupiter', 'Saturn'])
```

---

## game_sessions RLS Requires INSERT Policy

The `game_sessions` table requires both SELECT and INSERT RLS policies. The host calls `create_game_session` RPC when loading each question — without an INSERT policy, this fails silently. Always add INSERT when adding SELECT to `game_sessions`.

---

## Edge Functions Require Authorization Header

`solo-question` and `generate-questions` validate the `Authorization` header and return 401 if missing or invalid. Do NOT serve these functions with `--no-verify-jwt` in production — that would allow unauthenticated Anthropic API calls. In local dev, `--no-verify-jwt` is acceptable only if you understand the cost implication.

---

## Maestro Must Run Sequential (--shards=1)

Maestro runs directory-level test suites in parallel by default. Tests 03–26 depend on the test user created in test_02. Parallel execution causes auth-dependent tests to fail non-deterministically. Always run with `--shards=1`:

```bash
maestro test --shards=1 .
```

The `run_tests.sh` script handles this. Never call `maestro test` directly on the directory.

---

## All Tests Are Self-Contained

Every test that requires `testuser_maestro_02` calls `ensure_test_user_02.js` as its first step to guarantee the user exists. Running `./run_tests.sh` immediately after `supabase db reset` passes in a single run. No warm-up run required.

---

## Verification Commands

**Mobile (compile):** `cd mobile && npx tsc --noEmit`
**Mobile (run):** `cd mobile && npx expo start` — press `i` for iOS Simulator, `a` for Android Emulator
**Supabase (local):** `supabase start` — starts local Postgres + Edge Functions + Realtime
**Diff:** `git diff HEAD > ~/trivolta_diff.txt`

---

## Local Dev Prerequisites

`supabase/seed.sql` must exist (even if empty) or `supabase db reset` will fail silently and leave migrations unapplied. The file exists at `supabase/seed.sql` — do not delete it.

---

## Maestro Testing Requires Native Build

Maestro E2E tests use `appId: com.mikeisbell.trivolta`. This only works when the app is installed as a native build on the simulator — not via Expo Go. Expo Go runs under `host.exp.Exponent` and Maestro cannot find the app by our bundle ID.

Before running Maestro tests, the app must be built and installed natively:
```bash
cd mobile
npx expo prebuild --platform ios --clean
npx expo run:ios
```
The generated `ios/` directory is gitignored — this command must be re-run after any fresh clone or after `ios/` is deleted.

---

## Testing Rules

Always run the full Maestro suite after any change — all tests must pass before reporting done. Never pipe test output through `| tail -N` — it can truncate critical failure details. When a test fails, read the full debug output before attempting a fix. Do not guess at root cause.

## Root Cause Before Fix

For any failing test or bug, investigate actual root cause before writing a fix. Do not assume the test assertion is wrong — check the implementation first. State the diagnosed root cause in the response before making any file changes.

---

## CLAUDE.md Update Rule

Add an entry only when you discover a constraint that:
1. Is not expressed in code
2. Would cause a wrong decision if absent

Do not append build summaries, feature lists, or task completions. Those belong in git.
