# INSTRUCTIONS — Reviewer Full Repo Access

## Task

Expand the conformance reviewer subprocess from "diff + spec + CLAUDE.md + WORKFLOW four-criteria" to "diff + spec + CLAUDE.md + WORKFLOW four-criteria **plus full read access to the Trivolta repository**." Update its prompt to use that access for code-quality review in addition to spec conformance.

The previous design intentionally isolated the reviewer to the diff to keep reviews fast, deterministic, and cheap. Mike's correct objection: a human teammate doing a code review has full codebase access, and a reviewer that can only see the diff produces lower-quality findings. Specifically, the reviewer cannot:

- Read the surrounding code in a file the diff touches.
- Find the definition of a function or component the diff calls.
- Check whether existing tests already cover the new behavior.
- Spot duplicated logic the diff added that already exists elsewhere.
- Notice drift from project conventions.

After this fix, the reviewer can do all of the above. Session isolation is preserved (the reviewer is still a fresh `claude -p` subprocess with no chat history from the implementer); only file-access isolation is dropped.

This is **local-only work**. No CI, no production impact. Three small artifact changes plus a verification step against a real prior commit.

## Verifiable objective

### Reviewer subprocess gets full repo read

- [ ] `run-review.sh` invokes `claude -p` with a flag that gives the subprocess read access to the full Trivolta repo. The exact flag is determined against the installed `claude` version — see Steps for the discovery procedure. The leading candidate in 2.1.126 is `--add-dir <repo-root>`. If that flag does not exist or doesn't grant read access in the installed version, fall back to whichever flag does (likely `--allowed-tools` style, or a permission-mode setting that includes read).
- [ ] The flag(s) are sourced from a constant near the top of the script, e.g.:
  ```bash
  CLAUDE_REVIEW_FLAGS=(--output-format text --add-dir "$REPO_ROOT")
  ```
  Future changes happen in one place. Pattern matches the existing `CLAUDE_SIMPLIFY_FLAGS` constant in `simplify-and-verify.sh`.
- [ ] The constant is documented inline in the script with a comment block stating: the flag chosen, the `claude` version it was tested against, what access it grants, and a reference to `INSTRUCTIONS_REVIEWER_FULL_REPO_ACCESS.md` for the rationale.
- [ ] The flag is the **least-permissive** flag that achieves "full repo read." If `--add-dir` is read-only by default in 2.1.126, that's correct. If it implies write access, document the implication in the comment block — Mike accepts the trade-off in this task, but it should be visible.
- [ ] If no satisfactory flag exists in 2.1.126, the script falls back to the previous prompt-only mode (no codebase access) and logs a clear warning. Do NOT fail the script on this — graceful degradation is the rule, same pattern as `simplify-and-verify.sh`'s version gate.

### Reviewer prompt expands

