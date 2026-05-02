# INSTRUCTIONS — Review Pipeline Fixes (post-bootstrap)

## Task

The automated code review pipeline shipped in `INSTRUCTIONS_AUTOMATED_REVIEW.md` works end-to-end but its bootstrap smoke test surfaced two real defects that block it from being genuinely self-running. Fix both before the pipeline reviews any production-feature commit.

**Defect A — `claude /simplify` runs semi-interactively.** The smoke run captured `/simplify` emitting suggestions and then asking permission to apply them. The subprocess was supposed to be non-interactive. Effect: real simplifications never land automatically; the forensic log records what *would have* been changed, but the working tree is never actually updated. The reviewer subprocess flagged this as `[suggestion]` on commit `15e726f`, and the smoke-test forensic log at `reviews/81c59d8.simplify-log.md` has `/simplify`'s own self-reported reason ("I need your permission to edit `simplify-and-verify.sh`"). The pipeline produces an audit artifact but no actual code improvements — that's not the design.

**Defect B — Forensic log path collides with the clean-tree precondition.** `simplify-and-verify.sh` writes `reviews/<short-sha>.simplify-log.md` *before* the verification suite runs. On any subsequent invocation, that file is an untracked working-tree change. The script's first guard is `if [[ -n "$(git status --porcelain)" ]]; then exit 1`. The smoke run worked only because there were no subsequent runs. The next real task will hit this.

This INSTRUCTIONS file fixes both defects. No new files. No new dependencies. Both fixes are local edits to `simplify-and-verify.sh` plus one short test commit at the end to verify the pipeline self-runs cleanly twice in a row.

This is **local-only work**. No CI, no production impact.

## Verifiable objective

### Defect A — non-interactive `/simplify`

- [ ] `simplify-and-verify.sh` invokes `claude /simplify` with the flag (or flag combination) that makes the slash command apply edits without prompting for user permission. The implementer determines the exact correct flag against the installed `claude` version (currently 2.1.126) — see Steps for the version-detection and flag-discovery procedure.
- [ ] The flag is documented inline in the script as a comment naming the flag, the `claude` version it was tested against, and a one-line explanation of why it's needed.
- [ ] The flag is the **least-permissive** flag that achieves the goal. If the only viable option is `--dangerously-skip-permissions` (or equivalent broad flag), the script wraps the `/simplify` invocation in a tighter scope: only the simplify-and-verify.sh subprocess gets the flag, never inherited by anything else. The script header gains a security note explaining the choice.
- [ ] The flag is sourced from a constant near the top of the script (e.g. `CLAUDE_SIMPLIFY_FLAGS=(...)` array), not inlined at the call site. Future flag changes happen in one place.
- [ ] If no satisfactory flag exists in the installed `claude` version, the script logs a clear message ("`/simplify` cannot run non-interactively in this `claude` version; falling back to dry-run mode"), forces `DRY_RUN=true` for that invocation, and continues. This is the documented graceful-degradation path; do NOT fail the script.

### Defect B — forensic log path

- [ ] `simplify-and-verify.sh` writes the forensic log to a path **outside the working tree** during the run. Default location: `${TMPDIR:-/tmp}/trivolta-simplify-logs/<short-sha>.md`. The directory is created if missing.
- [ ] After `simplify-and-verify.sh` decides whether to commit or revert, the log is **copied** (not moved) into `reviews/<short-sha>.simplify-log.md` and the copy is staged + committed as part of the same commit that lands `/simplify`'s changes (when accepted) OR as part of a fresh `chore: /simplify reverted — <short-sha>` commit (when verification breaks and changes are reverted).
- [ ] If `/simplify` produced no changes at all, the log is still copied into `reviews/<short-sha>.simplify-log.md` and committed as `chore: /simplify ran clean — <short-sha>`. This way every invocation produces a tracked artifact and the working tree is always clean afterwards.
- [ ] The original out-of-tree log file at `${TMPDIR:-/tmp}/trivolta-simplify-logs/<short-sha>.md` is left in place after the script exits — it's the forensic copy. The repo copy is the durable audit trail.
- [ ] The script's clean-tree precondition runs unchanged. The new log location ensures the precondition is never tripped by the script's own output.
- [ ] The "no simplifications suggested" branch and the "reverted" branch both end with `git status --porcelain` empty.

