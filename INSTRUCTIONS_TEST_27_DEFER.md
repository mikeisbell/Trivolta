# INSTRUCTIONS — test_27 defer (non-automatable in current architecture)

## Task

test_27_feedback_submit cannot pass under Maestro in the current Trivolta architecture. Manual investigation (commit-pending diagnosis) confirmed:

- The FAB works correctly for real human users (confirmed by Mike via iOS device tap).
- Maestro `find` locates the `feedback-fab` testID in the iOS accessibility tree.
- Maestro's synthetic `tapOn` does NOT reach the FAB's React `onPress` handler. The active screen's `UIViewController` (rendered by `react-native-screens` 4.16 with `newArchEnabled: true`) sits above the FAB in the iOS view-event z-order; iOS routes the synthetic tap to the screen content, never to the FAB.
- The standard iOS escape hatch (`<FullWindowOverlay>` from `react-native-screens`) lifts the FAB above all UIViewControllers but ALSO removes every other testID from Maestro's accessibility tree, breaking the entire suite.
- A deep-link workaround would technically pass the test but bypasses the FAB entirely, providing false confidence about the user-facing FAB-tap → modal flow.

The Modal → in-tree-overlay refactor that was attempted as part of `INSTRUCTIONS_TEST_27_MODAL_FIX.md` is a real architectural improvement (more inspectable, no dependency on native Modal lifecycle, less complex to extend) and stays. It just doesn't fix the underlying Maestro-tap-routing problem.

This INSTRUCTIONS file lands four things:

1. **Commits the kept Modal → in-tree-overlay refactor** as a clean architectural improvement, with the commit message making clear it does NOT fix test_27.
2. **Marks test_27 as deferred** in `mobile/maestro/test_27_feedback_submit.yaml` via a header comment — the test stays in the file (preserves the testIDs and the intent) but the suite skip-list excludes it.
3. **Excludes test_27 from `run_tests.sh`** so the suite reports `26 passed, 0 failed` instead of `26 passed, 1 failed`. Same precedent as test_18.
4. **Documents the architecture issue** in CLAUDE.md and Known Issues so future Mac Claude sessions don't try to "fix" test_27 again, and so the manual-verification requirement is explicit before every beta release.

This is **local-only work**. No production impact, no schema, no Edge Function, no other screens. The FAB user flow is unchanged and works.

## Verifiable objective

### Commit 1: Modal → in-tree-overlay refactor (architectural improvement, not a test fix)

- [ ] The working-tree change in `mobile/components/FeedbackFAB.tsx` (replacing `<Modal>` with a conditional sibling `<View>` + `overlayAbsolute` style) is committed.
- [ ] Commit message: `refactor: replace native Modal with in-tree overlay (does not fix test_27)`. The body of the commit message includes a one-paragraph note that the change is sound on its own merits (testID inspectability, no dependency on native UIViewController lifecycle for the modal layer) but does NOT address the FAB-tap-routing root cause.
- [ ] No other code changes in this commit.

### Commit 2: defer test_27

- [ ] Add a YAML header comment at the top of `mobile/maestro/test_27_feedback_submit.yaml` (after the existing `# test_27:` line):
  ```
  # DEFERRED — non-automatable under current architecture (react-native-screens 4.16
  # + newArchEnabled: true). Maestro's synthetic tap does not reach the FAB's
  # onPress handler. The FAB works correctly for real human users.
  # Manual verification required before each beta release. See CLAUDE.md
  # "Manual Test Verification" section.
  # Kept in repo to preserve testIDs and document intended flow.
  ```
- [ ] `mobile/run_tests.sh` excludes `test_27_feedback_submit.yaml` from its glob loop. Match the existing exclusion pattern used for `test_18` (the runner already skips test_18 — find that mechanism and add test_27 to it). If test_18 isn't currently excluded by name in `run_tests.sh` (it may simply not exist as a file), add an explicit skip array near the top of the script:
  ```bash
  # Tests deferred as non-automatable under current architecture.
  # Each requires manual verification before beta release.
  # Reasons documented in each test_*.yaml header and in CLAUDE.md.
  SKIP_TESTS=("test_18" "test_27_feedback_submit")
  ```
  Then the glob loop checks the basename (without `.yaml`) against the skip list and skips matches with a `[Skipped] <name>` log line.
- [ ] The suite summary count adjusts: previously `26 passed, 1 failed` → after this lands, `26 passed, 0 failed, 1 skipped`. The summary line format:
  ```
  Suite summary: $passed passed, $failed failed, ${#SKIP_TESTS[@]} skipped
  ```
