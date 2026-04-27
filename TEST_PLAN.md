# Trivolta — Test Plan

## Overview

Trivolta uses Maestro for E2E testing. Maestro drives a natively-built iOS app on a simulator — it cannot use Expo Go.

All tests must pass before any commit. The full suite must be re-run after any change to screens, navigation, auth, or Supabase queries.

---

## Prerequisites — Must Be True Before Running Any Test

### 1. Supabase local stack running

```bash
cd /Users/mizzy/Developer/Trivolta
supabase start
```

Verify with `supabase status`.

### 2. Edge Functions running

Required for test_05+ (any test that starts a quiz calls the `solo-question` Edge Function). Run in a **separate terminal** and leave it running. The `--env-file` flag is required to pass `ANTHROPIC_API_KEY` to the function — without it, all AI calls fail silently:

```bash
cd /Users/mizzy/Developer/Trivolta
supabase functions serve --no-verify-jwt --env-file supabase/.env.local
```

### 3. `.env.maestro` populated

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/.env.maestro`

Required by test_02 (`delete_test_user.js` uses the Supabase admin API):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=<local service role key>
```

Get the service role key: `supabase status | grep service_role`

This file is gitignored — re-create after fresh clones. See `.env.maestro.example` for the template.

### 4. App running on iOS Simulator + Metro running

The simulator must have the Trivolta app installed and Metro must be running. Maestro targets `com.mikeisbell.trivolta` — not Expo Go.

**Day-to-day:**
```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx expo start
# then press 'i' to open the iOS simulator and launch the app
```

Wait until the app is visible at the auth screen (no "◄ Expo Go" in top left) before running tests.

**After a fresh clone, env var change, or native dependency change:**
```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx expo run:ios --no-bundler
# then start Metro separately: npx expo start, press 'i'
```

The `ios/` directory is gitignored — `expo run:ios` must be re-run after any fresh clone.

### 5. Maestro CLI installed

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
maestro --version
```

---

## No Manual Test User Setup Required

The test suite is self-sufficient. **test_02 deletes and recreates the test user automatically** via `scripts/delete_test_user.js` using the Supabase admin API. Tests 03–07 depend on the user existing after test_02 runs. Always run the full suite in order — never run tests 03+ in isolation unless test_02 has already run in the same Supabase session.

---

## Running the Tests

Use `run_tests.sh` — it sources `.env.maestro` and passes vars to Maestro correctly.

### Full suite (always run before committing)

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
chmod +x run_tests.sh   # first time only
./run_tests.sh
```

### Single test

```bash
./run_tests.sh test_03_sign_in.yaml
```

Output is always saved to `~/trivolta_test_output.txt`.

---

## Terminal Layout for a Test Session

Three terminals required:

| Terminal | Directory | Command |
|----------|-----------|---------|
| 1 | `/Users/mizzy/Developer/Trivolta` | `supabase start && supabase functions serve --no-verify-jwt --env-file supabase/.env.local` |
| 2 | `/Users/mizzy/Developer/Trivolta/mobile` | `npx expo start` then press `i` |
| 3 | `/Users/mizzy/Developer/Trivolta/mobile` | `./run_tests.sh` |

Run terminals 1 and 2 first. Wait for the app to be visible at the auth screen before running terminal 3.

---

## Test Inventory

| # | File | What it tests | Status | Notes |
|---|------|--------------|--------|-------|
| 01 | `test_01_auth_screen_on_launch.yaml` | Unauthenticated user sees auth screen | ✅ Passing | No dependencies |
| 02 | `test_02_sign_up.yaml` | Sign up creates account, lands on HomeScreen | ✅ Passing | Needs `.env.maestro`; auto-deletes + recreates test user |
| 03 | `test_03_sign_in.yaml` | Sign in with existing credentials | ✅ Passing | Depends on test_02 |
| 04 | `test_04_sign_out.yaml` | Sign out from ProfileScreen returns to auth | ✅ Passing | Depends on test_02 |
| 05 | `test_05_custom_category.yaml` | Custom category screen, start a quiz | ✅ Passing | Requires Edge Functions with `--env-file` |
| 06 | `test_06_profile_screen.yaml` | Profile screen loads with real data | ✅ Passing | Depends on test_02 |
| 07 | `test_07_leaderboard_screen.yaml` | Leaderboard screen loads | ✅ Passing | Depends on test_02 |

