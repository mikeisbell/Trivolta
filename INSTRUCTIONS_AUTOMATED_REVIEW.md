# INSTRUCTIONS — Automated Code Review Phase

## Task

Add a fully-automated code-review phase to the Trivolta workflow. After every implementation task, the implementer Claude Code session runs two passes against its own changes before handing back to Mike:

1. **Quality pass** — `claude /simplify` runs against the recently-modified code. Suggested simplifications that survive a re-run of the verification suite are kept; anything that breaks verification is reverted.
2. **Conformance review pass** — a fresh `claude -p` subprocess reads the just-committed diff plus the matching `INSTRUCTIONS_*.md` plus `CLAUDE.md` plus `WORKFLOW.md`'s four review criteria, and writes a structured markdown review to `reviews/<commit-sha>.md`.

Both passes are local. No GitHub Action, no PR, no remote service. The implementer Claude Code session orchestrates everything via subprocess invocations and exits when the review file is on disk.

The deliverable here is the **infrastructure and documentation** that makes those two passes mandatory and uniform across all future INSTRUCTIONS files. It is NOT a one-off; it changes the project workflow permanently.

This INSTRUCTIONS file is the only one that touches the workflow itself, so it is unusually documentation-heavy. After it lands, every future INSTRUCTIONS file's "Verification" section gains two new mandatory final steps. WORKFLOW.md is where the contract lives.

This is **local-only work**. No new dependencies, no remote services, no CI integration. Uses `claude` CLI (already installed for both Mac Claude and Claude Code use cases) and the existing repo working tree.

## Verifiable objective

### Reviews directory and schema docs
- [ ] `reviews/.gitkeep` exists.
- [ ] `reviews/README.md` exists and documents:
  - The directory's purpose (one paragraph).
  - The filename convention `reviews/<commit-sha>.md` (full SHA, not short).
  - The YAML front-matter schema:
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
  - The required body sections in order: `# Code review — <short sha>`, `## Verdict`, `## Findings` (numbered list, each finding tagged `[blocker]`, `[suggestion]`, or `[nit]`), `## Constraint compliance` (checkbox list), `## Spec coverage` (one paragraph or short list).
  - The verdict-to-exit-code mapping documented in `run-review.sh` (request_changes → non-zero, approve/comment → zero).
  - One-line note: `simplify-log.md` may also exist alongside the review file when `/simplify` made changes that survived verification.
- [ ] `reviews/PROMPT.md` exists. This is the canonical conformance-review prompt the subprocess receives. It includes placeholders `{{COMMIT_SHA}}`, `{{INSTRUCTIONS_FILE}}`, `{{DIFF}}`, `{{CLAUDE_MD}}`, `{{WORKFLOW_CRITERIA}}`. The prompt explicitly instructs the reviewer to:
  - Output ONLY the markdown review file content (YAML front matter + body sections), no preamble, no closing remarks.
  - Use the four criteria from WORKFLOW.md as the structural backbone of the Constraint compliance section.
  - Mark a finding `[blocker]` only for: spec violations, missing verifiable-objective items, security issues, data-loss risks, RLS bypass, breaking changes to API surface. Style nits and suggestions are `[nit]` or `[suggestion]` and never affect the verdict.
  - Use `verdict: request_changes` only when at least one `[blocker]` finding exists. Otherwise `comment` (findings exist) or `approve` (no findings of any kind).

