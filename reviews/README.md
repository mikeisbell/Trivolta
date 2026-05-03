# reviews/

Append-only directory of automated conformance reviews. Every commit on a
development task gets one file here, written by a `claude -p` subprocess
launched from `run-review.sh`. The artifact is the audit trail: it records
what the diff did, what the spec asked for, and where they diverged.

This scaffolding was first wired up against `claude --version` 2.1.126.
<!-- smoke-test: pipeline self-review marker -->


## Filename convention

`reviews/<commit-sha>.md` — full 40-char SHA, not the short form. One file
per reviewed commit. Re-runs require `--force` and overwrite in place; new
runs never append a suffix.

A second file may exist alongside the review:

`reviews/<short-sha>.simplify-log.md` — forensic log from
`simplify-and-verify.sh`. Present when `/simplify` actually ran (whether
or not its changes survived). Owned by `simplify-and-verify.sh`; never
edited by hand.

## YAML front matter schema

Every `<sha>.md` file begins with this front matter, in this order:

```yaml
---
commit: <full sha>
branch: <branch name>
instructions_file: <path or "none">
reviewer_model: claude-sonnet-4-6
verdict: approve | comment | request_changes
findings_count: <int>
blockers_count: <int>
generated_at: <ISO-8601 UTC>
---
```

`reviewer_model` is fixed to `claude-sonnet-4-6` regardless of the local
`claude` CLI version — the CLI version is informative and is recorded
in this README's preamble, not per-review.

The reviewer subprocess has full read access to the Trivolta repository
(`run-review.sh` passes `--add-dir <repo-root>` to `claude -p`). Reviews
after 2026-05-02 may reference files outside the diff. The chore-commit
review limitation noted in earlier reviews — that conformance items
implemented in prior commits couldn't be confirmed from the chore
artifact alone — no longer applies: chore-commit reviewers can now
read the feature commit's actual changes if relevant.

## Body sections (in order)

1. `# Code review — <short sha>`
2. `## Verdict` — one paragraph; states `approve`, `comment`, or
   `request_changes` and the one-line reason.
3. `## Findings` — numbered list. Each finding is tagged
   `[blocker]`, `[suggestion]`, or `[nit]`. A finding becomes `[blocker]`
   only for: spec violations, missing verifiable-objective items,
   security issues, data-loss risks, RLS bypass, or breaking changes to
   API surface. Style nits and refactor hints are `[nit]` or
   `[suggestion]` and never affect the verdict.
4. `## Constraint compliance` — checkbox list, one per criterion from
   `WORKFLOW.md`'s "Diff Review — Four Criteria":
   - [ ] Objective met
   - [ ] Constraints not violated
   - [ ] No unintended files modified
   - [ ] CLAUDE.md additions justified
5. `## Spec coverage` — one paragraph or short list summarising which
   verifiable-objective items the diff satisfies and which (if any) are
   missing.

## Verdict → exit code (run-review.sh)

| Verdict             | Exit | Meaning                                          |
|---------------------|-----:|--------------------------------------------------|
| `approve`           |    0 | No findings.                                     |
| `comment`           |    0 | Findings exist but none are blockers.            |
| `request_changes`   |    2 | At least one `[blocker]`. Implementer must fix.  |
| (missing/malformed) |    3 | Manual inspection required.                      |

Implementer Claude Code never edits files under `reviews/` except via
`run-review.sh`. `simplify-log.md` files are owned by
`simplify-and-verify.sh`. Hand-editing breaks the audit trail.

## Calibration notes

**2026-05-02 — F3 Blocker 1 verification (INSTRUCTIONS_F3_BLOCKER1_TEST_28_SEED.md).**
The full-repo-access reviewer flagged a `[blocker]` against `a69392e`
claiming test_28 fails on a fresh DB. **Verified: confirmed real.**
Two surrounding findings surfaced during verification, both important:

