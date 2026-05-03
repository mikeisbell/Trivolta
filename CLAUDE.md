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

All 5 Edge Functions (`solo-question`, `generate-questions`, `create-lobby`, `join-lobby`, `daily-challenge`) MUST validate the `Authorization` header in code and return 401 on missing or invalid JWT. They use `auth.getUser()` against a Supabase client constructed with the user's JWT.

**`--no-verify-jwt` is required, not forbidden.** Trivolta uses the new Supabase API key system (`sb_publishable_*` / `sb_secret_*`). These keys are not JWTs, so platform-level JWT verification at the gateway is incompatible. In-function auth via `Authorization` header check is the documented and correct pattern. Both local (`supabase functions serve --no-verify-jwt`) and production (`supabase functions deploy --no-verify-jwt`) use the flag.

The publishable key is read from `req.headers.get('apikey')` with `Deno.env.get('SUPABASE_ANON_KEY')` as fallback — the env var sync is unreliable on new-key projects, so the header is the source of truth.

Never construct a Supabase user client inside an Edge Function with `Deno.env.get('SUPABASE_ANON_KEY')` standalone — always use the apikey-header-with-env-fallback pattern.

Local development uses asymmetric JWT signing keys via `supabase/signing_keys.json` and `config.toml`'s `[auth].signing_keys_path`. The keys file is gitignored.

---

## Admin Role Setup

Trivolta gates admin access via a JWT claim at `auth.users.app_metadata.role = 'admin'`. `app_metadata` is service-role-only and not user-editable, so it is the safe place for role claims. `user_metadata` is user-editable and forgeable — never put role data there.

The role is checked in three places:
- Postgres RLS via the `public.is_admin()` helper, which reads `auth.jwt() -> 'app_metadata' ->> 'role'`
- Future admin Edge Functions, which inspect `auth.user.app_metadata.role` after `auth.getUser()`
- The mobile / Expo Web admin layout, via `useAuth().isAdmin`

To grant admin to a user on local Supabase, run the following against the local DB (replace `<email>` with the target email):

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -c "
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{\"role\":\"admin\"}'::jsonb
where email = '<email>';
"
```

Verify:

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc "
select raw_app_meta_data ->> 'role' from auth.users where email = '<email>';
"
```

For production, use the Supabase Dashboard: Authentication → Users → select the user → User Metadata → set `role: admin` under `app_metadata` (not `user_metadata`).

After granting, the user must sign out and sign back in. The role claim only enters the JWT on a fresh sign-in — existing sessions keep the old claims until refresh.

`supabase db reset` wipes `auth.users`. Re-run the grant after every reset.

---

## Maestro Must Run Sequential (one flow per invocation)

Maestro 2.5.0+ runs directory-level test suites in parallel even with `--shards=1`. Tests 03–26 depend on the test user created in test_02 and on a single shared simulator app, so parallel execution causes auth-dependent tests to fail non-deterministically. The `run_tests.sh` script forces sequential execution by looping `maestro test` once per flow file:

```bash
for f in maestro/test_*.yaml; do
  maestro test --env ... "$f"
done
```

Always run via `./run_tests.sh`. Never call `maestro test` directly on the directory.

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

## Manual Test Verification

Some tests are deferred as non-automatable under the current architecture and are excluded from `./run_tests.sh` via the `SKIP_TESTS` array in `mobile/run_tests.sh`. Each requires a one-line manual check before every beta release:

- **test_18 — QuestionScreen error/retry.** Kill the `solo-question` Edge Function mid-game (e.g. stop the Supabase functions serve process), verify the error UI appears with a Retry button, restart the function, tap Retry, verify the question loads.
- **test_27 — Feedback FAB.** From any authenticated screen, tap the floating ✎ button bottom-right, verify the feedback modal opens, type a message, tap Send, verify the toast appears.

Add a manual-verification entry here whenever a test is added to `SKIP_TESTS` in `mobile/run_tests.sh`.

## Code Review Phase

Every commit on a development task gets two automated passes after the implementer's normal verification suite passes: `bash simplify-and-verify.sh` (quality / `/simplify`) and `bash run-review.sh <commit-sha> <INSTRUCTIONS path>` (conformance review). Both are mandatory and run via the wrapper scripts; do not invoke `claude /simplify` or `claude -p` directly.

The `reviews/` directory is owned by the conformance review subprocess. The implementer Claude Code session never edits files under `reviews/` except via `run-review.sh`. `simplify-log.md` files are owned by `simplify-and-verify.sh`. Hand-edits break the audit trail.

When `run-review.sh` exits with code 2 (`request_changes`), the implementer must fix the blocker findings, commit the fix, and re-run both scripts on the new commit BEFORE returning control to Mike. The session does not end on a `request_changes` verdict.

When `simplify-and-verify.sh` reverts a simplification because verification broke, that is correct behavior — do NOT debug or "fix" the verification suite to make `/simplify`'s changes pass. Verification is the gate; `/simplify` is advisory.

The `claude -p` reviewer subprocess has no access to the implementer session's chat history. It sees only the prompt template plus the diff, the matching INSTRUCTIONS file, CLAUDE.md, and the four-criteria excerpt from WORKFLOW.md. This isolation is intentional. Do not bypass it by piping anything else into the subprocess.

Every `simplify-and-verify.sh` run produces exactly one `chore:` commit and leaves the working tree clean. The audit trail is dense by design.

## Root Cause Before Fix

For any failing test or bug, investigate actual root cause before writing a fix. Do not assume the test assertion is wrong — check the implementation first. State the diagnosed root cause in the response before making any file changes.

---

## CLAUDE.md Update Rule

Add an entry only when you discover a constraint that:
1. Is not expressed in code
2. Would cause a wrong decision if absent

Do not append build summaries, feature lists, or task completions. Those belong in git.