### Wrapper script
- [ ] `run-review.sh` exists at the repo root, executable (`chmod +x`).
- [ ] `set -euo pipefail` at the top.
- [ ] Header comment explains: filename, purpose, usage (`bash run-review.sh <commit-sha> <instructions-file-path>`), exit codes, and a "do not call directly from CI — local-only" note.
- [ ] Argument validation: bails with non-zero and a clear error if `<commit-sha>` is empty or doesn't resolve via `git rev-parse --verify`. Bails if `<instructions-file-path>` is non-empty but the file doesn't exist (empty / `none` is allowed for ad-hoc commits with no spec).
- [ ] Constants: `REPO_ROOT` (resolves via `git rev-parse --show-toplevel`), `REVIEWS_DIR="$REPO_ROOT/reviews"`, `PROMPT_FILE="$REVIEWS_DIR/PROMPT.md"`, `OUTPUT_FILE="$REVIEWS_DIR/<full-sha>.md"`.
- [ ] Idempotency: if `$OUTPUT_FILE` already exists, the script prints a clear message and exits 0 without re-running the review (re-runs require `--force`).
- [ ] `--force` flag re-runs the review and overwrites the existing file.
- [ ] `--help` prints the header comment and exits 0.
- [ ] Reads the diff with `git show --stat --patch <commit-sha>` (full patch, not just the summary). Captures stderr; bails non-zero if the SHA doesn't have a parent (initial commit) — that case is handled with `git show --stat --patch --root <commit-sha>` as a fallback.
- [ ] Reads `CLAUDE.md` and `WORKFLOW.md` from `$REPO_ROOT`.
- [ ] Reads the INSTRUCTIONS file content if the path is non-empty and not `none`. Otherwise substitutes the literal string `(no INSTRUCTIONS file — ad-hoc commit)`.
- [ ] Builds the final prompt by reading `$PROMPT_FILE` and substituting the four placeholders. Uses `awk` or a small Python one-liner — NOT `sed`, because the diff/INSTRUCTIONS bodies will contain `&` and `/` and other sed-hostile characters.
- [ ] Invokes the reviewer subprocess: `claude -p "$FULL_PROMPT" --output-format text > "$OUTPUT_FILE"`. The exact flag set is reviewed against the installed `claude` version — see Steps below for the version-detection pattern.
- [ ] If the subprocess exits non-zero: `$OUTPUT_FILE` is deleted (so an empty/partial file doesn't poison future runs) and the script exits non-zero with a clear error message.
- [ ] After the subprocess succeeds, the script parses the verdict from the YAML front matter using `awk` (extract `verdict:` line, trim, lowercase). The parser is robust to extra whitespace and quoted/unquoted values.
- [ ] Verdict-to-exit-code mapping:
  - `approve` → exit 0, no extra output beyond a one-line summary.
  - `comment` → exit 0, prints the findings count.
  - `request_changes` → exit 2, prints the blocker count and the path to the review file.
  - Any other value (including missing or malformed verdict) → exit 3, prints "review file produced but verdict is unparseable; manual inspection required."
- [ ] Final summary line: `Review for <short-sha>: <verdict> — <findings_count> findings (<blockers_count> blocker[s]). See <relative path>.`

### `/simplify` integration
- [ ] `simplify-and-verify.sh` exists at the repo root, executable, `set -euo pipefail`.
- [ ] Header comment: filename, purpose (run `/simplify` then re-verify; revert if verification breaks), usage, exit codes, "local-only" note.
- [ ] Behavior:
  1. Records the current HEAD SHA in `PRE_SIMPLIFY_SHA`.
  2. Records `git status --porcelain` to detect uncommitted changes — if any, bails non-zero with "commit before running simplify" message. (We want `/simplify` to run on a clean tree.)
  3. Invokes `claude /simplify` in a non-interactive subprocess. The script captures the subprocess's stdout into `reviews/<short-sha>.simplify-log.md` for forensic reference.
  4. Stages and commits any resulting changes with message `chore: /simplify — <short-sha>` IF AND ONLY IF the verification suite still passes.
  5. The verification suite for now is exactly: `cd mobile && npx tsc --noEmit && cd .. && cd mobile && ./run_tests.sh`. The script reads the verification command list from `simplify-verify.cmds` (newline-separated) so the list is editable without touching the script. The repo ships an initial `simplify-verify.cmds` file with the two commands above.
  6. If verification fails: `git reset --hard $PRE_SIMPLIFY_SHA` to undo the simplification, log to stdout that simplification was reverted, and exit 0 (this is NOT a script failure — reverting is the designed behavior). The forensic log file is preserved so future Mac Claude can see what was attempted.
  7. If verification passes and changes were made: commit them, log "simplification accepted, X files changed", and exit 0.
  8. If `/simplify` made no changes: exit 0 silently with one log line "no simplifications suggested".
- [ ] `--help` prints the header comment.
- [ ] `--dry-run` runs `/simplify` but does not commit or revert. Output goes to the log file.
- [ ] The `claude /simplify` invocation handles the case where the installed `claude` version does not support the slash command (i.e., `/simplify` shipped in v2.1.63; older installs return an error). Detection: run `claude --version` first; if the version is older than 2.1.63, the script logs a clear "/simplify requires claude >= 2.1.63" message and exits 0 without attempting the simplify pass. The conformance review still runs separately.

### `simplify-verify.cmds` config file
- [ ] Repo-root file `simplify-verify.cmds` exists.
- [ ] Initial contents:
  ```
  cd mobile && npx tsc --noEmit
  cd mobile && ./run_tests.sh
  ```
- [ ] One-line top-of-file comment explaining the file's purpose. (`#`-prefixed lines are skipped by the script.)
- [ ] Empty lines are skipped.
- [ ] Each non-empty, non-comment line is run via `bash -c "<line>"` from `$REPO_ROOT`. The first non-zero exit code aborts the verification run.

### `.gitignore`
- [ ] No changes — `reviews/` and its contents are deliberately tracked. The audit trail is the point.

### CLAUDE.md edits
- [ ] Add a new section `## Code Review Phase` between the existing `## Testing Rules` and `## Root Cause Before Fix` sections. Content:
  - One paragraph: every commit on a development task gets two automated passes — `/simplify` (quality) and conformance review (spec). Both are mandatory and run via the wrapper scripts.
  - The `reviews/` directory is owned by the conformance review subprocess. Implementer Claude Code never edits files under `reviews/` except via `run-review.sh`. `simplify-log.md` files are owned by `simplify-and-verify.sh`.
  - When `run-review.sh` exits with code 2 (`request_changes`), the implementer must fix the blockers and re-run the review BEFORE returning control to Mike. The session does not end on a `request_changes` verdict.
  - When `simplify-and-verify.sh` reverts a simplification because verification broke, that is correct behavior — do NOT debug or "fix" the verification suite to make `/simplify`'s changes pass. Verification is the gate; `/simplify` is advisory.
  - Reviewer subprocess context isolation: the `claude -p` subprocess has no access to the implementer session's chat history. It sees only what the prompt + diff + spec + CLAUDE.md + WORKFLOW.md provide. This is intentional. Do not bypass it by piping anything else into the subprocess.

### WORKFLOW.md edits
- [ ] Add a new top-level section `## Code Review Phase` immediately after the `## Diff Review — Four Criteria` section (so the human and automated reviews are documented adjacently).
- [ ] Section contents:
  - One paragraph framing: there are now two reviews — Mac Claude does the human four-criteria diff review (existing); a Claude subprocess does the automated conformance review using the same four criteria. They catch different things.
  - The two-script flow:
    1. After the implementer commits and verification passes, implementer runs `bash simplify-and-verify.sh`.
    2. Then implementer runs `bash run-review.sh <commit-sha> <instructions-file-path>`.
    3. If `run-review.sh` exits 2 (`request_changes`), implementer addresses the blockers, commits the fix, and re-runs both scripts on the new commit.
    4. Once `run-review.sh` exits 0, control returns to Mike.
  - The `reviews/<sha>.md` file is the artifact. Mac Claude reads it next session as the most recent ground-truth on what the previous diff did or didn't get right.
  - Schema reference (link to `reviews/README.md`).
  - Exit-code reference (table).
- [ ] Update the `## INSTRUCTIONS File Format` section: add to the file-format template a new mandatory final block:

  ```
  ## Verification

  Exact commands to run. Do not report success until all pass.

  After all verification passes, the implementer ALWAYS runs, in order:

      bash simplify-and-verify.sh
      bash run-review.sh "$(git rev-parse HEAD)" <path to this INSTRUCTIONS file>

  The implementer does not return control to Mike until run-review.sh exits 0.
  ```

  Mark this as the new mandatory tail of every future INSTRUCTIONS file.

- [ ] Add a new sub-section `### Mac Claude — Pre-task Review File Gate`:
  - Before writing any new INSTRUCTIONS file, Mac Claude verifies the most recent commit on the current branch has a corresponding `reviews/<sha>.md` file with verdict ≠ `request_changes`.
  - Mechanic: Mac Claude lists `reviews/`, finds the file matching the most recent commit SHA via `git log -1 --format=%H`, and reads its YAML front matter.
  - If missing or `request_changes`, Mac Claude refuses the new task and tells Mike the previous review must be cleared first.
  - This is the trust mitigation for the honor-system review.

### TRIVOLTA_TRACKER.md
- [ ] Add a new section `## Workflow infrastructure` immediately after `## Phase 2.6` (positioned as cross-cutting, not phase-bound). Initial entries:
  - `✅ Automated code review phase — INSTRUCTIONS_AUTOMATED_REVIEW.md (reviews/, run-review.sh, simplify-and-verify.sh, simplify-verify.cmds)`
- [ ] Add `✅ INSTRUCTIONS_AUTOMATED_REVIEW.md` to the INSTRUCTIONS Files Written section.

### TypeScript and tests
- [ ] `cd mobile && npx tsc --noEmit` exits 0 (no mobile changes; this is a guard).
- [ ] `cd mobile && ./run_tests.sh` reports the same suite count as before this work — automated review infrastructure is invisible to Maestro.

### End-to-end smoke test (Claude Code runs this AFTER all files are in place)
- [ ] Make a small no-op commit on the current branch (e.g. `chore: smoke-test review pipeline` adding a single comment line to `reviews/README.md` or a similar low-risk file). NOTE: do this AFTER writing the review-pipeline files, so the smoke test exercises the real pipeline.
- [ ] Run `bash simplify-and-verify.sh`. Expected outcomes (any is acceptable for the smoke test):
  - "no simplifications suggested" + exit 0, OR
  - "simplification accepted" + a chore commit + exit 0, OR
  - "simplification reverted" + a forensic log file + exit 0.
- [ ] Run `bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_AUTOMATED_REVIEW.md`. Expected: a `reviews/<full-sha>.md` file appears with valid YAML front matter and the structured body. The verdict for a no-op commit will likely be `approve` or `comment`.
- [ ] If the smoke-test commit's review verdict is `request_changes`, that is acceptable for the smoke test (the pipeline ran end-to-end). Note it in the final report; do not panic-fix.
- [ ] After the smoke test, leave the smoke-test commit in place — do NOT amend or rebase. The audit trail is the point.

## Constraints

- **Do not** add any GitHub Action, CI workflow, remote service, webhook, or external automation. The review pipeline is fully local.
- **Do not** add new dependencies of any kind (no `npm install`, no `pip install`, no Homebrew packages). The pipeline uses `claude`, `git`, `bash`, `awk`, and Python's `python3` standard library only.
- **Do not** modify any code under `mobile/`, `supabase/`, `.github/`, or anywhere else outside the repo root. The deliverables are repo-root scripts + `reviews/` + WORKFLOW.md + CLAUDE.md + TRIVOLTA_TRACKER.md.
- **Do not** make `simplify-and-verify.sh` exit non-zero on a revert. Reverting is correct behavior, not a failure.
- **Do not** make `run-review.sh` exit non-zero on `comment` or `approve`. Only `request_changes` and unparseable-verdict are non-zero.
- **Do not** include the implementer's chat session, transcript, or any conversational state in the conformance review prompt. The reviewer sees diff + spec + project rules, period.
- **Do not** delete or rewrite previously-generated `reviews/<sha>.md` files. They are append-only project history.
- **Do not** allow `run-review.sh` to be triggered via git hooks, file watchers, or any indirect mechanism. The implementer Claude Code session invokes it explicitly as the final verification step.
- **Do not** put secrets, API keys, or environment variables into the prompt. The reviewer subprocess does not need any of those.
- **Do not** rename, restructure, or "improve" the four review criteria in WORKFLOW.md. They are stable and used by both the human and automated review paths.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria. (Yes — this INSTRUCTIONS file is the bootstrap, so the review for THIS commit is the first one the new pipeline produces. That is intentional.)

## Steps

### 1. Read existing files (no edits)
1. `WORKFLOW.md` — current workflow contract.
2. `CLAUDE.md` — current project rules.
3. `TRIVOLTA_TRACKER.md` — for the new "Workflow infrastructure" section's placement.
4. Any one prior INSTRUCTIONS file (e.g. `INSTRUCTIONS_F2_FEEDBACK_CHANNEL.md`) — to understand the current "Verification" section style and figure out where the new mandatory block lands.

### 2. Detect installed `claude` version
Run `claude --version` and capture the output. Extract the `<major>.<minor>.<patch>` triple. This value is needed for the `/simplify` availability check and for the reviewer-model field in the YAML front matter (the model name itself is fixed to `claude-sonnet-4-6`, but the `claude` CLI version is informative — record it in `reviews/README.md` as the version this scaffolding was tested against).

### 3. Create `reviews/.gitkeep`, `reviews/README.md`, `reviews/PROMPT.md`
- `reviews/.gitkeep` is empty.
- `reviews/README.md` follows the schema spelled out in the verifiable objective.
- `reviews/PROMPT.md` content guidance:
  - Top-of-file comment (markdown): "This is the canonical conformance-review prompt. `run-review.sh` substitutes the four placeholders before invoking `claude -p`."
  - Body: a clear, structured prompt that gives the reviewer its role, the four criteria, the required output schema (YAML front matter + body), and the inputs (diff, spec, CLAUDE.md, WORKFLOW.md excerpt). The placeholders are `{{COMMIT_SHA}}`, `{{INSTRUCTIONS_FILE}}`, `{{DIFF}}`, `{{CLAUDE_MD}}`, `{{WORKFLOW_CRITERIA}}`.
  - End with an explicit "Output the markdown review file content directly. No preamble. No closing remarks. Begin with `---` for the YAML front matter."

### 4. Create `run-review.sh`
Implement per the verifiable objective. Use Python for placeholder substitution to avoid sed/awk hostile characters:

```bash
FULL_PROMPT=$(python3 - <<EOF
import sys
template = open("$PROMPT_FILE").read()
sub = {
  "{{COMMIT_SHA}}": "$COMMIT_SHA",
  "{{INSTRUCTIONS_FILE}}": """$INSTRUCTIONS_CONTENT""",
  "{{DIFF}}": """$DIFF_CONTENT""",
  "{{CLAUDE_MD}}": """$CLAUDE_MD_CONTENT""",
  "{{WORKFLOW_CRITERIA}}": """$WORKFLOW_CRITERIA""",
}
for k, v in sub.items():
    template = template.replace(k, v)
print(template)
EOF
)
```

Adjust the heredoc handling so multi-line strings round-trip cleanly. The implementation that works is to write each input to a temp file, then pass paths into Python and have Python read them — that avoids shell quoting issues entirely. Pick whichever is cleaner.

For the `WORKFLOW_CRITERIA` substitution, extract just the `## Diff Review — Four Criteria` section from `WORKFLOW.md` via `awk '/^## Diff Review — Four Criteria/,/^---$/'` (or equivalent). Don't pass the whole WORKFLOW.md.

`chmod +x run-review.sh` after creation.

### 5. Create `simplify-and-verify.sh` and `simplify-verify.cmds`
Implement per the verifiable objective. The verification-command runner is a small loop:

```bash
while IFS= read -r cmd; do
  [[ -z "$cmd" || "$cmd" =~ ^# ]] && continue
  bash -c "$cmd" || { echo "Verification failed: $cmd"; return 1; }
done < "$REPO_ROOT/simplify-verify.cmds"
```

Wrap that in a function. Call it from the script. Test the version-gating against `claude --version`.

`chmod +x simplify-and-verify.sh`.

### 6. Update CLAUDE.md
Insert the new `## Code Review Phase` section at the position specified in the verifiable objective. Use `Filesystem:edit_file` semantics — find the existing `## Testing Rules` section's heading and insert the new section just before `## Root Cause Before Fix`.

### 7. Update WORKFLOW.md
Insert the new `## Code Review Phase` section after `## Diff Review — Four Criteria`.
Update `## INSTRUCTIONS File Format` to include the new mandatory tail block.
Add the `### Mac Claude — Pre-task Review File Gate` sub-section under the existing `## Mac Claude — Mandatory Tool Usage` section (or as a sibling — whichever reads cleaner; the location-finding decision is fine to make at write time).

### 8. Update TRIVOLTA_TRACKER.md
Add the new `## Workflow infrastructure` section + INSTRUCTIONS Files Written entry per the verifiable objective.

### 9. Smoke test (after all of the above)
Run the smoke test sequence per the verifiable objective. Capture the outputs verbatim for the final report.

### 10. Stop. Do not commit.
Mac Claude reviews the diff against the four criteria. Once approved, the commit lands and triggers the first run of the new pipeline against itself. That recursive bootstrap is the intended first review.

## Verification

Final report Claude Code returns:
- `claude --version` output.
- `bash run-review.sh --help` output.
- `bash simplify-and-verify.sh --help` output.
- `cat simplify-verify.cmds`.
- `tree reviews/` (directory listing).
- The smoke test commit SHA.
- The smoke test outputs from `simplify-and-verify.sh` (full stdout/stderr).
- The smoke test outputs from `run-review.sh` (full stdout/stderr).
- Path to the resulting `reviews/<sha>.md` file.
- The full contents of the resulting `reviews/<sha>.md` file (so Mac Claude can sanity-check the prompt produced sensible output).
- TypeScript pass/fail.
- Maestro count (unchanged from current baseline).
- `git status --porcelain` (should be clean except for the smoke-test commit and any forensic log files).
- `git log --oneline -5` (showing the smoke-test commit and the chore commit if `/simplify` accepted changes).

After Mac Claude approves the diff, this work is done. Subsequent INSTRUCTIONS files inherit the new mandatory tail block, and every commit going forward produces a `reviews/<sha>.md` artifact.

---

Read INSTRUCTIONS_AUTOMATED_REVIEW.md and execute all steps exactly as written.