### Behavior summary table

After this fix, the three outcomes of `simplify-and-verify.sh` are:

| Outcome | Working tree | Repo state after | Commits added |
|---|---|---|---|
| `/simplify` made changes, verification passed | clean | new chore commit with code + log | 1 (`chore: /simplify — <sha>`) |
| `/simplify` made changes, verification failed | clean (reset) | new chore commit with log only | 1 (`chore: /simplify reverted — <sha>`) |
| `/simplify` made no changes | clean | new chore commit with log only | 1 (`chore: /simplify ran clean — <sha>`) |

All three outcomes leave a `chore:` commit. The next `simplify-and-verify.sh` run starts on a clean tree every time. No exceptions.

### CLAUDE.md / WORKFLOW.md updates

- [ ] WORKFLOW.md's "Code Review Phase" section gets a one-paragraph addendum noting the three-outcome behavior table above. The exit-code table is unchanged (still always 0 unless pre-flight error).
- [ ] CLAUDE.md's "Code Review Phase" section gets a one-line addition: "Every `simplify-and-verify.sh` run produces exactly one `chore:` commit. The audit trail is dense by design."
- [ ] No other doc edits.

### Verification (mandatory two-run pipeline self-test)

- [ ] After the script edits, run `bash simplify-and-verify.sh` once on the current HEAD. Expected: a `chore:` commit lands (one of the three variants), working tree clean afterwards.
- [ ] Run `bash simplify-and-verify.sh` **a second time** with no other changes between runs. Expected: another `chore:` commit lands. Working tree clean afterwards. Exit 0 both times.
- [ ] If the second run fails with "uncommitted changes detected", Defect B is not fixed — go back and address before reporting done.
- [ ] After both `simplify-and-verify.sh` runs, run `bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_REVIEW_PIPELINE_FIXES.md` against the most recent commit. Expected: exit 0 (`approve` or `comment`), reviews/<sha>.md produced.
- [ ] `cd mobile && npx tsc --noEmit` exits 0.
- [ ] `cd mobile && ./run_tests.sh` reports 27 passed (unchanged baseline).
- [ ] `git status --porcelain` is empty (or only contains the new `reviews/<sha>.md` from `run-review.sh`, which is the standard "do not commit" stop).

## Constraints

- **Do not** add new files outside what's already in `reviews/`. The fix is two script edits and two doc edits.
- **Do not** add new dependencies.
- **Do not** change `run-review.sh` — Defect A and B are isolated to `simplify-and-verify.sh`.
- **Do not** change `simplify-verify.cmds`.
- **Do not** change the four review criteria, the YAML front-matter schema, or `reviews/PROMPT.md`.
- **Do not** weaken the clean-tree precondition. The fix is to stop polluting the tree, not to relax the check.
- **Do not** commit `/simplify` output without verification. The verification gate stays — `/simplify` is still advisory.
- **Do not** use `--dangerously-skip-permissions` if a less-permissive flag exists. If you do use it, document why no narrower flag worked.
- **Do not** modify any code under `mobile/`, `supabase/`, or `.github/`.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.
- **Do not** skip the two-run verification step. The whole point of this fix is that the pipeline self-runs; "ran once and it worked" does not prove the fix.

## Steps

### 1. Read existing files (no edits)

