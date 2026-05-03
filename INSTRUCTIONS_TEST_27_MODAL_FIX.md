# INSTRUCTIONS — test_27 fix: replace native Modal with in-tree overlay

## Task

`test_27_feedback_submit` has been failing since F2 ship. The masked-pipe bug in `run_tests.sh` hid it; with the F3 follow-up's `pipefail` fix, it's now visible (and actionable).

**Root cause.** React Native's `<Modal>` on iOS renders inside a separate `UIViewController` outside the React tree. Maestro's view-inspector traversal does not reliably descend into that controller. The `feedback-body-input` testID exists in the React tree but is invisible to Maestro's `assertVisible` after `tapOn: feedback-fab` opens the modal. The test then times out.

This is a known React Native + Maestro interaction; the standard fix is to render the modal as an in-tree absolutely-positioned overlay rather than via the native `<Modal>` component. The visual presentation is identical; the implementation is a sibling `<View>` instead of a portal-like native window.

The fix is local to `mobile/components/FeedbackFAB.tsx`. testIDs, behavior, and visual styling stay exactly the same. Maestro now sees the testIDs because they live in the same view hierarchy as the FAB.

This is **local-only work**. Test-only impact — no schema, Edge Function, or other screens change.

## Verifiable objective

### FeedbackFAB component changes

- [ ] `mobile/components/FeedbackFAB.tsx` no longer imports or uses React Native's `<Modal>`. The `Modal` import is removed.
- [ ] The modal is replaced with an in-tree overlay: a sibling `<View>` rendered conditionally on `modalOpen`, absolutely-positioned (`position: 'absolute', top: 0, left: 0, right: 0, bottom: 0`) over the rest of the app, with the existing backdrop + card visual styling preserved exactly.
- [ ] The overlay uses `pointerEvents="auto"` on the backdrop so taps outside the card don't pass through to underlying screens.
- [ ] Tapping the backdrop (outside the card) does NOT close the modal. F2's spec did not include backdrop-tap-to-close, so we preserve current behavior — the user must tap Cancel or Send.
- [ ] The card itself uses `pointerEvents="auto"` (or default) so its inputs and buttons remain tappable.
- [ ] Hardware back button on Android: F2's `<Modal>` `onRequestClose` handled this. With the overlay there is no built-in equivalent, but Android is not a current Maestro target and not a beta platform. **Acknowledge in a code comment** that Android hardware-back will not close the overlay; this is a known limitation of the in-tree-overlay approach and is acceptable for beta scope. Do NOT add a `BackHandler` listener — that's out of scope for this fix.
- [ ] The FAB itself remains as-is: positioned absolutely, hidden when `fabHidden` is true.
- [ ] The overlay renders ABOVE the FAB visually. Since the FAB is rendered before the overlay in JSX and both are absolutely positioned at the root, achieve correct layering via render order (overlay JSX after the FAB JSX) plus `zIndex` if needed for web/Android consistency. iOS uses render order.
- [ ] All existing testIDs preserved exactly: `feedback-fab`, `feedback-body-input`, `feedback-include-state`, `feedback-error`, `feedback-cancel`, `feedback-send`, `feedback-toast`. No new testIDs added.
- [ ] All existing behavior preserved exactly: open via `openFeedback()`, validation (send disabled when body empty), submit success closes modal + shows toast, submit failure keeps modal open with inline error, state-snapshot toggle.
- [ ] The `useFeedback()` context API is unchanged.
- [ ] The toast continues to render at the root (above the overlay or alongside it — match current behavior; F2 has it as a sibling at the root, that pattern is preserved).
- [ ] No new dependencies. No `react-native-modal`, `react-native-portalize`, etc. Vanilla RN only.
- [ ] All existing styles preserved. The `modalBackdrop` and `modalCard` styles continue to apply; only the wrapping component (`<Modal>` → `<View>`) changes.

### test_27 verification

- [ ] Run `cd mobile && ./run_tests.sh test_27_feedback_submit.yaml` deliberately, capture the full Maestro output to confirm `feedback-body-input` is now visible after tapping the FAB.
- [ ] Expected: `[Passed] test_27_feedback_submit`, exit 0, all assertions including the final `assertNotVisible: feedback-body-input` reaching `COMPLETED`.
- [ ] No changes required to `test_27_feedback_submit.yaml`. The test was correct all along; only the implementation was unreachable.

### Full suite verification

- [ ] `cd mobile && ./run_tests.sh` reports `Suite summary: 27 passed, 0 failed`.
- [ ] No other tests regress. test_28 still passes; tests 01–26 still pass.

### TypeScript and tracker

- [ ] `cd mobile && npx tsc --noEmit` exits 0.
- [ ] `TRIVOLTA_TRACKER.md` updates:
  - `## Workflow infrastructure` (or similar appropriate location): add `✅ test_27 fix — INSTRUCTIONS_TEST_27_MODAL_FIX.md (replaces React Native <Modal> with in-tree overlay so Maestro can see testIDs inside the feedback modal; full suite now 27/27)`.
  - `## Known Issues / Tech Debt`: add a short entry: `Android hardware-back does not dismiss the feedback modal — known limitation of the in-tree-overlay approach. Add BackHandler listener if Android becomes a Maestro/beta target.`
  - INSTRUCTIONS Files Written section: `✅ INSTRUCTIONS_TEST_27_MODAL_FIX.md`.

