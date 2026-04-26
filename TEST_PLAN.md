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

Verify with `supabase status` — all services should show `running`. If Edge Functions are needed, add `supabase functions serve --no-verify-jwt` in a separate terminal.

### 2. Test user exists in local Supabase

Tests 03–07 depend on a pre-existing user. Create it once after each `supabase stop && supabase start` cycle:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
SELECT supabase_auth_admin.create_user(
  '{\"email\": \"testuser_maestro_02@trivolta-test.com\", \"password\": \"TestPassword123!\", \"email_confirm\": true}'::jsonb
);" 2>&1
```

Then insert the profile row:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
INSERT INTO public.profiles (id, username)
SELECT id, 'maestro02' FROM auth.users
WHERE email = 'testuser_maestro_02@trivolta-test.com'
ON CONFLICT (id) DO NOTHING;" 2>&1
```

If the psql commands fail, create the user manually in Supabase Studio at http://127.0.0.1:54323 → Authentication → Users → Add user.

### 3. `.env.maestro` populated

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/.env.maestro`

Must contain:
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=<local service role key from supabase status>
```

Get the service role key with: `supabase status | grep service_role`

This file is gitignored — must be re-created after fresh clones.

### 4. Native iOS build installed on simulator

Maestro requires the app installed as a native build — NOT Expo Go. Expo Go uses `host.exp.Exponent`; Maestro targets `com.mikeisbell.trivolta`.

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx expo prebuild --platform ios --clean
npx expo run:ios
```

Wait for the simulator to fully launch and the app to appear before running tests. The `ios/` directory is gitignored — this step must be repeated after any fresh clone or after `ios/` is deleted.

### 5. Maestro CLI installed

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
maestro --version
```

Minimum version: 2.4.0

### 6. Simulator running (not just booted)

Open Simulator.app manually or confirm it opened during `npx expo run:ios`. The app must be visible and at the auth screen before running tests.

---

## Running the Tests

### Full suite (always run this before committing)

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
maestro test maestro/
```

### Single test

```bash
maestro test maestro/test_03_sign_in.yaml
```

### With env file explicitly

```bash
maestro test --env-file maestro/.env.maestro maestro/
```

---

## Test Inventory

| # | File | What it tests | Status | Dependencies |
|---|------|--------------|--------|-------------|
| 01 | `test_01_auth_screen_on_launch.yaml` | Unauthenticated user sees auth screen | ✅ Passing | None |
| 02 | `test_02_sign_up.yaml` | Sign up creates account, lands on HomeScreen | ✅ Passing | Supabase running, `.env.maestro` |
| 03 | `test_03_sign_in.yaml` | Sign in with existing credentials | ✅ Passing | test_02 user exists |
| 04 | `test_04_sign_out.yaml` | Sign out from ProfileScreen returns to auth | ✅ Passing | test_02 user exists |
| 05 | `test_05_custom_category.yaml` | Custom category screen, start a quiz | ✅ Passing | test_02 user exists, Edge Functions running |
| 06 | `test_06_profile_screen.yaml` | Profile screen loads with real data | ❓ Unknown | test_02 user exists |
| 07 | `test_07_leaderboard_screen.yaml` | Leaderboard screen loads | ❓ Unknown | test_02 user exists |

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

| Purpose | Email | Password | Username |
|---------|-------|----------|----------|
| All auth + game tests | `testuser_maestro_02@trivolta-test.com` | `TestPassword123!` | `maestro02` |

---

## Known Quirks

**Tab bar taps don't propagate in Maestro's native build environment.** Use `home-avatar` testID (which calls `router.navigate` directly) to reach ProfileScreen instead of tapping the tab bar.

**test_02 deletes and recreates the test user** via `scripts/delete_test_user.js` to stay idempotent. Tests 03–07 depend on the user existing after test_02 runs. Run the suite in order, not individually, unless you've manually pre-created the user.

**`assertVisible` with inline `timeout` not supported in Maestro 2.4.0.** Use `extendedWaitUntil` instead.

**iOS "Save Password?" system dialog** may appear after sign-in. All tests handle this with `tapOn: "Not Now" optional: true`.

**Edge Functions required for test_05+.** The solo question generation hits the `solo-question` Edge Function. Run `supabase functions serve --no-verify-jwt` before any test that starts a quiz.

---

## After Fresh Clone — Full Setup Checklist

```bash
# 1. Install dependencies
cd /Users/mizzy/Developer/Trivolta/mobile
npm install

# 2. Start Supabase
cd /Users/mizzy/Developer/Trivolta
supabase start

# 3. Apply migrations
supabase db reset

# 4. Create test user (see Prerequisites section above)

# 5. Recreate .env files (gitignored)
#    mobile/.env.local — Supabase URL + anon key
#    supabase/.env.local — Anthropic key + service role key
#    mobile/maestro/.env.maestro — Supabase URL + service role key

# 6. Prebuild and run native app
cd mobile
npx expo prebuild --platform ios --clean
npx expo run:ios

# 7. Run tests
maestro test maestro/
```