- `simplify-and-verify.sh` — the file being modified.
- `reviews/PROMPT.md`, `reviews/README.md` — confirm no edits needed (they're not).
- `WORKFLOW.md` `## Code Review Phase` — locate the addendum target.
- `CLAUDE.md` `## Code Review Phase` — locate the addendum target.
- `reviews/81c59d8.simplify-log.md` — read the exact `/simplify` interactive prompt to understand which permission system it's hitting.

### 2. Discover the correct non-interactive flag for `/simplify`

The installed `claude` version is `2.1.126` (per the bootstrap smoke test forensic log).

Run `claude --help` and capture the full output. Look for permission-related flags. As of recent Claude Code versions, the candidates worth considering, in order of preference:

1. `--permission-mode acceptEdits` — narrowest, only auto-accepts file edits.
2. `--permission-mode bypassPermissions` — broader, bypasses all permission prompts.
3. `--dangerously-skip-permissions` — broadest, full bypass.

Option 1 is preferred. If `claude --help` confirms it exists, use it. If only options 2 or 3 exist, use the narrowest available.

To verify the chosen flag actually works for `/simplify`, run a one-off test before editing the script:

```bash
cd /Users/mizzy/Developer/Trivolta
# Make any small staged change, then test:
echo "test" >> /tmp/throwaway.txt
claude -p '/simplify' --output-format text --permission-mode acceptEdits 2>&1 | head -20
```

(Do not run this against the real working tree — point `claude` at a throwaway directory, or expect `/simplify` to suggest changes you don't want. The point of this test is to confirm the flag is accepted and `/simplify` does not pause for permission. Discard whatever output is produced.)

If the chosen flag works, document it in the script per the verifiable objective. If none of the three flags work non-interactively in 2.1.126, escalate by stopping the task and reporting findings — do not push forward with a flag that still pauses.

### 3. Edit `simplify-and-verify.sh` for Defect A

Add near the top of the script, after the constants block:

```bash
# /simplify non-interactive flags. Tested against claude 2.1.126.
# Without these flags, claude -p '/simplify' pauses asking for edit
# permission and the subprocess hangs. The narrowest flag that works
# in 2.1.126 is <chosen flag>. See INSTRUCTIONS_REVIEW_PIPELINE_FIXES.md
# for the discovery procedure.
CLAUDE_SIMPLIFY_FLAGS=(--output-format text <chosen flag>)
```

Replace the existing invocation:

```bash
claude -p '/simplify' --output-format text >> "$LOG_FILE" 2>&1
```

with:

```bash
claude -p '/simplify' "${CLAUDE_SIMPLIFY_FLAGS[@]}" >> "$LOG_FILE" 2>&1
```

If during Step 2 you discovered that no flag works non-interactively, instead implement the graceful-degradation path: detect interactive output (e.g. grep the log for the literal string `"I need your permission"` or `"Please approve"` after the subprocess returns), and if found, log "fell back to dry-run mode" and force `DRY_RUN=true` for the rest of the script. The script then exits 0 without committing anything.

### 4. Edit `simplify-and-verify.sh` for Defect B

Add near the constants block:

```bash
# Forensic log lives outside the working tree until we know whether
# we're committing or reverting. After the decision, we copy it into
# reviews/<short-sha>.simplify-log.md as part of a single chore commit.
EXTERNAL_LOG_DIR="${TMPDIR:-/tmp}/trivolta-simplify-logs"
mkdir -p "$EXTERNAL_LOG_DIR"
EXTERNAL_LOG="$EXTERNAL_LOG_DIR/${SHORT_SHA}.md"
REPO_LOG="$REVIEWS_DIR/${SHORT_SHA}.simplify-log.md"
```

Replace `LOG_FILE="$REVIEWS_DIR/${SHORT_SHA}.simplify-log.md"` with `LOG_FILE="$EXTERNAL_LOG"` so the entire script writes to the external location during the run.

Restructure the three terminal branches so each one ends with the same `commit_log_artifact` helper:

```bash
commit_log_artifact() {
  local commit_msg="$1"
  cp "$EXTERNAL_LOG" "$REPO_LOG"
  git add "$REPO_LOG"
  if [[ -n "$EXTRA_FILES_TO_STAGE" ]]; then
    git add -A
  fi
  git commit -m "$commit_msg" >/dev/null
}
```

The three branch endings become:

- **No simplifications suggested:**
  ```bash
  EXTRA_FILES_TO_STAGE=""
  commit_log_artifact "chore: /simplify ran clean — ${SHORT_SHA}"
  echo "no simplifications suggested (committed log artifact)"
  exit 0
  ```
- **Verification passed (simplifications accepted):**
  ```bash
  EXTRA_FILES_TO_STAGE="yes"
  commit_log_artifact "chore: /simplify — ${SHORT_SHA}"
  echo "simplification accepted, ${CHANGED_FILE_COUNT} files changed (committed log artifact)"
  exit 0
  ```
- **Verification failed (revert):**
  ```bash
  git reset --hard "$PRE_SIMPLIFY_SHA" >/dev/null
  EXTRA_FILES_TO_STAGE=""
  commit_log_artifact "chore: /simplify reverted — ${SHORT_SHA}"
  echo "simplification reverted (verification failed; committed log artifact)"
  exit 0
  ```

The pseudocode above is illustrative — adapt to the actual variable names in the existing script. The invariant is: **every successful exit ends with `git status --porcelain` empty and a new `chore:` commit on HEAD**.

The `--dry-run` flag's behavior changes too: it should still produce the external log but should NOT copy or commit it. Mike or Claude Code can manually inspect `$EXTERNAL_LOG` after a dry run.

### 5. Update WORKFLOW.md

Use `Filesystem:edit_file` to add this paragraph at the end of the `## Code Review Phase` section, before the exit-code table:

```
Every successful `simplify-and-verify.sh` run lands exactly one `chore:` commit on HEAD: `chore: /simplify — <sha>` (changes accepted), `chore: /simplify reverted — <sha>` (changes failed verification and were reset), or `chore: /simplify ran clean — <sha>` (no changes suggested). The forensic log is committed under `reviews/<sha>.simplify-log.md` in all three cases. The next run always starts on a clean working tree.
```

### 6. Update CLAUDE.md

Use `Filesystem:edit_file` to add one line at the end of the `## Code Review Phase` section:

```
Every `simplify-and-verify.sh` run produces exactly one `chore:` commit and leaves the working tree clean. The audit trail is dense by design.
```

### 7. Verification

Run, in order:

1. `cd mobile && npx tsc --noEmit` — confirm baseline.
2. `cd mobile && ./run_tests.sh` — confirm 27/27 baseline.
3. `bash simplify-and-verify.sh` — first run. Expect a `chore:` commit. Capture the script's stdout verbatim.
4. `git status --porcelain` — must be empty.
5. `bash simplify-and-verify.sh` — second run, immediately. Expect another `chore:` commit. This is the actual fix verification: pre-fix, this would have failed at the clean-tree check.
6. `git status --porcelain` — must be empty.
7. `bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_REVIEW_PIPELINE_FIXES.md` — produce the conformance review for the most recent commit (the second `chore:` commit).
8. `git log --oneline -8` — capture the commit chain showing both new `chore:` commits.
9. `cd mobile && npx tsc --noEmit && cd .. && cd mobile && ./run_tests.sh` — re-verify baseline still clean.
10. `git diff origin/main..HEAD --stat` — confirm only the script + two doc edits + the new chore commits + the new review file.

### 8. Stop. Do not push.

Mac Claude reviews the diff against the four criteria. After approval, Mike pushes.

## Verification

Final report Claude Code returns:

- `claude --help` excerpt showing the chosen flag and confirmation it exists in 2.1.126.
- The exact `CLAUDE_SIMPLIFY_FLAGS` line that landed in the script.
- Stdout of the first `simplify-and-verify.sh` run (full).
- Stdout of the second `simplify-and-verify.sh` run (full) — this is the smoking gun for Defect B fix.
- `git status --porcelain` after each `simplify-and-verify.sh` run (must be empty both times).
- `git log --oneline -8` showing the new commits.
- Path to the produced `reviews/<sha>.md` and its YAML verdict line.
- TypeScript pass/fail.
- Maestro count (27 expected).

After Mac Claude approves the diff, this work is done. The pipeline is now genuinely self-running. F4 (Tranche 2) becomes safe to start.

---

Read INSTRUCTIONS_REVIEW_PIPELINE_FIXES.md and execute all steps exactly as written. The Verification section's mandatory tail (`bash simplify-and-verify.sh` + `bash run-review.sh ...`) applies, but note that for THIS task the simplify-and-verify run IS the verification — running it twice in step 7 satisfies both the task verification and the standard tail.
