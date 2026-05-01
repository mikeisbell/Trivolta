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
