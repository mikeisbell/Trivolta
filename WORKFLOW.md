# Trivolta — Workflow & Agent Guidelines

## Two-Claude Split

**Mac Claude (claude.ai)** — design, spec, architecture decisions, diff review. Has direct read/write access to the Trivolta repo via the Filesystem MCP tools (allowed roots include `/Users/mizzy/Developer`).
**Claude Code (iTerm2)** — all code execution, test runs, git commits. Reads INSTRUCTIONS files Mac Claude has already written to disk.

Mac Claude writes INSTRUCTIONS\_\*.md files **directly to the Trivolta repo on disk** — never pasted into chat for Mike to copy, never written to `/tmp` or any path outside the repo. Claude Code then reads them and executes.
Mac Claude reviews every diff against four criteria before Claude Code commits.

---

## Mac Claude — Mandatory Tool Usage

Mac Claude has access to the user's filesystem via the Filesystem MCP. Use it. Do not ask Mike to paste file contents, do not summarize files in chat instead of reading them, do not produce INSTRUCTIONS files as chat output for Mike to manually save.

**At session start, when asked to read project docs:**
- Use `Filesystem:read_multiple_files` with the full list of paths in one call. Do NOT make N separate `read_text_file` calls.
- Trivolta repo root: `/Users/mizzy/Developer/Trivolta`

**When writing a new INSTRUCTIONS file:**
- Use `Filesystem:write_file` with the full path `/Users/mizzy/Developer/Trivolta/INSTRUCTIONS_<NAME>.md`.
- Never write INSTRUCTIONS files to `/tmp`, `/private/tmp`, `/mnt`, `/home/claude`, or any path outside the Trivolta repo. Those paths are on Claude's container, not Mike's machine.
- Confirm the write landed by listing the directory or by quoting the size from the write response. Do NOT re-read the entire file back into chat to "verify" — that wastes tokens.

**When updating an existing file (TRIVOLTA_TRACKER.md, WORKFLOW.md, CLAUDE.md, etc.):**
- Use `Filesystem:edit_file` with `oldText` / `newText` pairs. Match `oldText` exactly including whitespace.
- Do NOT use `Filesystem:write_file` to update an existing file unless the change is so large that a full rewrite is unavoidable. `write_file` overwrites silently and loses any concurrent edits.
- For mechanical status flips (⬜ → ✅, ⬜ → ⏸), `edit_file` is always correct.

**When inspecting code or migrations to ground an INSTRUCTIONS file:**
- Use `Filesystem:read_text_file` with `head` / `tail` / `view_range`-style limits where the file is large. Don't read entire 30 KB files when 80 lines answer the question.
- Use `Filesystem:list_directory` to discover existing files before referencing them by name in an INSTRUCTIONS file. If a file is referenced that doesn't exist on disk, Claude Code will fail.
- Use `Filesystem:search_files` to locate files by glob pattern when the path isn't known.

**When updating Claude's memory:**
- Use the `memory_user_edits` tool. Do NOT just acknowledge changes conversationally — nothing persists without the tool call.

**Hard rules:**
- Mac Claude never asks "do you want me to write this to disk?" — if the artifact is an INSTRUCTIONS file or a doc update, just write it.
- Mac Claude never claims "I don't have filesystem access" or "I can't see your files." The Filesystem MCP is always available in this project. If a path returns access denied, the path is wrong, not the tool.
- Mac Claude never narrates tool steps. Run the tool, report the outcome.

---

## Session Startup

**New iTerm2 session:**

```
Read CLAUDE.md then read INSTRUCTIONS_<n>.md and execute all steps exactly as written.
```

**Existing session (still running):**

```
Read INSTRUCTIONS_<n>.md and execute all steps exactly as written.
```

CLAUDE.md is only needed once per session. Claude Code retains it in context.

---

## INSTRUCTIONS File Format

Every INSTRUCTIONS\_\*.md must contain these sections in order:

