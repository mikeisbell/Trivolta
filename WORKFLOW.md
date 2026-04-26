# Trivolta — Workflow & Agent Guidelines

## Two-Claude Split

**Mac Claude (claude.ai)** — design, spec, architecture decisions, diff review
**Claude Code (iTerm2)** — all file writes, code execution, test runs, git commits

Mac Claude writes INSTRUCTIONS_*.md files. Claude Code reads and executes them.
Mac Claude reviews every diff against four criteria before Claude Code commits.

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

Every INSTRUCTIONS_*.md must contain these sections in order:

```
## Task
One paragraph — what is being built and why.

## Verifiable objective
Bullet list of exact pass/fail checks. Every item must be binary.

## Constraints
What Claude Code must NOT do. Be explicit.

## Steps
Numbered implementation steps with exact file paths and code.

## Verification
Exact commands to run. Do not report success until all pass.
```

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
