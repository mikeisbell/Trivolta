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

## Verifiable objective
Bullet list of exact pass/fail checks. Every item must be binary.

## Constraints
What Claude Code must NOT do. Be explicit.

## Steps
Numbered implementation steps with exact file paths.

## Verification
Exact commands to run. Do not report success until all pass.
```

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