```
## Task
One paragraph — what is being built and why.

## Pre-flight context
A grep-pass enumeration completed by Mac Claude before drafting this spec.
Surfaces the cross-file landscape so drift is visible up front.

Required subsections (use "None" only if a subsection truly does not apply,
and only after grepping to confirm):

- **Strings, slugs, or constants this spec touches.** For each, where it is
  currently defined and every other file that references it. If two files
  define the same concept differently, that is drift — surface to Mike
  before continuing.
- **Routes or paths this spec touches.** Every screen, deep link, or URL
  pattern that uses them.
- **Error codes, status enums, or response shapes this spec touches.** Where
  defined, where consumed.
- **Existing shared modules that should be reused.** If a relevant module
  does not exist and this spec would create a duplicate, surface that.

This section forces cross-file thinking at spec time, before any code is
written. If the grep reveals drift, the spec must either fix it in scope or
explicitly defer it (with a tracker entry pointing at a follow-up
INSTRUCTIONS file).

## Verifiable objective
Bullet list of exact pass/fail checks. Every item must be binary.

## Constraints
What Claude Code must NOT do. Be explicit.

## Steps
Numbered implementation steps with exact file paths.

## Sites this affects
Every file in the repo that references the concept this spec changes. Each
file must be in one of three buckets:

- **Modified** — the diff changes this file. Listed with a one-line
  description of the change.
- **Intentionally unchanged** — the spec preserves this file's behavior;
  one sentence says why it is correct that nothing here changes.
- **Deferred** — the spec does not touch this file but acknowledges drift
  exists; pointer to a tracker entry or follow-up INSTRUCTIONS file.

If a file references the concept and is not in one of these buckets, the
spec is incomplete — redo the Pre-flight context grep.

## Verification

Exact commands to run. Do not report success until all pass.

After all verification passes, the implementer ALWAYS runs, in order:

    IMPL_SHA="$(git rev-parse HEAD)"
    bash simplify-and-verify.sh
    bash run-review.sh "$IMPL_SHA" <path to this INSTRUCTIONS file>

The `IMPL_SHA` capture before `simplify-and-verify.sh` is required: that script may land a `chore: /simplify` commit on top of the implementation, which would shift HEAD. The reviewer must run against the implementation commit, not the chore commit on top.

The implementer does not return control to Mike until run-review.sh exits 0.
```

The two-script tail is mandatory in every future INSTRUCTIONS file's Verification section.

**Pre-flight context and Sites this affects are mandatory.** They exist because the four-criteria diff review is local — it asks whether THIS diff matches THIS spec — and nothing else in the workflow looks at cross-file drift. The Tech Debt Audit (2026-05-04) found ~40 items, the majority of which were drift between layers (mobile↔server, screen↔screen, doc↔code) that no per-diff review would have caught. Pre-flight forces the cross-file homework at spec time; Sites this affects forces a final cross-file scan before the diff lands. If either section is missing or pencilled in as "None" without grep evidence, the INSTRUCTIONS file is incomplete and Claude Code refuses to start.

### File location & naming

- **Path:** `/Users/mizzy/Developer/Trivolta/INSTRUCTIONS_<NAME>.md` — always at the repo root, never in a subdirectory.
- **Name:** `INSTRUCTIONS_<UPPER_SNAKE_CASE>.md`. For Phase 2.9 features use `INSTRUCTIONS_F<n>_<NAME>.md` (e.g. `INSTRUCTIONS_F2_FEEDBACK_CHANNEL.md`). For phase work use `INSTRUCTIONS_PHASE_<n.n.n>_<NAME>.md`.
- **Written by:** Mac Claude only, via `Filesystem:write_file`.
- **Tracker entry:** after writing the file, Mac Claude updates `TRIVOLTA_TRACKER.md` to mark the new INSTRUCTIONS file as written (✅) using `Filesystem:edit_file`.

---

## Diff Review — Four Criteria

