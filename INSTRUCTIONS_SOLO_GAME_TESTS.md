# INSTRUCTIONS_SOLO_GAME_TESTS.md — Maestro tests for solo game loop

## Task

Write four Maestro E2E tests covering the solo game loop: the full 10-question flow to results, play again, timer expiry, and streak tracking. These tests verify the core product loop works end to end. All tests follow the established pattern from test_01 through test_07.

Key facts about the screens under test (from the source code):
- `question-screen` — testID on the main question view (loaded state)
- `question-screen-loading` — testID on the loading spinner (transient, may be missed)
- `question-next` — testID on the "Next question →" / "See results" button (appears after answering)
- `answer-0` through `answer-3` — testIDs on the four answer buttons
- `results-screen` — testID on the ResultsScreen root view
- `results-play-again` — testID on "Play again" button
- `results-home` — testID on "Back to home" button
- Timer is 20 seconds — wait 22 seconds to guarantee expiry
- After timeout, `question-next` appears and the timeout message contains "Time's up"
- Streak pill appears when streak >= 2, contains text "streak"
- All AI questions load via Edge Functions — use `extendedWaitUntil` with 30000ms timeout, never `assertVisible` or `waitForAnimationToEnd` alone for question-screen

---

## Verifiable Objective

- [ ] `test_08_solo_game_loop.yaml` exists and passes — answers all 10 questions, reaches `results-screen`
- [ ] `test_09_play_again.yaml` exists and passes — completes a game, taps play again, reaches new `question-screen`
- [ ] `test_10_timer_expiry.yaml` exists and passes — lets timer expire on Q1, `question-next` appears, advances to Q2
- [ ] `test_11_streak_tracking.yaml` exists and passes — answers 3 questions correctly, streak pill visible on Q3
- [ ] All 11 tests pass when running `./run_tests.sh` (tests 01–11)
- [ ] TRIVOLTA_TRACKER.md updated — test_08 through test_11 marked ✅
- [ ] TEST_PLAN.md updated — test_08 through test_11 status updated to ✅ Passing

---

## Constraints

