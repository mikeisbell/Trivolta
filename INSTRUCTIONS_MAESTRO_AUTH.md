# INSTRUCTIONS_MAESTRO_AUTH.md — Trivolta auth E2E tests

## Task
Write and run Maestro E2E tests for the complete auth flow using the testIDs already
in place. Four tests: unauthenticated launch, sign up, sign out, sign in.

## Verifiable objective
When complete, all four tests pass:
- test_01: unauthenticated user sees auth screen on launch
- test_02: sign up with fresh credentials navigates to HomeScreen
- test_03: sign in with existing credentials navigates to HomeScreen
- test_04: sign out from ProfileScreen returns to auth screen
- `git diff HEAD > ~/trivolta_diff.txt` captures all changes

## Constraints
- Read CLAUDE.md before writing a single file
- Maestro tests live in `mobile/maestro/` — do not put them anywhere else
- Each test flow file is self-contained — no shared state between flows
- Test credentials are hardcoded constants — never real user data
- Expo dev server must be running on port 8081 before tests execute
- Supabase must be running locally before tests execute

---

## Step 1 — Verify Maestro is installed

```bash
maestro --version
```

Expected: 2.4.0 or higher. If not found, run:
```bash
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version
```

---

## Step 2 — Create the Maestro test directory

```bash
mkdir -p /Users/mizzy/Developer/Trivolta/mobile/maestro
```

---

## Step 3 — Create test_01: auth screen on launch

Create `mobile/maestro/test_01_auth_screen_on_launch.yaml`:

```yaml
appId: com.mikeisbell.trivolta
---
# test_01: Unauthenticated user sees auth screen on launch
# Clears app state to ensure no session is persisted

- clearState
- launchApp:
    clearState: true
- assertVisible:
    id: "auth-email-input"
- assertVisible:
    id: "auth-password-input"
- assertVisible:
    id: "auth-submit-button"
```

---

## Step 4 — Create test_02: sign up

Create `mobile/maestro/test_02_sign_up.yaml`:

```yaml
appId: com.mikeisbell.trivolta
---
# test_02: Sign up with fresh credentials navigates to HomeScreen
# Uses a timestamp-based email to avoid conflicts across runs

- clearState
- launchApp:
    clearState: true

# Switch to sign up mode
- tapOn:
    id: "auth-mode-toggle"

# Fill in username
- tapOn:
    id: "auth-username-input"
- inputText: "testuser"

# Fill in email (use a fixed test email — db is reset between CI runs)
- tapOn:
    id: "auth-email-input"
- inputText: "signup_test@trivolta-test.com"

# Fill in password
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"

# Submit
- tapOn:
    id: "auth-submit-button"

# Should land on HomeScreen
- assertVisible:
    id: "home-screen"
    timeout: 15000
```

---

## Step 5 — Create test_03: sign in

Create `mobile/maestro/test_03_sign_in.yaml`:

```yaml
appId: com.mikeisbell.trivolta
---
# test_03: Sign in with existing credentials navigates to HomeScreen
# Depends on test_02 having created signup_test@trivolta-test.com

- clearState
- launchApp:
    clearState: true

# Auth screen should be visible (sign in mode is default)
- assertVisible:
    id: "auth-email-input"

- tapOn:
    id: "auth-email-input"
- inputText: "signup_test@trivolta-test.com"

- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"

- tapOn:
    id: "auth-submit-button"

- assertVisible:
    id: "home-screen"
    timeout: 15000
```

---

## Step 6 — Create test_04: sign out

Create `mobile/maestro/test_04_sign_out.yaml`:

```yaml
appId: com.mikeisbell.trivolta
---
# test_04: Sign out from ProfileScreen returns to auth screen

- clearState
- launchApp:
    clearState: true

# Sign in first
- assertVisible:
    id: "auth-email-input"

- tapOn:
    id: "auth-email-input"
- inputText: "signup_test@trivolta-test.com"

- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"

- tapOn:
    id: "auth-submit-button"

- assertVisible:
    id: "home-screen"
    timeout: 15000

# Tap sign out button on profile screen
- tapOn:
    id: "profile-signout-button"

# Confirm the alert
- tapOn: "Sign out"

# Should be back at auth screen
- assertVisible:
    id: "auth-submit-button"
    timeout: 10000
```

---

## Step 7 — Create test user in local Supabase

Tests 03 and 04 depend on a user with email `signup_test@trivolta-test.com` existing.
Run test_02 first to create this user, OR insert directly:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
SELECT count(*) FROM auth.users WHERE email = 'signup_test@trivolta-test.com';" 2>&1
```

If count is 0, run test_02 first before running test_03 and test_04.

---

## Step 8 — Add Maestro scripts to package.json

Add to the `scripts` section of `mobile/package.json`:

```json
"test:e2e": "maestro test maestro/",
"test:e2e:01": "maestro test maestro/test_01_auth_screen_on_launch.yaml",
"test:e2e:02": "maestro test maestro/test_02_sign_up.yaml",
"test:e2e:03": "maestro test maestro/test_03_sign_in.yaml",
"test:e2e:04": "maestro test maestro/test_04_sign_out.yaml"
```

---

## Verification

Ensure prerequisites are running before executing tests:
- Terminal 1: `cd mobile && npx expo start` (Expo dev server on port 8081)
- Terminal 2: `supabase start` (local Supabase)

Then run tests in order:

```bash
cd /Users/mizzy/Developer/Trivolta/mobile

# Run all four in sequence
export PATH="$HOME/.maestro/bin:$PATH"
maestro test maestro/test_01_auth_screen_on_launch.yaml
maestro test maestro/test_02_sign_up.yaml
maestro test maestro/test_03_sign_in.yaml
maestro test maestro/test_04_sign_out.yaml
```

Report each test result individually:
- test_01: PASS/FAIL + error if FAIL
- test_02: PASS/FAIL + error if FAIL
- test_03: PASS/FAIL + error if FAIL
- test_04: PASS/FAIL + error if FAIL

After all pass:
```bash
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Do not report success until all 4 tests pass.
