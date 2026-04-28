# INSTRUCTIONS_TEST_ISOLATION.md

## Task

Make every Maestro test self-contained. Currently tests 03–26 depend on test_02 having created `testuser_maestro_02` — if they run before test_02 (e.g. after `supabase db reset`), they fail at sign-in. Fix this by ensuring every test that needs an authenticated user guarantees the user exists before it tries to sign in.

The pattern already exists for user_03 in `ensure_test_user_03.js`. Apply the same pattern to user_02.

---

## Verifiable Objective

- [ ] `scripts/ensure_test_user_02.js` exists — creates `testuser_maestro_02` if not present, including a `profiles` row; sets `output.user02Id`
- [ ] Every test from test_03 through test_26 (excluding test_02 itself) calls `ensure_test_user_02.js` as its first `runScript` step before any sign-in
- [ ] test_02 is unchanged — it still deletes and recreates the user to test the sign-up flow
- [ ] Running `./run_tests.sh` immediately after `supabase db reset` passes 25/25 in a single run — no second run required
- [ ] Running tests in any arbitrary order (e.g. test_15 before test_03) passes without depending on a prior test
- [ ] All 25 tests still pass when running `./run_tests.sh` in normal order
- [ ] `TEST_PLAN.md` updated — remove the "No Manual Test User Setup Required" section's caveat about running the suite twice after a reset; replace with "All tests are self-contained and pass in a single run after `supabase db reset`"
- [ ] CLAUDE.md entry "supabase db reset Wipes Test Users — Run Full Suite Twice" removed or corrected to reflect that a single run now suffices
- [ ] `TRIVOLTA_TRACKER.md` updated — `INSTRUCTIONS_TEST_ISOLATION.md` added to INSTRUCTIONS Files Written

---

## Constraints

- Do NOT modify test_01 — it requires no auth and has no user dependency
- Do NOT modify test_02 — it must keep deleting + recreating the user to remain a valid sign-up test
- Do NOT modify any screen source files
- The `ensure_test_user_02.js` script must be idempotent — if the user already exists, it does nothing except return `output.user02Id`
- The script must create both the auth user AND a `profiles` row — the app requires a profile to load HomeScreen
- Use `email_confirm: true` in the auth user creation so sign-in works immediately
- The `runScript` call must appear before `launchApp` or before the first `tapOn` that signs in — specifically it must be the first step after `clearState` / `launchApp` in tests that don't already have a setup script
- For tests that already run `ensure_test_user_03.js` first (test_13, test_14, test_15, test_26), add the `ensure_test_user_02.js` call after it (user_03 ensure first, then user_02 ensure)
- Pass `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as env vars in the `runScript` call — same pattern as `ensure_test_user_03.js`

---

## Steps

### Step 1 — Write `scripts/ensure_test_user_02.js`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/scripts/ensure_test_user_02.js`

Identical pattern to `ensure_test_user_03.js` but for `testuser_maestro_02@trivolta-test.com` / `maestro02`. Sets `output.user02Id`.

### Step 2 — Update tests 03–26 (excluding 02)

For each test file (test_03 through test_26, skipping test_02), add the following block immediately after `clearState` and `launchApp` and before the first auth interaction:

```yaml
- runScript:
    file: ./scripts/ensure_test_user_02.js
    env:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY}
```

For tests that already call `ensure_test_user_03.js` (test_13, test_15, test_26), add the `ensure_test_user_02.js` call directly after the user_03 ensure call.

For test_14, which calls `ensure_test_user_03.js` and then signs in before seeding — add `ensure_test_user_02.js` after user_03 ensure, before the sign-in steps.

### Step 3 — Update CLAUDE.md

Remove or replace the "supabase db reset Wipes Test Users — Run Full Suite Twice" entry. Replace with:

> **All tests are self-contained.** Every test that requires `testuser_maestro_02` calls `ensure_test_user_02.js` as its first step to guarantee the user exists. Running `./run_tests.sh` immediately after `supabase db reset` passes in a single run. No warm-up run required.

### Step 4 — Update TEST_PLAN.md

In the "No Manual Test User Setup Required" section, replace the paragraph that says test_02 must run before tests 03+ with:

> All tests are self-contained. Each test that needs `testuser_maestro_02` calls `ensure_test_user_02.js` at the start to guarantee the user exists, regardless of run order. The full suite passes in a single run after `supabase db reset`.

### Step 5 — Update TRIVOLTA_TRACKER.md

Add `INSTRUCTIONS_TEST_ISOLATION.md` to INSTRUCTIONS Files Written section.

---

## Verification

```bash
# 1. Wipe all data
cd /Users/mizzy/Developer/Trivolta && supabase db reset

# 2. Run full suite immediately — must pass 25/25 in a single run
cd mobile && ./run_tests.sh

# 3. Run a single auth-dependent test in isolation — must pass without running test_02 first
./run_tests.sh test_07_leaderboard_screen.yaml
./run_tests.sh test_15_leave_lobby.yaml

# 4. Diff for Mac Claude review
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Do not report done until 25/25 pass in a single run after `supabase db reset`. Do not commit — Mac Claude reviews the diff first.
