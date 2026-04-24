# INSTRUCTIONS_DETOX_SETUP.md — Trivolta E2E test harness

## Task
Set up Detox E2E testing for the Trivolta mobile app and write the first test suite
covering the complete auth flow: sign up, sign in, and sign out.

## Verifiable objective
When complete:
- `cd mobile && npx detox test --configuration ios.sim.debug` runs and all auth tests pass
- Test 1: unauthenticated user sees auth screen on launch
- Test 2: sign up with a fresh email navigates to HomeScreen
- Test 3: sign out from ProfileScreen returns to auth screen
- Test 4: sign in with existing credentials navigates to HomeScreen
- `git diff HEAD > ~/trivolta_diff.txt` captures all changes

## Constraints
- Read CLAUDE.md before writing a single file
- Use Detox with Expo dev client — not Expo Go (Expo Go does not support Detox)
- Tests must be isolated — each test resets auth state before running
- Test user credentials must be hardcoded test values, never real user data
- Do not modify any screen files to add testIDs — add testIDs as a separate targeted pass
- Supabase must be running locally before tests execute

---

## Step 1 — Install Detox and dependencies

```bash
cd /Users/mizzy/Developer/Trivolta/mobile

# Install Detox
npm install --save-dev detox @config-plugins/detox

# Install test runner
npm install --save-dev jest jest-circus @types/jest

# Install Expo dev client (required for Detox — Expo Go does not work with Detox)
npx expo install expo-dev-client
```

---

## Step 2 — Install applesimutils (required for iOS Detox)

```bash
brew tap wix/brew
brew install applesimutils
```

Verify:
```bash
applesimutils --list 2>&1 | head -5
```

---

## Step 3 — Configure Detox

Create `mobile/.detoxrc.js`:

```javascript
/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      '$0': 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/Trivolta.app',
      build: 'xcodebuild -workspace ios/Trivolta.xcworkspace -scheme Trivolta -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 17 Pro Max',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
  },
};
```

---

## Step 4 — Create E2E test directory and Jest config

Create `mobile/e2e/jest.config.js`:

```javascript
/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
```

---

## Step 5 — Add testIDs to auth screen elements

Update `mobile/app/auth.tsx` to add testID props to all interactive elements.
Only add testID — do not change any other logic or styles:

- Username input: `testID="auth-username-input"`
- Email input: `testID="auth-email-input"`
- Password input: `testID="auth-password-input"`
- Submit button: `testID="auth-submit-button"`
- Mode toggle button: `testID="auth-mode-toggle"`

Update `mobile/app/profile.tsx` to add testID to the sign out button:
- Sign out TouchableOpacity: `testID="profile-signout-button"`

Update `mobile/app/index.tsx` to add a testID to the root View:
- Root View: `testID="home-screen"`

---

## Step 6 — Create the auth test suite

Create `mobile/e2e/auth.test.ts`:

```typescript
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'

const TEST_EMAIL_1 = `test_signup_${Date.now()}@trivolta-test.com`
const TEST_PASSWORD = 'TestPassword123!'
const TEST_USERNAME = 'testuser'

const EXISTING_EMAIL = 'existing@trivolta-test.com'
const EXISTING_PASSWORD = 'TestPassword123!'

describe('Auth flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true })
  })

  beforeEach(async () => {
    await device.launchApp({ newInstance: true })
  })

  it('test_01: unauthenticated user sees auth screen on launch', async () => {
    await waitFor(element(by.id('auth-submit-button')))
      .toBeVisible()
      .withTimeout(10000)

    await detoxExpect(element(by.id('auth-email-input'))).toBeVisible()
    await detoxExpect(element(by.id('auth-password-input'))).toBeVisible()
  })

  it('test_02: sign up with fresh email navigates to HomeScreen', async () => {
    // Switch to sign up mode
    await waitFor(element(by.id('auth-mode-toggle')))
      .toBeVisible()
      .withTimeout(10000)
    await element(by.id('auth-mode-toggle')).tap()

    // Fill in sign up form
    await element(by.id('auth-username-input')).tap()
    await element(by.id('auth-username-input')).typeText(TEST_USERNAME)

    await element(by.id('auth-email-input')).tap()
    await element(by.id('auth-email-input')).typeText(TEST_EMAIL_1)

    await element(by.id('auth-password-input')).tap()
    await element(by.id('auth-password-input')).typeText(TEST_PASSWORD)

    await element(by.id('auth-submit-button')).tap()

    // Should navigate to HomeScreen
    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(15000)
  })

  it('test_03: sign out from ProfileScreen returns to auth screen', async () => {
    // Sign in first
    await waitFor(element(by.id('auth-email-input')))
      .toBeVisible()
      .withTimeout(10000)

    await element(by.id('auth-email-input')).tap()
    await element(by.id('auth-email-input')).typeText(EXISTING_EMAIL)

    await element(by.id('auth-password-input')).tap()
    await element(by.id('auth-password-input')).typeText(EXISTING_PASSWORD)

    await element(by.id('auth-submit-button')).tap()

    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(15000)

    // Navigate to profile and sign out
    await element(by.id('profile-signout-button')).tap()

    // Confirm sign out alert
    await element(by.label('Sign out')).atIndex(1).tap()

    // Should return to auth screen
    await waitFor(element(by.id('auth-submit-button')))
      .toBeVisible()
      .withTimeout(10000)
  })

  it('test_04: sign in with existing credentials navigates to HomeScreen', async () => {
    await waitFor(element(by.id('auth-email-input')))
      .toBeVisible()
      .withTimeout(10000)

    await element(by.id('auth-email-input')).tap()
    await element(by.id('auth-email-input')).typeText(EXISTING_EMAIL)

    await element(by.id('auth-password-input')).tap()
    await element(by.id('auth-password-input')).typeText(EXISTING_PASSWORD)

    await element(by.id('auth-submit-button')).tap()

    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(15000)
  })
})
```

---

## Step 7 — Add Detox scripts to package.json

Add to the `scripts` section of `mobile/package.json`:

```json
"e2e:build": "detox build --configuration ios.sim.debug",
"e2e:test": "detox test --configuration ios.sim.debug",
"e2e:test:single": "detox test --configuration ios.sim.debug --testNamePattern"
```

---

## Step 8 — Add Expo dev client config plugin

Update `mobile/app.json` to add the config plugin for expo-dev-client and detox.
In the `expo.plugins` array (create it if it doesn't exist), add:

```json
"plugins": [
  "expo-router",
  "expo-dev-client",
  ["@config-plugins/detox", {
    "subdomains": "*"
  }]
]
```

---

## Step 9 — Prebuild iOS native project

Detox requires native iOS files. Run:

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx expo prebuild --platform ios --clean
```

This generates the `ios/` directory with Xcode project files. This only needs to be
run once, or whenever native dependencies change.

---

## Step 10 — Build the app for Detox

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx detox build --configuration ios.sim.debug
```

This compiles the app into a binary that Detox can install and control.
This will take several minutes on first run.

---

## Step 11 — Create the test user in local Supabase

Before running tests, create the existing test user that tests 3 and 4 depend on.
Run this SQL against the local database:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
SELECT supabase_auth_admin.create_user(
  '{\"email\": \"existing@trivolta-test.com\", \"password\": \"TestPassword123!\", \"email_confirm\": true}'::jsonb
);" 2>&1 || echo "Use Supabase Studio to create the test user manually"
```

If the above fails, create the user manually in Supabase Studio at
http://127.0.0.1:54323 → Authentication → Users → Add user:
- Email: existing@trivolta-test.com
- Password: TestPassword123!
- Auto-confirm: enabled

Then insert a profile row:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
INSERT INTO public.profiles (id, username)
SELECT id, 'existinguser' FROM auth.users WHERE email = 'existing@trivolta-test.com'
ON CONFLICT (id) DO NOTHING;" 2>&1
```

---

## Verification

Run tests in order. Fix any failure before proceeding:

```bash
# 1. TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Ensure Supabase is running
cd /Users/mizzy/Developer/Trivolta
supabase start

# 3. Run Detox tests
cd mobile
npx detox test --configuration ios.sim.debug

# 4. Capture diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each test result individually:
- test_01: PASS/FAIL
- test_02: PASS/FAIL
- test_03: PASS/FAIL
- test_04: PASS/FAIL

Do not report success until all 4 tests pass.
