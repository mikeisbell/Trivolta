# INSTRUCTIONS — F3 Blocker 1 Follow-up Fixes (3 bundled)

## Task

The F3 Blocker 1 work surfaced three additional defects, one of which is critical to project hygiene. Fix all three in a single small commit:

1. **`run_tests.sh` exit-code masking (CRITICAL).** `if maestro test ... | tee -a "$LOG"; then` evaluates `tee`'s exit code, not maestro's. The runner has been silently reporting `[Passed]` for every failed test since at least F2. Until this is fixed, every Maestro green from now on is suspect, and F4's "Maestro passes" claim is meaningless. Fix: set `pipefail` and check `${PIPESTATUS[0]}` so the script tracks maestro's exit, not tee's.

2. **Spot-check screen `keyboardShouldPersistTaps` bug (USER-FACING).** `mobile/app/admin/facts/spot-check.tsx` wraps its content in a `<ScrollView>` with default `keyboardShouldPersistTaps='never'`. After a user types into the note `TextInput` and taps "Submit report", the first tap dismisses the keyboard instead of firing `onPress`. Submit therefore needs two taps for a real user. test_28 currently works around this with a Maestro tap-elsewhere-first pattern. Fix: add `keyboardShouldPersistTaps="handled"` to the `ScrollView`. Once this lands, the test_28 workaround can be removed (Step C).

3. **`ensure_spot_check_facts.js` partial-seed indexing bug (LATENT).** When `have > 0 && have < 3`, the distractor insert loop reads `seed.distractors[d]` starting at index 0, duplicating already-present rows. The `distractors` table has no unique constraint on `(fact_id, distractor_text)`, so the duplicate inserts silently succeed and corrupt seed state. Fresh-DB and fully-seeded paths both work; only the partial-seed path is broken. Fix: index from `have + d` so the loop continues where the prior partial run left off.

This is **local-only work**. No CI, no production. Three small file edits and one test_28 simplification.

## Verifiable objective

### Fix 1 — `run_tests.sh` exit-code masking

- [ ] `mobile/run_tests.sh` no longer silently reports `[Passed]` when maestro fails.
- [ ] Implementation: add `set -o pipefail` near the top of the script (after the existing `set -a` / `source` block, since `set -a` is already in use). Alternative if pipefail conflicts with anything: change the `if maestro test ... | tee -a "$LOG"; then` block to capture maestro's exit code via `${PIPESTATUS[0]}` and branch on that. Pick the simpler one that works; document the choice in a one-line comment.
- [ ] The summary block (`Suite summary: $passed passed, $failed failed`) accurately reflects which tests passed and failed — verified by deliberately running a known-failing test as part of the verification step.
- [ ] The script's existing CLI behavior (single-file mode `./run_tests.sh test_NN.yaml`, full suite mode, exit code from the final `[ "$failed" -eq 0 ]`) is preserved.

### Fix 2 — Spot-check screen keyboard handling

- [ ] `mobile/app/admin/facts/spot-check.tsx`'s sole `<ScrollView>` (the one wrapping the fact + buttons + note input) gets `keyboardShouldPersistTaps="handled"` added as a prop.
- [ ] No other styling or behavior changes to the screen.
- [ ] No changes to any other admin screen, even if some have similar latent issues — those are out of scope for this task.

### Fix 3 — `ensure_spot_check_facts.js` partial-seed indexing

- [ ] In `mobile/maestro/scripts/ensure_spot_check_facts.js`, the distractor insert loop indexes `seed.distractors[have + d]` instead of `seed.distractors[d]`.
- [ ] A short inline comment above the loop explains the indexing: "Continue where a prior partial run left off; do not re-insert distractors already present."
- [ ] Idempotency property holds for all three states: fresh DB (have=0, need=3 → inserts indexes 0,1,2), partial state (have=1, need=2 → inserts indexes 1,2), fully-seeded (have=3, need=0 → no insert).

### test_28 simplification (only after Fix 2 lands)

- [ ] After Fix 2 is in the working tree, edit `mobile/maestro/test_28_spot_check.yaml` to remove the keyboard-dismissal workaround that taps `spot-check-correct` to dismiss the keyboard before tapping `spot-check-submit-incorrect`. The flow becomes the natural sequence: type into the note input, tap submit, assert the toast/banner.
- [ ] If the workaround was implemented as a comment plus a tap, both go. If the comment is informative for future readers, replace it with a one-line note: "Note: keyboardShouldPersistTaps='handled' on the spot-check ScrollView is what makes the natural single-tap flow work."
- [ ] No other changes to test_28's flow.