- [ ] `run_tests.sh test_27_feedback_submit.yaml` (single-file mode with explicit name) STILL runs the test — the skip list applies to the full-suite glob loop only. This way Mike or Claude Code can manually re-run it any time without removing the skip entry.
- [ ] The script's exit code stays correct: 0 if `failed == 0`, 1 otherwise. Skipped tests do not count as failures.

### Commit 3: documentation

- [ ] `CLAUDE.md` gets a new section `## Manual Test Verification` near the existing `## Testing Rules` section (or just below it). Content:
  - One paragraph: tests deferred as non-automatable each require a one-line manual check before every beta release. The list:
    - **test_18** — QuestionScreen error/retry: kill the `solo-question` Edge Function mid-game, verify the error UI appears with a Retry button that recovers the flow.
    - **test_27** — Feedback FAB: from any authenticated screen, tap the floating ✎ button bottom-right, verify the feedback modal opens, type a message, tap Send, verify the toast appears.
  - One sentence: "Add a manual-verification entry here whenever a test is added to `SKIP_TESTS` in `mobile/run_tests.sh`."
- [ ] `TRIVOLTA_TRACKER.md` `## Known Issues / Tech Debt` gets a new entry:
  ```
  - **test_27 non-automatable** — Maestro synthetic taps do not reach the
    feedback FAB's onPress handler under react-native-screens 4.16 +
    newArchEnabled. The FAB works for real users (manually verified
    2026-05-02 on Mike's iPhone via Expo Go). Test deferred via
    SKIP_TESTS in run_tests.sh; manual verification required before
    each beta release per CLAUDE.md "Manual Test Verification".
    Possible recoveries: (a) react-native-screens upgrade if a future
    version fixes the new-arch tap routing; (b) test on `newArchEnabled:
    false`; (c) deep-link workaround (false-confidence; rejected).
  ```
- [ ] `TRIVOLTA_TRACKER.md` Maestro test list updates:
  - test_27 line changes from `✅ test_27 — feedback submit (FAB → modal → submit → toast)` to `⏸ test_27 — feedback submit (deferred, non-automatable; see Known Issues)`.
  - The "All active tests are self-contained …" paragraph and active-test count updates to reflect 26 active.
- [ ] `TRIVOLTA_TRACKER.md` `## Workflow infrastructure` section: the `⬜ test_27 fix — INSTRUCTIONS_TEST_27_MODAL_FIX.md ...` line gets replaced with two entries:
  ```
  ⏸ test_27 fix — INSTRUCTIONS_TEST_27_MODAL_FIX.md (Modal → overlay refactor landed but does NOT fix test_27; root cause was Maestro tap routing, not Modal hierarchy)
  ✅ test_27 defer — INSTRUCTIONS_TEST_27_DEFER.md (test_27 deferred as non-automatable; FAB verified working for real users; SKIP_TESTS mechanism added to run_tests.sh; manual verification required before beta)
  ```
- [ ] INSTRUCTIONS Files Written:
  - `⏸ INSTRUCTIONS_TEST_27_MODAL_FIX.md` (kept on disk; partial work landed; test fix did not).
  - `✅ INSTRUCTIONS_TEST_27_DEFER.md`.
- [ ] `reviews/README.md` gets a brief calibration update under the existing notes section: a one-line entry noting that test_27 was deferred 2026-05-02 after diagnosis revealed the issue was Maestro tap routing, not Modal hierarchy.

### Verification

- [ ] `cd mobile && ./run_tests.sh` reports `Suite summary: 26 passed, 0 failed, 1 skipped` (or 2 skipped if test_18 is also tracked in SKIP_TESTS — verify by checking what file count `ls maestro/test_*.yaml | wc -l` returns vs the skip count).
- [ ] `cd mobile && ./run_tests.sh test_27_feedback_submit.yaml` (single-file mode) STILL runs the test (and fails, as expected). This is the manual-verification escape hatch.
- [ ] `cd mobile && npx tsc --noEmit` exits 0.

## Constraints

- **Do not** delete `test_27_feedback_submit.yaml`. The testIDs in it are documentation of the intended flow.
- **Do not** "fix" the FAB by introducing `<FullWindowOverlay>`, deep-link workarounds, or any other architectural change. Diagnosis confirmed they break other things or provide false confidence.
- **Do not** disable `newArchEnabled` or downgrade `react-native-screens`. Both are load-bearing for other parts of the app and a Tranche 8 / production concern, not a test-runner concern.
- **Do not** modify `mobile/components/FeedbackFAB.tsx` further beyond the existing working-tree change. The Modal → overlay refactor stands on its own merits.
- **Do not** modify any other Maestro YAML or any other production code.
- **Do not** add a CI step or remote service. Local-only.
- **Do not** add new dependencies.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files

