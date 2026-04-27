# INSTRUCTIONS_MISSING_TESTS.md

## Task

Implement Maestro E2E tests 16–26 covering auth validation, results screen assertions, error states, HomeScreen category taps, custom category interactions, create lobby with custom topic, leaderboard tab switching, back navigation, and lobby results navigation. These are all Tier 1 and Tier 2 tests from the backlog in TEST_PLAN.md.

Tests 27–30 (Tier 3) are explicitly out of scope for this task.

---

## Verifiable Objective

- [ ] `test_16_auth_validation.yaml` exists and passes
- [ ] `test_17_results_assertions.yaml` exists and passes
- [ ] `test_19_join_lobby_invalid_code.yaml` exists and passes (test_18 is manual-only — skipped)
- [ ] `test_20_home_category_taps.yaml` exists and passes
- [ ] `test_21_custom_category_interactions.yaml` exists and passes
- [ ] `test_22_create_lobby_custom_topic.yaml` exists and passes
- [ ] `test_23_leaderboard_tabs.yaml` exists and passes
- [ ] `test_24_back_navigation.yaml` exists and passes
- [ ] `test_25_join_lobby_error_flow.yaml` exists and passes
- [ ] `test_26_lobby_results_navigation.yaml` exists and passes
- [ ] All tests (01–26, excluding 18) pass when running `./run_tests.sh`
- [ ] `TEST_PLAN.md` updated — tests 16–26 marked ✅ Passing in the Backlog section, test_18 noted as manual-only skipped
- [ ] `TRIVOLTA_TRACKER.md` updated — Edge case coverage items updated where applicable
- [ ] `INSTRUCTIONS_MISSING_TESTS.md` added to INSTRUCTIONS Files Written in tracker

---

## Constraints

- Do NOT modify any existing test files (test_01 through test_15)
- Do NOT modify any screen source files
- All tests sign in as `testuser_maestro_02@trivolta-test.com` / `TestPassword123!` unless a specific test requires user03
- Use `extendedWaitUntil` with `timeout` — never `assertVisible` with inline timeout
- Use `optional: true` on all system dialog taps ("Not Now", "Open", etc.)
- test_18 (QuestionScreen error state via killing Edge Functions) is not implementable in Maestro — skip it, note it in TEST_PLAN.md as "manual-only"
- test_26 requires the same seeded lobby setup as test_14 — reuse `seed_full_game_lobby.js` and `cleanup_test_lobby.js` scripts, with room code `LBRS` to avoid collision
- For test_22, the lobby created via UI will call the real Edge Function — no seeding needed, but the test must not attempt to start the game (only 1 player)

---

## Steps

### Step 1 — Write `test_16_auth_validation.yaml`

Covers: mode toggle, username field visibility, empty field alert, wrong password alert.

Behaviour to verify:
- On launch, auth screen shows sign-in mode (`auth-email-input` visible, `auth-username-input` not visible)
- Tap `auth-submit-button` with empty fields → Alert with "required" text appears → tap OK/dismiss
- Tap `auth-mode-toggle` → sign-up mode: `auth-username-input` becomes visible, button label changes to "Create account"
- Tap `auth-mode-toggle` again → back to sign-in mode, `auth-username-input` not visible
- Enter valid email and wrong password, tap submit → Alert with error text appears

Note: Maestro cannot assert that a specific element is NOT visible — use `assertNotVisible` if supported in 2.4.0, otherwise omit that assertion and just verify the positive state after toggle.

### Step 2 — Write `test_17_results_assertions.yaml`

Covers: complete a quiz, assert score and grade label visible on results screen, tap `results-home`.

Behaviour to verify:
- Sign in, start a quiz via `home-category-science`
- Answer all 10 questions (tap `answer-0` each time, advance with `question-next`)
- `results-screen` visible
- A score number is visible (assert text contains digits — use `assertVisible: text: "pts"` since the score always ends in pts... actually score is displayed as a number, grade label is separate)
- Grade label visible — assert one of: "Outstanding", "Excellent", "Good effort", "Keep practicing" — use `assertVisible: text: "!" optional: true` or assert `results-screen` is present and then tap `results-home`
- Tap `results-home` → `home-screen` visible

### Step 3 — Write `test_19_join_lobby_invalid_code.yaml`

Covers: entering an invalid room code returns an error.

Behaviour to verify:
- Sign in, navigate to Play tab, tap `play-join-lobby`
- Enter `X`, `X`, `X`, `X` across the four code boxes
- Tap `join-lobby-submit`
- `join-lobby-error` testID visible

### Step 4 — Write `test_20_home_category_taps.yaml`

Covers: Science, Pop culture, and History category cards navigate to question screen.

Behaviour to verify:
- Sign in
- Tap `home-category-science` → `question-screen` loads (extendedWaitUntil 30000)
- Tap `question-back` → `home-screen` visible
- Tap `home-category-pop_culture` → `question-screen` loads
- Tap `question-back` → `home-screen` visible
- Tap `home-category-history` → `question-screen` loads
- Tap `question-back` → `home-screen` visible

### Step 5 — Write `test_21_custom_category_interactions.yaml`

Covers: freeform input, submit disabled state, back navigation, trending tap.

Behaviour to verify:
- Sign in, tap `home-category-custom` → custom category screen loads (`custom-category-input` visible)
- `custom-category-submit` is in disabled state (do not tap yet)
- Type "Ancient Rome" into `custom-category-input`
- `custom-category-submit` is now enabled — tap it → `question-screen` loads
- Tap `question-back` → navigate back (may land on custom-category screen or home — accept either)
- Navigate back to home if needed, tap `home-category-custom` again
- Tap `custom-category-back` → `home-screen` visible