### `reviews/README.md` calibration update

- [ ] Append a one-line resolution note to the test_27 mention (if any exists) OR simply leave the historical calibration notes as-is. The earlier calibration noted test_27 was a pre-existing failure outside scope. Add: `**Resolved 2026-05-02 in commit `<sha>` — replaced React Native <Modal> with in-tree overlay so Maestro sees testIDs.**` near the existing test_27 reference, if present. If no test_27 reference exists, no edit needed.

## Constraints

- **Do not** introduce a new dependency. No `react-native-modal`, `react-native-portalize`, `react-native-modalbox`, etc.
- **Do not** change any testID. Maestro relies on the exact strings.
- **Do not** change the visual presentation. Same backdrop color, same card layout, same fonts, same positioning. The user-visible modal must be indistinguishable from the F2 version.
- **Do not** modify any other screen, the `FeedbackProvider` mount point in `app/_layout.tsx`, the Edge Function, the `feedback_reports` table, the `submitFeedback` API wrapper, or any other Maestro YAML.
- **Do not** add backdrop-tap-to-close — that's a behavior change, not a fix.
- **Do not** add a `BackHandler` listener for Android. Out of scope; documented as a known limitation instead.
- **Do not** "improve" the modal visually — no animations, no new safe-area handling. Match the existing card exactly.
- **Do not** touch the `submit-feedback` Edge Function or the `feedback_reports` migration. The fix is purely client-side.
- **Do not** introduce a "portal" pattern via `useImperativeHandle`, `forwardRef`, or any other indirection. Plain conditional render of a sibling `<View>`.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files

1. `mobile/components/FeedbackFAB.tsx` — current implementation; identify exactly what to swap.
2. `mobile/maestro/test_27_feedback_submit.yaml` — confirm no test changes needed.
3. `mobile/app/_layout.tsx` — confirm `FeedbackProvider` mounts at root (no changes here).

### 2. Edit FeedbackFAB.tsx

The structural change is small. Inside the existing `FeedbackProvider` return JSX, replace:

```jsx
<Modal
  visible={modalOpen}
  animationType="fade"
  transparent
  onRequestClose={closeModal}
>
  <View style={styles.modalBackdrop}>
    <View style={styles.modalCard}>
      ... existing card contents ...
    </View>
  </View>
</Modal>
```

with a conditional sibling overlay:

```jsx
{modalOpen && (
  <View
    style={[styles.modalBackdrop, styles.overlayAbsolute]}
    pointerEvents="auto"
    // Note: Android hardware-back does not dismiss this overlay.
    // Known limitation — see INSTRUCTIONS_TEST_27_MODAL_FIX.md.
  >
    <View style={styles.modalCard} pointerEvents="auto">
      ... existing card contents (unchanged) ...
    </View>
  </View>
)}
```

Add to the StyleSheet:

```js
overlayAbsolute: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
},
```

The existing `modalBackdrop` style provides `flex: 1`, the dim background, and centering. Combined with `overlayAbsolute`, the overlay covers the full screen.

Remove the `Modal` import from the React Native imports list.

The toast remains rendered at the root, after the overlay JSX, unchanged.

### 3. Verify test_27

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
./run_tests.sh test_27_feedback_submit.yaml ; echo "Exit: $?"
```

Expected: `[Passed] test_27_feedback_submit`, exit 0. If still failing, capture the Maestro log and diagnose before reporting done — do not push forward with a still-failing test.

### 4. Verify full suite

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
./run_tests.sh ; echo "Exit: $?"
```

Expected: `Suite summary: 27 passed, 0 failed`, exit 0.

### 5. TypeScript

```bash
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit
```

### 6. Update tracker + calibration

Per the verifiable objective.

### 7. Standard pipeline tail

```bash
cd /Users/mizzy/Developer/Trivolta
bash simplify-and-verify.sh
bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_TEST_27_MODAL_FIX.md
```

### 8. Stop. Do not push.

Mac Claude reviews the diff against the four criteria. Mike pushes after approval.

## Verification

Final report Claude Code returns:

- Stdout of `./run_tests.sh test_27_feedback_submit.yaml` (proves Fix works).
- Stdout of full suite `./run_tests.sh` (proves no regressions).
- TypeScript pass/fail.
- Path to this task's review file at `reviews/<latest-HEAD-sha>.md` and its YAML verdict.
- `git status --porcelain` (should be empty modulo the new review file).
- `git log --oneline -8` showing the new commits.

After Mac Claude approves the diff, push. With test_27 green, **F4 (Render Edge Function — Tranche 2) is genuinely unblocked** and is the next work item.

---

Read INSTRUCTIONS_TEST_27_MODAL_FIX.md and execute all steps exactly as written.