- [ ] `reviews/PROMPT.md` is updated to reflect the new role and capabilities. Specific changes:
  1. The opening role description changes from "Your job is conformance review only" to "Your job is conformance review and code quality review."
  2. The "You see only what is in this prompt" paragraph is replaced with: "You have read access to the full Trivolta repository at the path provided in the prompt context. Use it whenever the diff alone is insufficient to evaluate the spec or the change's quality. You still have no access to the implementer's chat session or prior conversations — your only ground truth is the repository's current state plus the inputs below."
  3. A new section `## Codebase access` is added after the `## Inputs` section. Content:
     - Tells the reviewer to read surrounding code in any file the diff touches before evaluating the change.
     - Tells the reviewer to find the definition of any function, component, type, or RPC the diff calls or references.
     - Tells the reviewer to check whether existing tests already cover the new behavior, and whether tests for the new behavior exist.
     - Tells the reviewer to look for duplicated logic — if the diff adds code similar to code already in the repo, flag it.
     - Tells the reviewer to compare against project conventions visible in neighboring files.
     - Tells the reviewer to read INSTRUCTIONS files referenced by the spec or visible in the repo if context is missing.
     - Read whatever you need. No file-count cap. Stay focused on evaluating the diff and the spec — do not browse for browsing's sake.
  4. The "Review rules" section gains a new rule between current rules 2 and 3:
     > **3. Code quality findings.** Beyond spec conformance, evaluate code quality: missed reuse opportunities, test coverage gaps for the new behavior, drift from project conventions, security or correctness issues that aren't in the spec but are real. Tag these as `[blocker]`, `[suggestion]`, or `[nit]` per the same bar as conformance findings. Real correctness or security issues are `[blocker]` even if the spec didn't mention them.
  (Re-number the remaining rules accordingly.)
  5. The output schema and verdict mapping are unchanged.
  6. Update the placeholder header comment at the top of the file to mention that `{{REPO_ROOT}}` is now also substituted (it isn't actually a placeholder used in the body, but the script will pass the repo root via the `--add-dir` flag — document the wiring in the header comment for future readers).

### Schema docs note

- [ ] `reviews/README.md` gains a one-paragraph addition under the "## YAML front matter schema" section (or wherever it reads cleanest), stating: "The reviewer subprocess has full read access to the Trivolta repository. Reviews after `<date this lands>` may reference files outside the diff. The chore-commit review limitation noted in earlier reviews no longer applies — chore-commit reviewers can now read the feature commit's actual changes if relevant."

### Verification

- [ ] Pick a real prior feature commit with a non-trivial diff for the test. Recommendation: `a69392e` (the F3 commit, "feat: F3 — admin fact spot-check tool + Maestro test_28 (27/27 passing)"). It has a meaningfully complex diff and a real INSTRUCTIONS file (`INSTRUCTIONS_F3_FACT_SPOT_CHECK.md`).
- [ ] Run `bash run-review.sh --force a69392e /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_F3_FACT_SPOT_CHECK.md` to overwrite the existing F3 review with one produced under the new prompt + access.
- [ ] Compare the new F3 review against the old one (the old one will already be at `reviews/a69392e<full-sha>.md` — read it before overwriting; capture the verdict, findings count, and a couple of representative findings for the comparison report).
- [ ] **Pass criteria for the new review:** at least ONE of the new findings or constraint-compliance notes references a file path outside the diff (i.e. a file the reviewer chose to read because of full repo access). Examples that qualify: a finding citing the structure of `mobile/app/admin/facts/needs-review.tsx` because it was used as a reference pattern; a finding citing `mobile/app/admin/feedback/index.tsx` because it shares structural patterns with the new spot-check screen; a finding citing the existing `is_admin()` helper definition in an earlier migration; etc.
- [ ] **Fail criterion:** if the new review's findings make zero references to files outside the diff, the codebase access wiring is not actually working. The flag was wrong, or the prompt isn't asking for it. Investigate and fix before reporting done.
- [ ] No need to alter the original F3 review file beyond the `--force` overwrite. The new review is the new ground truth for that commit.
- [ ] After the F3 verification review is produced, the standard pipeline tail still applies for THIS task's own commit: `bash simplify-and-verify.sh` then `bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_REVIEWER_FULL_REPO_ACCESS.md`. The review of THIS task's commit will itself exercise the new full-repo-read behavior — meta-bootstrap, intentional.

### TypeScript and Maestro
- [ ] `cd mobile && npx tsc --noEmit` exits 0 (guard; this task does not touch mobile).
- [ ] `cd mobile && ./run_tests.sh` reports 27 passing (guard; should be unchanged baseline).

## Constraints

- **Do not** modify `simplify-and-verify.sh`, `simplify-verify.cmds`, or any of the Phase 2.x feature code. The fix is isolated to `run-review.sh`, `reviews/PROMPT.md`, and `reviews/README.md`.
- **Do not** introduce a file-count cap or any other artificial limit on what the reviewer reads. Mike explicitly chose unbounded read.
- **Do not** loosen the verdict mapping. `request_changes` still requires at least one `[blocker]` finding. Code-quality findings can be blockers if and only if they meet the existing bar (correctness, security, data loss, etc.).
- **Do not** weaken session isolation. The subprocess remains a fresh `claude -p` invocation with no chat-history input. Filesystem access is the only isolation property being dropped.
- **Do not** pass any other context into the prompt beyond what the existing five placeholders carry. The `--add-dir` flag is the access mechanism; the prompt tells the reviewer how to use it.
- **Do not** change the YAML front-matter schema or the four constraint-compliance checkboxes. The reviewer's findings can grow, but the artifact shape stays stable so Mac Claude's pre-task gate continues to parse old and new reviews uniformly.
- **Do not** add new dependencies.
- **Do not** delete or modify the existing `reviews/<sha>.md` audit trail except for the `--force` overwrite of `a69392e`'s review during the verification step.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files (no edits)

- `run-review.sh` — current invocation, constant style, output-flag pattern.
- `reviews/PROMPT.md` — current prompt structure, what to preserve.
- `reviews/README.md` — current schema docs.
- `simplify-and-verify.sh` — pattern reference for `CLAUDE_SIMPLIFY_FLAGS` constant and its inline comment block. Match the same style for `CLAUDE_REVIEW_FLAGS`.
- The most recent `reviews/<sha>.md` file — confirm the existing review shape so the new prompt produces compatible output.
- The current `reviews/<F3 commit sha>.md` — capture verdict + findings before the verification overwrite for the comparison report.

### 2. Discover the correct repo-read flag for `claude -p`

The installed `claude` version is `2.1.126`.

Run `claude --help` and capture the full output. Look for flags related to working directory, sandbox, file access, or tool allowlists. Candidates worth considering, in order of preference:

1. `--add-dir <path>` — adds a directory to the allowed read scope. Likely present in 2.1.126 (it shipped earlier).
2. `--allowed-tools` — tool-level allowlist; may be needed if filesystem read is gated as a tool.
3. `--permission-mode bypassPermissions` — broader; would allow filesystem read but also other things. Use only if narrower options don't work.

Verify the chosen flag actually grants read access by running a one-off test:

```bash
cd /tmp
mkdir -p reviewer-flag-test && cd reviewer-flag-test
echo "marker file: $(date)" > marker.txt
claude -p 'List the files in the current directory and tell me the first line of marker.txt' \
  --output-format text \
  --add-dir "$(pwd)"
```

If the response correctly names `marker.txt` and quotes the marker line, the flag works. If the response says it can't see any files, the flag is wrong or the access wasn't granted — try the next candidate.

If no candidate works, the script falls back to prompt-only mode and logs the warning. Do not push forward with a flag that doesn't actually grant access.

### 3. Edit `run-review.sh`

Add the constant near the top, after the existing constants block:

```bash
# Reviewer subprocess flags. Tested against claude 2.1.126.
# --add-dir grants the subprocess read access to the Trivolta repo so the
# reviewer can read surrounding code, find function definitions, check
# existing tests, and detect drift from project conventions. Read-only
# in 2.1.126 (the subprocess cannot write to files in the added dir
# without an additional permission flag, which we do not pass).
# See INSTRUCTIONS_REVIEWER_FULL_REPO_ACCESS.md for rationale.
CLAUDE_REVIEW_FLAGS=(--output-format text --add-dir "$REPO_ROOT")
```

Replace the existing invocation:

```bash
if ! claude -p "$(cat "$PROMPT_TMP")" --output-format text > "$OUTPUT_FILE" 2>"$TMPDIR_REVIEW/claude.err"; then
```

with:

```bash
if ! claude -p "$(cat "$PROMPT_TMP")" "${CLAUDE_REVIEW_FLAGS[@]}" > "$OUTPUT_FILE" 2>"$TMPDIR_REVIEW/claude.err"; then
```

Adjust to match the actual current line — the spec is the change, not a literal patch.

If the discovery step in Step 2 found that `--add-dir` is not the right flag, swap accordingly and update the constant's comment block to reflect what was actually used.

### 4. Edit `reviews/PROMPT.md`

Implement the prompt changes per the verifiable objective. The structural template:

```markdown
You are a code reviewer for the Trivolta project. Your job is conformance
review and code quality review: did the commit do what its INSTRUCTIONS
file specified within the project's stated constraints, and is the code
itself sound? Conformance, correctness, spec coverage, and code quality
are all in scope.

You have read access to the full Trivolta repository at the path provided
in the prompt context. Use it whenever the diff alone is insufficient to
evaluate the spec or the change's quality. You still have no access to
the implementer's chat session or prior conversations — your only
ground truth is the repository's current state plus the inputs below.

## Inputs

[unchanged section: COMMIT_SHA, DIFF, INSTRUCTIONS_FILE, CLAUDE_MD,
WORKFLOW_CRITERIA placeholders]

## Codebase access

You can read any file in the Trivolta repository. Specifically, when
relevant to the diff or the spec, you should:

- Read the surrounding code in any file the diff modifies, to understand
  the change in context.
- Find and read the definition of any function, component, type, or RPC
  the diff calls or references.
- Check whether existing tests cover the new behavior. Look in
  `mobile/maestro/`, in any `*.test.ts(x)` files, and in any other
  test directories that exist.
- Look for duplicated logic. If the diff adds code that resembles code
  already in the repo, flag it.
- Compare the diff against project conventions visible in neighboring
  files (e.g. existing Edge Functions, existing admin screens, existing
  migrations).
- Read other INSTRUCTIONS files in the repo root if they help explain
  the broader phase context.

Read whatever you need. There is no file-count cap. Stay focused on
evaluating this diff and this spec — do not browse for browsing's sake.

## Review rules

1. [conformance via four criteria — unchanged]

2. [blocker bar — unchanged]

3. **Code quality findings.** Beyond spec conformance, evaluate code
   quality: missed reuse opportunities, test coverage gaps for the new
   behavior, drift from project conventions, security or correctness
   issues that aren't in the spec but are real. Tag these as
   `[blocker]`, `[suggestion]`, or `[nit]` per the same bar as
   conformance findings. Real correctness or security issues are
   `[blocker]` even if the spec didn't mention them.

4. [verdict mapping — re-numbered, unchanged content]

5. [findings_count and blockers_count — re-numbered, unchanged content]

6. [generated_at — re-numbered, unchanged content]

7. [Spec coverage paragraph — re-numbered, unchanged content]

8. [ad-hoc commit handling — re-numbered, unchanged content]

## Output

[unchanged section]
```

Preserve the existing tone and verbatim wording wherever it is unchanged.

### 5. Edit `reviews/README.md`

Add the one-paragraph note per the verifiable objective. Use today's date in the note ("Reviews after 2026-05-02 …" — adjust if the commit lands on a different date).

### 6. Verify against a real commit

Execute the verification per the verifiable objective. The full-text comparison between the old `a69392e` review and the new one is captured in the final report.

### 7. Standard pipeline tail

After the verification step, run:

```bash
bash simplify-and-verify.sh
bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_REVIEWER_FULL_REPO_ACCESS.md
```

This task's own commit gets reviewed under the new full-repo-read behavior. Meta-bootstrap.

### 8. Stop. Do not push.

Mac Claude reviews the diff against the four criteria. Mike pushes after approval.

## Verification

Final report Claude Code returns:

- `claude --help` excerpt showing the chosen access flag exists.
- The exact `CLAUDE_REVIEW_FLAGS` line that landed in `run-review.sh`.
- Marker-file test result (Step 2) confirming the flag actually grants read access.
- Path to the new `reviews/a69392e<sha>.md` and its YAML verdict + findings count.
- Comparison summary: old F3 review verdict + findings count vs new F3 review verdict + findings count. Note 1–3 representative new findings that reference files outside the diff (this is the proof-of-life for codebase access).
- Stdout of `simplify-and-verify.sh` (full).
- Path to this task's own review file at `reviews/<latest-HEAD-sha>.md` and its YAML verdict.
- TypeScript pass/fail.
- Maestro count (27 expected).

After Mac Claude approves the diff, the reviewer's quality bar is permanently raised. F4 (Tranche 2) becomes the next work item with the upgraded review pipeline.

---

Read INSTRUCTIONS_REVIEWER_FULL_REPO_ACCESS.md and execute all steps exactly as written.