Mac Claude checks every `git diff HEAD > ~/trivolta_diff.txt` against:

1. **Objective met** — does the diff accomplish what the INSTRUCTIONS file specified?
2. **Constraints not violated** — did Claude Code stay within the boundaries?
3. **No unintended files modified** — only expected files changed?
4. **CLAUDE.md additions justified** — new entries pass the "not in code, wrong decision if absent" test?

Do not commit until all four pass.

---

## Code Review Phase

There are now two reviews on every task. Mac Claude does the human four-criteria diff review (above). A `claude -p` subprocess does an automated conformance review using the same four criteria as a structural backbone. They catch different things — the human review catches design and intent issues; the subprocess catches mechanical spec drift, missing verifiable-objective items, and constraint violations.

The subprocess is wrapped by two repo-root scripts:

1. After the implementer commits and the verification suite passes, the implementer runs `bash simplify-and-verify.sh`. This invokes `claude /simplify`, re-runs the verification commands listed in `simplify-verify.cmds`, commits the simplifications as `chore: /simplify — <short-sha>` if they survive, and reverts to the pre-simplify HEAD if they don't.
2. The implementer then runs `bash run-review.sh <commit-sha> <INSTRUCTIONS path>` (use the literal string `none` for ad-hoc commits with no spec). This produces `reviews/<commit-sha>.md` with structured YAML front matter and body sections.
3. If `run-review.sh` exits 2 (`request_changes`), the implementer addresses the blocker findings, commits the fix, and re-runs **both** scripts against the new commit.
4. Once `run-review.sh` exits 0, control returns to Mike. The `reviews/<sha>.md` artifact stays on disk as the audit trail; Mac Claude reads it next session as the most recent ground-truth on what the previous diff did or didn't get right.

Schema and prompt details: see `reviews/README.md`.

Every successful `simplify-and-verify.sh` run lands exactly one `chore:` commit on HEAD: `chore: /simplify — <sha>` (changes accepted), `chore: /simplify reverted — <sha>` (changes failed verification and were reset), or `chore: /simplify ran clean — <sha>` (no changes suggested). The forensic log is committed under `reviews/<sha>.simplify-log.md` in all three cases. The next run always starts on a clean working tree.

### Exit codes for `run-review.sh`

| Verdict             | Exit | Meaning                                          |
|---------------------|-----:|--------------------------------------------------|
| `approve`           |    0 | No findings.                                     |
| `comment`           |    0 | Findings exist but none are blockers.            |
| `request_changes`   |    2 | At least one `[blocker]`. Implementer must fix.  |
| (missing/malformed) |    3 | Manual inspection required.                      |

`simplify-and-verify.sh` always exits 0 unless there is a pre-flight error (uncommitted changes, missing tooling). A revert after verification breakage is correct behavior, not a script failure.

### Capturing the implementation SHA before simplify

`simplify-and-verify.sh` lands a `chore:` commit on top of HEAD on every successful run — either `chore: /simplify — <sha>` (changes accepted), `chore: /simplify reverted — <sha>` (changes failed verification and were reset), or `chore: /simplify ran clean — <sha>` (no changes suggested). After the wrapper finishes, `git rev-parse HEAD` points at the chore commit, not the implementation.

The reviewer (`run-review.sh`) MUST be invoked with the implementation SHA, not the post-simplify HEAD. The implementation SHA is captured BEFORE `simplify-and-verify.sh` runs:

    IMPL_SHA="$(git rev-parse HEAD)"
    bash simplify-and-verify.sh
    bash run-review.sh "$IMPL_SHA" <path to this INSTRUCTIONS file>

If `run-review.sh` is invoked with the chore commit's SHA instead, the reviewer correctly returns `request_changes` because the chore commit has no implementation content. That's a workflow error, not a code defect — fix by re-running with the captured `IMPL_SHA`.

### Mac Claude — Pre-task Review File Gate