### Calibration note update

- [ ] Append a "**Resolved:**" line to each of findings 2 and 3 in `reviews/README.md`'s Calibration notes section, citing the new fix-commit SHA. Format:
  > **Resolved 2026-05-02 in commit `<sha>` — <one-line summary>.**
- [ ] Finding 1 (the original F3 Blocker 1 about test_28 and seed.sql) was already resolved by the prior commit; that note also gets a **Resolved** line citing its commit (the F3 Blocker 1 fix commit SHA — see Steps for the lookup).
- [ ] No other edits to `reviews/README.md`.

### Verification (mandatory; this is the whole point)

- [ ] Run `cd mobile && ./run_tests.sh test_27_feedback_submit.yaml` to deliberately exercise a failure path (test_27 has been "passing" while actually failing — this is the natural deliberate-failure case). Expected outcome:
  - Before Fix 1 lands: script prints `[Passed] test_27` even though maestro logs show the failure. (Skip this dry-run if obvious; it's optional.)
  - After Fix 1 lands: script prints `[Failed] test_27` and the summary reports 0 passed, 1 failed.
- [ ] Run `cd mobile && ./run_tests.sh test_28_spot_check.yaml` after all three fixes. Expected: actually passes (now without the keyboard-dismissal workaround), with the script accurately reporting `[Passed] test_28`.
- [ ] Run the full suite: `cd mobile && ./run_tests.sh`. Expected outcome **changes from prior runs** because previously-masked failures will now be visible. Capture the real pass/fail count. Record which tests are now showing as failing that were previously masked.
- [ ] **Important nuance:** the full-suite run AFTER this fix may show a number of newly-visible failures. That is the point. Do NOT panic-fix any of them. Record them in the calibration note as "newly-visible after Fix 1 — triage in subsequent INSTRUCTIONS files."
- [ ] `cd mobile && npx tsc --noEmit` exits 0 (sanity check; this task touches one TSX file).

### Tracker
- [ ] Add `✅ F3 Blocker 1 follow-ups — INSTRUCTIONS_F3_FOLLOWUP_FIXES.md (run_tests.sh pipefail, keyboardShouldPersistTaps, partial-seed indexing)` under `## Workflow infrastructure`.
- [ ] Add `✅ INSTRUCTIONS_F3_FOLLOWUP_FIXES.md` to the INSTRUCTIONS Files Written section.
- [ ] Update `## Known Issues / Tech Debt`: remove the line `**`run_tests.sh` exit-code masking** — when run without a booted iOS Simulator, the `tee` pipe masks `maestro test`'s non-zero exit code …`. (Replaced by this fix.)

## Constraints

- **Do not** modify the F3 spot-check screen beyond adding the one `keyboardShouldPersistTaps` prop. No restyling, no logic changes.
- **Do not** modify the F3 Edge Function, RPC, migration, or admin screen routing.
- **Do not** add `set -e` to `run_tests.sh` or change its existing exit-code semantics. The fix is exclusively about not masking maestro's exit through the `tee` pipe.
- **Do not** add a unique constraint to the `distractors` table. The partial-seed bug is fixed at the seed-script level, not by changing schema.
- **Do not** "fix" the newly-visible failing tests that emerge after Fix 1 lands. Surfacing them is the goal; triaging them is a separate task.
- **Do not** modify any other Maestro YAML files. Only test_28 changes (Step C).
- **Do not** add new dependencies.
- **Do not** modify CLAUDE.md or WORKFLOW.md. None of these fixes introduce a new project rule.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files (no edits)
1. `mobile/run_tests.sh` — current `tee`-pipe pattern.
2. `mobile/app/admin/facts/spot-check.tsx` — the ScrollView's current props.
3. `mobile/maestro/scripts/ensure_spot_check_facts.js` — the partial-seed loop.
4. `mobile/maestro/test_28_spot_check.yaml` — the keyboard-dismissal workaround pattern.
5. `reviews/README.md` calibration notes section.
6. `git log --oneline -10` — to find the F3 Blocker 1 fix commit SHA for the calibration-note "Resolved" line on finding 1.

### 2. Fix 1 — run_tests.sh

Edit `mobile/run_tests.sh`. The simplest fix is `set -o pipefail` added after the existing `set +a`. Verify it does not break any other behavior (the script is short — one read-through is enough).

If `pipefail` introduces unwanted failure modes (e.g. on the `: > "$LOG"` line or similar), fall back to the `${PIPESTATUS[0]}` pattern:

```bash
maestro test \
      --env SUPABASE_URL="$SUPABASE_URL" \
      --env SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
      "$file" 2>&1 | tee -a "$LOG"
local rc=${PIPESTATUS[0]}
if [ "$rc" -eq 0 ]; then
  echo "[Passed] $name" | tee -a "$LOG"
  return 0
else
  echo "[Failed] $name" | tee -a "$LOG"
  return 1
fi
```

Either approach is acceptable. Document the choice with a one-line comment.

### 3. Fix 2 — spot-check.tsx

Add `keyboardShouldPersistTaps="handled"` to the `<ScrollView style={styles.scroll} contentContainerStyle={styles.content}>` element. One-line edit.

### 4. Fix 3 — ensure_spot_check_facts.js

Change `seed.distractors[d]` to `seed.distractors[have + d]`. Add the one-line comment above the loop per the verifiable objective.

### 5. Simplify test_28

Now that Fix 2 is in the tree, remove the keyboard-dismissal workaround. Read the YAML, find the tap on `spot-check-correct` that exists solely to dismiss the keyboard before submit, remove it (or replace with the explanatory comment per the verifiable objective).

### 6. Calibration note "Resolved" lines

Edit `reviews/README.md`. For each of findings 1, 2, 3 in the Calibration notes section, append a `**Resolved <date> in commit `<sha>` — <summary>.**` line.

The fix-commit SHA for findings 2 and 3 will be this task's eventual commit — Claude Code generates the placeholder text first with `<this commit>` as the SHA, runs verification, commits, then amends or follow-up-edits the README to insert the real SHA. (Cleaner alternative: do all the file edits, commit them, capture the SHA via `git rev-parse HEAD`, then edit README + amend the commit. Pick whichever is cleaner.)

The fix-commit SHA for finding 1 is the F3 Blocker 1 fix commit, found via `git log --oneline -10 | grep "F3 Blocker 1"`.

### 7. Verification

```bash
cd /Users/mizzy/Developer/Trivolta
cd mobile

# Sanity: TypeScript clean.
npx tsc --noEmit

# Single-test deliberate-failure check (Fix 1 verification):
./run_tests.sh test_27_feedback_submit.yaml ; echo "Exit: $?"
# Expected: "[Failed] test_27_feedback_submit", non-zero exit.

# Single-test pass-path check (Fix 2 verification):
./run_tests.sh test_28_spot_check.yaml ; echo "Exit: $?"
# Expected: "[Passed] test_28_spot_check", exit 0. The natural single-tap
# Submit-report flow now works because of keyboardShouldPersistTaps.

# Full suite (Fix 1 surfaces previously-masked failures):
./run_tests.sh ; echo "Exit: $?"
# Capture: which tests now fail that previously "passed".
```

### 8. Standard pipeline tail

```bash
cd /Users/mizzy/Developer/Trivolta
bash simplify-and-verify.sh
bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_F3_FOLLOWUP_FIXES.md
```

### 9. Stop. Do not push.

Mac Claude reviews the diff against the four criteria.

## Verification

Final report Claude Code returns:

- The chosen Fix 1 approach (`pipefail` vs `PIPESTATUS`) and the one-line rationale.
- Stdout of the deliberate-failure run on test_27 (proving Fix 1 works).
- Stdout of test_28 run (proving Fix 2 works without the workaround).
- Stdout of the full suite run after fixes — the **real** pass/fail count, with which tests are now showing as failing that were previously masked. **Do not fix them.**
- TypeScript pass/fail.
- Path to this task's review file at `reviews/<latest-HEAD-sha>.md` and its YAML verdict.
- `git status --porcelain` (should be empty modulo the new review file).
- `git log --oneline -8` showing the new commits.

Mike pushes after approval. Then F4 (Tranche 2) is gated on triaging the newly-visible failures from the full-suite run. The newly-visible failures get a separate INSTRUCTIONS file ("INSTRUCTIONS_MAESTRO_FAILURE_TRIAGE.md") if there are any — Mac Claude drafts that next session, after seeing the actual failure list.

---

Read INSTRUCTIONS_F3_FOLLOWUP_FIXES.md and execute all steps exactly as written.