**Planned (not yet written):**

| # | File | What it tests |
|---|------|--------------|
| 08 | `test_08_solo_game_loop.yaml` | Start quiz, answer 10 questions, see results |
| 09 | `test_09_play_again.yaml` | Play again from ResultsScreen |
| 10 | `test_10_timer_expiry.yaml` | Unanswered question times out gracefully |
| 11 | `test_11_streak_tracking.yaml` | Streak increments on consecutive correct answers |
| 12 | `test_12_create_lobby.yaml` | Create lobby, see waiting screen with room code |
| 13 | `test_13_join_lobby.yaml` | Join lobby via room code |
| 14 | `test_14_lobby_game_flow.yaml` | Full lobby game — host + guest, all 10 questions |
| 15 | `test_15_lobby_host_cancel.yaml` | Host leaves waiting lobby |

---

## Test User Reference

| Email | Password | Username |
|-------|----------|----------|
| `testuser_maestro_02@trivolta-test.com` | `TestPassword123!` | `maestro02` |

---

## Known Quirks

**`--env-file supabase/.env.local` is required when serving Edge Functions.** Without it, `ANTHROPIC_API_KEY` is not passed to the runtime and all AI calls fail silently with a 503. Always use: `supabase functions serve --no-verify-jwt --env-file supabase/.env.local`

**Maestro uses `--env KEY=VALUE` not `--env-file`.** The `run_tests.sh` script handles this. Never call `maestro test` directly without env vars — `SUPABASE_URL` will be undefined and test_02 will fail.

**`npx expo start` does not open the simulator.** It only starts Metro. Press `i` in the Metro terminal to open the iOS simulator. Alternatively `npx expo run:ios` does both but exits after launching.

**The app must be the native build, not Expo Go.** If the top-left of the simulator shows "◄ Expo Go", tests will fail. Use `npx expo run:ios --no-bundler` to install the native build, then `npx expo start` + press `i`.

**Metro must be running for the app to function.** The app fetches its JS bundle from Metro. If Metro is not running, all screens fail to load.

**Tab bar taps don't propagate in Maestro's native build environment.** Use `home-avatar` testID to navigate to ProfileScreen.

**`assertVisible` with inline `timeout` not supported in Maestro 2.4.0.** Use `extendedWaitUntil` instead.

**iOS "Save Password?" system dialog** may appear after sign-in. All tests handle this with `tapOn: "Not Now" optional: true`.

**Maestro crashes with a GraalVM JVM error after test_02** when running the full suite. This is a Maestro CLI bug. Tests still pass before the crash — check `~/trivolta_test_output.txt` for results.

---

## After Fresh Clone — Setup Checklist

```bash
# 1. Install dependencies
cd /Users/mizzy/Developer/Trivolta/mobile && npm install

# 2. Start Supabase + apply migrations
cd /Users/mizzy/Developer/Trivolta
supabase start
supabase db reset

# 3. Recreate gitignored .env files
#    mobile/.env.local           — Supabase URL + anon key (use Mac LAN IP, not 127.0.0.1)
#    supabase/.env.local         — Anthropic key + service role key
#    mobile/maestro/.env.maestro — Supabase URL + service role key

# 4. Start Edge Functions (separate terminal)
supabase functions serve --no-verify-jwt --env-file supabase/.env.local

# 5. Build and install native app, start Metro
cd mobile
npx expo run:ios --no-bundler
npx expo start
# press 'i' to open simulator

# 6. Run full test suite (separate terminal)
chmod +x run_tests.sh
./run_tests.sh
```

> **Note on `mobile/.env.local` Supabase URL:** Use your Mac's LAN IP (e.g. `http://192.168.1.x:54321`), not `http://127.0.0.1:54321`. The iOS simulator cannot reach `127.0.0.1` on the Mac. Get your LAN IP with `ipconfig getifaddr en0`.