- Use `extendedWaitUntil` with `timeout: 30000` for every `question-screen` assertion — never bare `assertVisible`
- Use `extendedWaitUntil` with `timeout: 5000` for `question-next` after answering
- All tests must sign in using `testuser_maestro_02@trivolta-test.com` / `TestPassword123!`
- All tests must navigate to quiz via `home-category-custom` → `custom-category-prompt-nasa-missions` → `custom-category-submit` — this matches the established pattern from test_05
- Do NOT use `sleep` for anything except the 22-second timer wait in test_10
- Do NOT modify any existing test files (test_01 through test_07)
- Do NOT modify any screen source files
- test_11 streak assertion must use `optional: true` — the streak pill only appears if answers happen to be correct (we don't control which answer is right, only that we tap one)
- Delete the placeholder files test_08 through test_11 before writing new ones — they currently contain incorrect content written by Mac Claude

---

## Steps

### Step 1 — Delete placeholder test files

```bash
rm /Users/mizzy/Developer/Trivolta/mobile/maestro/test_08_solo_game_loop.yaml
rm /Users/mizzy/Developer/Trivolta/mobile/maestro/test_09_play_again.yaml
rm /Users/mizzy/Developer/Trivolta/mobile/maestro/test_10_timer_expiry.yaml
rm /Users/mizzy/Developer/Trivolta/mobile/maestro/test_11_streak_tracking.yaml
```

### Step 2 — Write `test_08_solo_game_loop.yaml`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_08_solo_game_loop.yaml`

```yaml
appId: com.mikeisbell.trivolta
---
# test_08: Solo game loop — answer all 10 questions and reach results screen

- clearState
- launchApp:
    clearState: true

# Sign in
- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

# Start a quiz
- tapOn:
    id: "home-category-custom"
- waitForAnimationToEnd
- assertVisible:
    id: "custom-category-input"
- tapOn:
    id: "custom-category-prompt-nasa-missions"
- tapOn:
    id: "custom-category-submit"

# Answer all 10 questions — always tap answer-0, then next
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

# Results screen must appear
- extendedWaitUntil:
    visible:
      id: "results-screen"
    timeout: 10000
```

### Step 3 — Write `test_09_play_again.yaml`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_09_play_again.yaml`

```yaml
appId: com.mikeisbell.trivolta
---
# test_09: Play again from ResultsScreen restarts the game loop

- clearState
- launchApp:
    clearState: true

# Sign in
- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

# Start a quiz
- tapOn:
    id: "home-category-custom"
- waitForAnimationToEnd
- tapOn:
    id: "custom-category-prompt-nasa-missions"
- tapOn:
    id: "custom-category-submit"

# Answer all 10 questions
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

# Results screen
- extendedWaitUntil:
    visible:
      id: "results-screen"
    timeout: 10000

# Tap play again — new game must start
- tapOn:
    id: "results-play-again"
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
```

### Step 4 — Write `test_10_timer_expiry.yaml`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_10_timer_expiry.yaml`

```yaml
appId: com.mikeisbell.trivolta
---
# test_10: Timer expiry — unanswered question shows timeout state and allows advancing

- clearState
- launchApp:
    clearState: true

# Sign in
- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

# Start a quiz
- tapOn:
    id: "home-category-custom"
- waitForAnimationToEnd
- tapOn:
    id: "custom-category-prompt-nasa-missions"
- tapOn:
    id: "custom-category-submit"

# Wait for question — do NOT answer
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000

# Wait 22 seconds for the 20-second timer to expire
- sleep:
    ms: 22000

# Next button must appear after timeout
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000

# Advance to next question
- tapOn:
    id: "question-next"
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
```

### Step 5 — Write `test_11_streak_tracking.yaml`

File: `/Users/mizzy/Developer/Trivolta/mobile/maestro/test_11_streak_tracking.yaml`

```yaml
appId: com.mikeisbell.trivolta
---
# test_11: Streak tracking — after 2+ correct answers streak pill appears

- clearState
- launchApp:
    clearState: true

# Sign in
- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

# Start a quiz
- tapOn:
    id: "home-category-custom"
- waitForAnimationToEnd
- tapOn:
    id: "custom-category-prompt-nasa-missions"
- tapOn:
    id: "custom-category-submit"

# Q1 — answer and advance
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

# Q2 — answer and advance
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000
- tapOn:
    id: "question-next"

# Q3 — question-screen must load (streak pill may or may not show depending on correctness)
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
- tapOn:
    id: "answer-0"
- extendedWaitUntil:
    visible:
      id: "question-next"
    timeout: 5000

# Streak pill appears when streak >= 2 — optional since we don't control correct_index
- assertVisible:
    text: "streak"
    optional: true

# Advance — game continues
- tapOn:
    id: "question-next"
- extendedWaitUntil:
    visible:
      id: "question-screen"
    timeout: 30000
```

### Step 6 — Update TRIVOLTA_TRACKER.md

Mark test_08 through test_11 as ✅ Done in Phase 2. Add `INSTRUCTIONS_SOLO_GAME_TESTS.md` to INSTRUCTIONS Files Written.

### Step 7 — Update TEST_PLAN.md

Update test_08 through test_11 status from ⬜ to ✅ Passing in the Test Inventory table.

---

## Verification

Run tests individually in order. Each one takes 3-5 minutes due to 10 AI questions per game.

```bash
cd /Users/mizzy/Developer/Trivolta/mobile

# Prerequisites must be running:
# Terminal 1: supabase functions serve --no-verify-jwt --env-file supabase/.env.local
# Terminal 2: npx expo run:ios (app visible on simulator, not Expo Go)

./run_tests.sh test_08_solo_game_loop.yaml
./run_tests.sh test_09_play_again.yaml
./run_tests.sh test_10_timer_expiry.yaml
./run_tests.sh test_11_streak_tracking.yaml

# Then confirm full suite still passes
./run_tests.sh

# Capture diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each test result individually. Do not report success until all pass. Do not commit — Mac Claude reviews the diff first.