1. **Reviewer's blocker is genuinely correct.** `supabase db reset`
   produces a DB with zero facts (because `supabase/seed.sql` is
   empty). `get_next_spot_check_fact()` returns no rows. The spot-check
   screen renders the empty state and `spot-check-fact-text` never
   appears. Maestro times out on the assertion. Fix: new
   `mobile/maestro/scripts/ensure_spot_check_facts.js` runScript step
   in test_28 that idempotently seeds one category + three pending
   facts + three active distractors per fact via the service-role REST
   API.
   **Resolved 2026-05-02 in commit `0d82516` — `ensure_spot_check_facts.js` seeds 1 category + 3 facts + 9 distractors before test_28.**

2. **`run_tests.sh` masks Maestro failures via the unguarded pipe.**
   The runner does `if maestro test ... | tee -a "$LOG"; then ...`.
   Without `set -o pipefail`, the pipeline's exit code is `tee`'s,
   not maestro's. So when maestro fails the assertion, the script
   still reports `[Passed]`. test_28 had been "passing" in this
   masked sense from F3 onward. The reviewer's flag was actually
   conservative — the real-world failure rate was 100%, not 0%.
   **This is out of the F3 Blocker 1 spec scope** but is a
   higher-priority follow-up than any feature work; suggest a
   separate INSTRUCTIONS file to add `set -o pipefail` (or
   `${PIPESTATUS[0]}` checks) to `run_tests.sh`.
   **Resolved 2026-05-02 in commit `0821da0` — `set -o pipefail` added to `run_tests.sh`. First post-fix full-suite run reported 26 passed, 1 failed; the newly-visible failure is test_27_feedback_submit (FAB modal body input not visible to Maestro after tap), masked since F2 ship and now triaged in a follow-up INSTRUCTIONS file.**

3. **Spot-check screen has a real keyboard-dismiss bug** independent
   of the seeding issue. `mobile/app/admin/facts/spot-check.tsx` wraps
   its content in a `ScrollView` with no
   `keyboardShouldPersistTaps="handled"`. React Native's default
   ('never') makes the first tap on the Submit-report button (after
   focusing the note input) dismiss the keyboard instead of firing
   `onPress`. The submit therefore never reaches the API on the
   "incorrect" verdict path. The spec scope forbids modifying the
   screen, so the test_28 fix uses Maestro's documented fallback
   (tap a non-interactive Text element to dismiss the keyboard, then
   tap Submit). The user-facing impact is real — a human user typing
   a report and tapping Submit once will get the same swallowed-tap
   behavior. Suggest a follow-up INSTRUCTIONS file to add
   `keyboardShouldPersistTaps="handled"` to the ScrollView.
   **Resolved 2026-05-02 in commit `0821da0` — `keyboardShouldPersistTaps="handled"` added to the spot-check ScrollView; test_28's tap-elsewhere workaround removed. Real users get the natural single-tap Submit flow.**

Future reviews of seeding-dependent tests should use the same pattern:
verify the failure mode end-to-end against `./run_tests.sh` AND check
the raw Maestro output for `FAILED` lines (because of finding 2 above)
before flagging or dismissing.

**2026-05-02 — test_27 deferred (INSTRUCTIONS_TEST_27_DEFER.md).** The newly-visible test_27 failure surfaced by the F3 follow-up's pipefail fix was diagnosed extensively. Initial hypothesis (RN's `<Modal>` separate UIViewController hides testIDs from Maestro) was refuted by evidence — a tap counter in the FAB's `accessibilityLabel` never incremented past zero across multiple Maestro runs and four within-spec workarounds (TouchableOpacity, Pressable, fullscreen `pointerEvents="box-none"` wrapper, `zIndex+elevation`). Root cause: `react-native-screens` 4.16 with `newArchEnabled: true` renders each route's screen as a native `UIViewController` that sits ABOVE the FAB in iOS view-event z-order; Maestro's accessibility tree finds the FAB but iOS routes the synthetic tap to the screen content. The standard escape hatch (`<FullWindowOverlay>`) lifts the FAB but ALSO removes every other testID from Maestro (suite reported only `Wi-Fi bars`) — also unviable. The FAB works for real human users (manually verified). Resolution: keep the Modal → in-tree-overlay refactor as an architectural improvement (committed as `f400d0e`); defer test_27 via `SKIP_TESTS` in `run_tests.sh` (committed as `1bee356`); document manual-verification protocol in CLAUDE.md.