1. `mobile/run_tests.sh` — find current handling of test_18 (if any explicit skip exists). Determine where `SKIP_TESTS` should be defined and how the loop should consult it.
2. `mobile/maestro/test_27_feedback_submit.yaml` — confirm the YAML header comment slot is at the top.
3. `CLAUDE.md` — find the right insertion point for `## Manual Test Verification` (immediately after `## Testing Rules` is the target).
4. `TRIVOLTA_TRACKER.md` — locate the three update sites (Maestro test list, Known Issues, Workflow infrastructure).
5. `reviews/README.md` — locate the calibration notes section.
6. `git status` — confirm `mobile/components/FeedbackFAB.tsx` is the only working-tree change and is the in-tree overlay refactor.

### 2. Commit 1 — refactor

```bash
cd /Users/mizzy/Developer/Trivolta
git add mobile/components/FeedbackFAB.tsx
git commit -m "refactor: replace native Modal with in-tree overlay (does not fix test_27)

The feedback modal previously rendered via React Native's <Modal>, which
hosts content in a separate UIViewController on iOS. The replacement is a
conditional sibling <View> with overlayAbsolute styling — same visual
presentation, same testIDs, same behavior, but more inspectable and not
dependent on the native Modal lifecycle.

This change does NOT resolve test_27. Diagnosis confirmed the Maestro
test failure root cause is upstream of the modal: synthetic taps on the
feedback FAB do not reach its React onPress handler under
react-native-screens 4.16 + newArchEnabled. The FAB works correctly for
real human users (verified 2026-05-02). test_27 is deferred via
SKIP_TESTS in run_tests.sh; see INSTRUCTIONS_TEST_27_DEFER.md."
```

### 3. Commit 2 — defer test_27

Make the YAML header comment edit. Make the `run_tests.sh` SKIP_TESTS edit. Verify behavior:

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
./run_tests.sh                       # should report 26 passed, 0 failed, 1 skipped
./run_tests.sh test_27_feedback_submit.yaml  # should still run (and fail)
```

Commit:

```bash
cd /Users/mizzy/Developer/Trivolta
git add mobile/maestro/test_27_feedback_submit.yaml mobile/run_tests.sh
git commit -m "test: defer test_27_feedback_submit (non-automatable under current arch)

Maestro synthetic taps do not reach the feedback FAB's onPress handler
under react-native-screens 4.16 + newArchEnabled: true. The FAB works
correctly for real users (manually verified). Adds SKIP_TESTS mechanism
to run_tests.sh patterned on the existing test_18 deferral. Single-file
mode (./run_tests.sh test_27_feedback_submit.yaml) still runs the test
to support manual verification.

Manual verification required before each beta release; see CLAUDE.md
\"Manual Test Verification\" section."
```

### 4. Commit 3 — documentation

Make the CLAUDE.md, TRIVOLTA_TRACKER.md, and reviews/README.md edits per the verifiable objective.

```bash
git add CLAUDE.md TRIVOLTA_TRACKER.md reviews/README.md
git commit -m "docs: document test_27 defer + manual verification protocol

CLAUDE.md gains a Manual Test Verification section listing test_18 and
test_27 with the manual checks required before each beta release.
TRIVOLTA_TRACKER.md updates the Maestro test list, Known Issues, and
Workflow infrastructure sections. reviews/README.md gets a one-line
calibration entry."
```

### 5. Standard pipeline tail

```bash
cd /Users/mizzy/Developer/Trivolta
bash simplify-and-verify.sh
bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_TEST_27_DEFER.md
```

### 6. Stop. Do not push.

Mac Claude reviews the diff against the four criteria. Mike pushes after approval.

## Verification

Final report Claude Code returns:

- The three commit SHAs (refactor, test, docs) and their messages.
- `git log --oneline -10`.
- Output of `./run_tests.sh` showing `26 passed, 0 failed, 1 skipped` (or 2 skipped if test_18 was also added).
- Output of `./run_tests.sh test_27_feedback_submit.yaml` confirming single-file mode still runs the test.
- TypeScript pass/fail.
- Pipeline tail outputs (`simplify-and-verify.sh` and `run-review.sh`).
- Path to this task's review file at `reviews/<latest-HEAD-sha>.md` and its YAML verdict.
- Confirmation that `git status --porcelain` is empty modulo the new review file.

After Mac Claude approves, Mike pushes. With this landed, **F4 (Render Edge Function — Tranche 2) is the next work item.** No more test-stack distractions.

---

Read INSTRUCTIONS_TEST_27_DEFER.md and execute all steps exactly as written.