Before writing any new INSTRUCTIONS file, Mac Claude verifies that the most recent commit on the current branch already has a corresponding `reviews/<sha>.md` file with verdict ≠ `request_changes`.

Mechanic: list `reviews/`, find the file matching `git log -1 --format=%H` on the current branch, read its YAML front matter. If the file is missing or the verdict is `request_changes`, Mac Claude refuses the new task and tells Mike the previous review must be cleared first.

This is the trust mitigation for an honor-system pipeline.

---

## Credential & Secret Handling Rules

Learned from two key exposures during this project. Non-negotiable:

1. Before creating any file that will contain secrets — verify it is in `.gitignore` first
2. Mac Claude never gives shell commands that touch secret files — write files directly via filesystem tools instead
3. Never use `>` to write to an existing file — it overwrites silently. Use VS Code instead.
4. Never read a file containing secrets back through this conversation — open in VS Code instead
5. Rotate immediately if exposed:
   - Local Supabase keys: `supabase stop && supabase start`
   - Anthropic keys: console.anthropic.com
6. Secret files belong in `.gitignore` before they are created, not after

Files that must always be gitignored:

- `supabase/.env.local` — Anthropic API key + Supabase keys
- `mobile/.env.local` — Supabase public URL + anon key
- `mobile/maestro/.env.maestro` — Supabase service role key for test user cleanup

---

## Maestro Testing Rules

Learned from the Detox → Maestro migration and subsequent test failures:

- Maestro requires the app installed as a **native build** — not Expo Go
- Before running tests: `cd mobile && npx expo run:ios`
- `ios/` directory is gitignored — prebuild must be re-run after fresh clone
- App ID in all YAML files: `com.mikeisbell.trivolta`
- Tab bar taps don't always propagate — use alternative testIDs for Maestro navigation
- `assertVisible` with inline `timeout` not supported in Maestro 2.4.0 — use `extendedWaitUntil`
- `tapOn` for optional system dialogs must include `optional: true`
- Test user cleanup uses Supabase admin API via HTTP — not psql (GraalVM JS sandbox blocks Java interop)
- Always run full suite before committing: `maestro test maestro/`

---

## Commit Discipline

- Commit after every completed INSTRUCTIONS file, not mid-task
- Message format: `feat:`, `fix:`, `test:`, `docs:`, `chore:`
- Include test count: `feat: X — Y Maestro tests passing`
- Update `TRIVOLTA_TRACKER.md` before committing
- Never commit with a failing TypeScript check

---

## What's Working Well (Claude Code insights report — 244 messages, 20 sessions)

- Handoff-driven workflow with scoped markdown docs is genuinely effective
- Demanding full test suite verification before accepting any work
- Specifying exact file paths and verification commands in INSTRUCTIONS files
- Upfront specification style — most sessions complete cleanly
- Two-Claude split keeps architecture decisions with Mac Claude

---

## Friction Patterns to Avoid (from insights report)

**Buggy code (15 occurrences)** — mitigated by:

- Verifiable objectives in every INSTRUCTIONS file
- TypeScript check before every commit
- Full Maestro suite run before every commit

**Wrong approach (8 occurrences)** — mitigated by:

- Explicit constraints section in every INSTRUCTIONS file
- Stating what NOT to do, not just what to do
- Mac Claude reviews approach before Claude Code implements

**Excessive changes (1 occurrence)** — mitigated by:

- "Do not modify X" constraints
- Diff review criterion 3 (no unintended files modified)

---

## Future Patterns to Consider (from insights report)

**Parallel multi-agent workflows** — for independent tasks (e.g. 5 lobby screens), spin up
multiple Claude Code agents in separate git worktrees, each handling one screen, then merge.
Worthwhile when tasks are truly independent.

**Long-running test agents** — run flaky tests dozens of times in isolation overnight to find
root causes. Useful in Phase 2 when Maestro suite grows to 15+ tests.