### Step 6 — Write `test_22_create_lobby_custom_topic.yaml`

Covers: create lobby with custom topic input, verify waiting screen appears.

Behaviour to verify:
- Sign in, navigate to Play tab, tap `play-create-lobby`
- `create-lobby-submit` is disabled (no category selected)
- Tap `create-lobby-category-custom` → `create-lobby-custom-input` visible
- `create-lobby-submit` still disabled (custom input empty)
- Type "90s video games" into `create-lobby-custom-input`
- Tap `create-lobby-submit`
- `lobby-waiting-code` visible (waiting screen loaded)
- Navigate back (back gesture) to clean up

### Step 7 — Write `test_23_leaderboard_tabs.yaml`

Covers: period tab switching on LeaderboardScreen.

Behaviour to verify:
- Sign in, tap avatar → profile screen → back → navigate to leaderboard via `tab-ranks` or tab bar
- `leaderboard-screen` visible
- `leaderboard-tab-alltime` is the default active tab
- Tap `leaderboard-tab-week` → screen updates (wait for animation)
- Tap `leaderboard-tab-month` → screen updates
- Tap `leaderboard-tab-alltime` → back to all-time view

Note: `fetchLeaderboard` returns empty array if no scores exist for the period — the empty state ("No scores yet") should not cause a test failure. Assert `leaderboard-screen` is still visible after each tab tap.

### Step 8 — Write `test_24_back_navigation.yaml`

Covers: back mid-game returns to home without crash, results-home button.

Behaviour to verify:
- Sign in, tap `home-category-science` → `question-screen` loads
- Answer Q1 (tap `answer-0`, wait for `question-next`, do NOT tap next)
- Tap `question-back` → `home-screen` visible (game abandoned, no crash)
- Start a new quiz via `home-category-science`, answer all 10, tap `question-next` after each
- `results-screen` visible
- Tap `results-home` → `home-screen` visible

### Step 9 — Write `test_25_join_lobby_error_flow.yaml`

Covers: join button disabled until 4 chars entered, invalid code shows error.

Behaviour to verify:
- Sign in, navigate to Play tab, tap `play-join-lobby`
- Enter only 3 characters (J, O, I) — `join-lobby-submit` should be disabled (do not tap)
- Enter 4th character (N) — `join-lobby-submit` becomes enabled
- Clear all boxes by tapping each and entering X, X, X, X
- Tap `join-lobby-submit`
- `join-lobby-error` visible

Note: Maestro cannot programmatically clear a TextInput — to reset after 3-char entry, just continue typing the 4th char, then re-enter all 4 as X. Alternatively enter XXXX directly without the 3-char step. The disabled state assertion on 3 chars may be skipped if Maestro cannot reliably detect disabled state — just verify the error appears.

### Step 10 — Write `test_26_lobby_results_navigation.yaml`

Covers: lobby results screen shows ranked players, `lobby-results-home` and `lobby-results-play-again` navigate correctly.

Setup: uses `ensure_test_user_03.js` and `seed_full_game_lobby.js` with `ROOM_CODE: 'LBRS'`. Signs in as maestro02 (host), deep-links to waiting screen, starts game, answers all 10 questions, reaches lobby results screen.

Behaviour to verify (after reaching `lobby-results-my-score`):
- `lobby-results-list` visible
- `lobby-results-player-1` visible (first-ranked player row)
- Tap `lobby-results-home` → `home-screen` visible
- Run the same setup again (second pass)
- After reaching results, tap `lobby-results-play-again` → `lobby/create` screen visible (`create-lobby-submit` or `create-lobby-back` visible)
- Cleanup after each pass

### Step 11 — Update TEST_PLAN.md

In the Backlog section, update tests 16–26 status to ✅ Passing. Mark test_18 explicitly as "Skipped — manual-only (requires stopping Edge Functions mid-test, not automatable in Maestro)".

### Step 12 — Update TRIVOLTA_TRACKER.md

In Edge Case Coverage, mark:
- "Expired room code — error handling" ✅ (covered by test_19 and test_25)
- "Duplicate username on sign up — friendly error" — leave ⬜ (not covered by these tests)
- "Full lobby (8 players) — join rejected" — leave ⬜ (Tier 3)
- "Network failure during question fetch — retry UI" — leave ⬜ (test_18 skipped)

Add `INSTRUCTIONS_MISSING_TESTS.md` to INSTRUCTIONS Files Written section.

---

## Verification

```bash
cd /Users/mizzy/Developer/Trivolta/mobile

# Run new tests individually first to catch failures early
./run_tests.sh test_16_auth_validation.yaml
./run_tests.sh test_17_results_assertions.yaml
./run_tests.sh test_19_join_lobby_invalid_code.yaml
./run_tests.sh test_20_home_category_taps.yaml
./run_tests.sh test_21_custom_category_interactions.yaml
./run_tests.sh test_22_create_lobby_custom_topic.yaml
./run_tests.sh test_23_leaderboard_tabs.yaml
./run_tests.sh test_24_back_navigation.yaml
./run_tests.sh test_25_join_lobby_error_flow.yaml
./run_tests.sh test_26_lobby_results_navigation.yaml

# Full suite — all tests must pass
./run_tests.sh

# Diff for Mac Claude review
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each test result individually. Do not report done until all passing tests (01–17, 19–26) pass. Do not commit — Mac Claude reviews the diff first.
