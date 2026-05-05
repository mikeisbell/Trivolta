# INSTRUCTIONS — Add `verify-consistency.sh` Drift Checks

## Task

Create a `verify-consistency.sh` script at the repo root that runs six grep-based drift checks against the codebase. Wire it into the existing `simplify-verify.cmds` so it runs on every commit cycle. A failed check is a hard block: the script exits non-zero, the simplify-and-verify pipeline fails, no commit lands until the drift is fixed.

This is the first piece of automation built specifically to catch the cross-file drift class found in the Tech Debt Audit (`TECH_DEBT_AUDIT_2026_05_04.md`). It is the detection backstop. Future audits should be triggered by additions to this script ("the audit found a new drift class — add a check"), not by scheduled stepping back.

## Pre-flight context

**Strings, slugs, or constants this spec touches.**

- **Category slugs.** Currently defined in two places that must agree.
  - DB: `supabase/migrations/20240106000000_fact_bank_schema.sql` lines 200–209 (10 INSERT rows into `public.categories`).
  - Mobile: `mobile/app/(tabs)/index.tsx` lines 12–17 (`CATEGORIES` const, `id` field) and `mobile/app/lobby/create.tsx` lines 11–16 (duplicate `CATEGORIES` const). The mobile `id` values are: `science`, `pop_culture`, `history`, `film`, `music`, `geography`, `sports`, `literature`, `art`. The DB slugs are: `science`, `pop-culture`, `history`, `film`, `music`, `geography`, `sports`, `literature`, `art`, `general`. Drift exists today: `pop_culture` vs `pop-culture`. Audit item 1.2.
  - This drift is logged for fix in `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md` (not yet written). Check A1 below will *immediately fail* once added — that is the intended behavior. The category contract cleanup must land before this script can pass.

- **Hardcoded category fallback strings.** `mobile/app/question.tsx:75` contains `category ?? 'general knowledge'` (with a space). DB has no slug `'general knowledge'`. Audit item 1.3.
  - Same drift-already-exists situation as above. Check A2 will fail until `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md` lands.

- **AI-generation UI claims.** `mobile/app/custom-category.tsx:127` ("AI generates your quiz in seconds"); `:184` ("plays today · AI-generated"). Audit item 1.4.
  - `INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md` (not yet written) will remove these strings. Check B1 will fail until that lands.

- **Edge Function privilege markers.** `SUPABASE_SERVICE_ROLE_KEY` may legitimately appear in `fact-bank-*` admin functions and in `_shared/auto_seed_pipeline.ts`. It must NOT appear in user-facing functions: `solo-question`, `generate-questions`, `daily-challenge`, `create-lobby`, `join-lobby`, `submit-feedback`, `submit-spot-check`. Audit-derived constraint, no current violation.

- **RLS policy with `verification_status = 'verified'`.** Currently absent (relaxed by `20240110000000_relax_facts_read_for_beta.sql`). Check D1 enforces it stays absent until a deliberate restoration migration lands.

- **Migration timestamp pattern.** All ten existing migrations use `2024-01-XX` format. Going forward, new migrations must use real-date timestamps (`YYYYMMDD000000`). Audit item 5.1. Check D2 enforces this *forward only* — existing migrations are immutable per `WORKFLOW.md`.

**Routes or paths this spec touches.** None. The script is repo-root infrastructure.

**Error codes, status enums, or response shapes this spec touches.** None directly. The script does not modify any existing contract.

**Existing shared modules that should be reused.**
- `simplify-verify.cmds` — existing list of verification commands. The new script must be added to this file.
- `simplify-and-verify.sh` — existing wrapper. Already runs `simplify-verify.cmds`. No changes needed; the new script is invoked through the cmds file.

## Verifiable objective

Binary pass/fail criteria:

- [ ] `verify-consistency.sh` exists at the repo root, marked executable (`chmod +x`).
- [ ] The script runs all six checks (A1, A2, B1, C1, D1, D2) and exits 0 only if all six pass.
- [ ] On any check failure, the script prints a clear diagnostic naming the check ID, the offending file(s), and a one-line description of what the drift is. Then exits 1.
- [ ] `simplify-verify.cmds` is updated to invoke `bash verify-consistency.sh` as one of its commands. Position: AFTER `tsc` runs (so type errors surface first) and BEFORE the Maestro suite (so drift checks fail fast without waiting for tests).
- [ ] Running `bash verify-consistency.sh` directly from the repo root works without needing arguments or environment setup.
- [ ] Each check is a separate function or labeled section in the script, so future additions and individual debugging are straightforward.
- [ ] The script's output (when all checks pass) is exactly one line: `verify-consistency: 6/6 checks passed`. No verbose per-check output on success.

## Constraints

- **Do NOT fix any of the existing drift this script will detect.** A1, A2, and B1 are expected to fail on the first run. The fixes belong in separate INSTRUCTIONS files (`INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md`, `INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md`), not this one. This script's job is detection only.
- **Do NOT add the script to `.gitignore`.** It is a tracked artifact.
- **Do NOT make any check a "warning" or "soft fail."** All six are hard blocks.
- **Do NOT use `find`, `xargs`, or external dependencies beyond `grep`, `awk`, `sort`, `uniq`, `diff`, `bash` builtins.** Keep it portable to any developer's macOS or Linux machine.
- **Do NOT modify `simplify-and-verify.sh`.** The wrapper does not need to change; only `simplify-verify.cmds` does.
- **Do NOT touch any of the files listed in the Pre-flight context above** beyond what's strictly needed (the cmds file).
- **Do NOT add a check beyond the six specified.** Future drift classes get their own INSTRUCTIONS files.

## Steps

### Step 1 — Create `verify-consistency.sh`

Path: `/Users/mizzy/Developer/Trivolta/verify-consistency.sh`

Structure: bash script with six functions, one per check. A driver that runs them all, accumulates pass/fail counts, and exits accordingly.

Each check function follows this pattern:

```bash
check_a1_mobile_db_slug_consistency() {
  # one-line description of what this check does
  # ...grep + diff logic...
  if drift_detected; then
    echo "FAIL [A1] mobile slug list disagrees with DB seed:"
    echo "  $offending_detail"
    return 1
  fi
  return 0
}
```

The driver:
```bash
checks=(
  check_a1_mobile_db_slug_consistency
  check_a2_no_hardcoded_category_fallbacks
  check_b1_ai_generation_ui_claims
  check_c1_no_service_role_in_user_functions
  check_d1_no_verified_rls_predicate
  check_d2_migration_timestamp_format
)

passed=0
failed=0
for check in "${checks[@]}"; do
  if "$check"; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
  fi
done

if [ $failed -eq 0 ]; then
  echo "verify-consistency: ${passed}/6 checks passed"
  exit 0
else
  echo ""
  echo "verify-consistency: ${failed} check(s) failed"
  exit 1
fi
```

### Step 2 — Implement Check A1: mobile slug list ↔ DB seed

**What it catches.** Every category `id` referenced in mobile `CATEGORIES` consts must match a slug in the DB seed. Catches `pop_culture` vs `pop-culture` and any future divergence.

**Implementation.**

Extract mobile slug ids:
```bash
mobile_slugs=$(grep -hE "^\s*\{ id: '[a-z_-]+'" \
  mobile/app/\(tabs\)/index.tsx \
  mobile/app/lobby/create.tsx \
  | grep -oE "id: '[a-z_-]+'" \
  | sed -E "s/id: '(.+)'/\1/" \
  | sort -u)
```

Extract DB slugs:
```bash
db_slugs=$(grep -E "^\s*\('[a-z-]+'," \
  supabase/migrations/20240106000000_fact_bank_schema.sql \
  | grep -oE "'[a-z-]+'" \
  | head -n 10 \
  | sed -E "s/'(.+)'/\1/" \
  | sort -u)
```

Note: the DB has slug `general` which mobile doesn't expose (it's the server-side fallback target). The check should allow DB to have *additional* slugs beyond mobile, but every mobile slug must exist in DB. So:

```bash
missing_in_db=$(comm -23 <(echo "$mobile_slugs") <(echo "$db_slugs"))
if [ -n "$missing_in_db" ]; then
  echo "FAIL [A1] mobile slugs not found in DB seed:"
  echo "$missing_in_db" | sed 's/^/  /'
  return 1
fi
```

### Step 3 — Implement Check A2: no hardcoded category fallback strings outside canonical module

**What it catches.** `?? 'general knowledge'`, `?? "general knowledge"`, `?? 'general'`, `?? "general"` (or any quoted category fallback) appearing in mobile code outside `mobile/lib/categories.ts` (which doesn't exist yet but will).

**Implementation.**

```bash
# Find quoted fallbacks for category strings, exclude the canonical module
violations=$(grep -rnE "\?\? *['\"](general|general knowledge|science|history|sports)['\"]" \
  mobile/app mobile/lib \
  --exclude='categories.ts' \
  --include='*.ts' --include='*.tsx' 2>/dev/null || true)

if [ -n "$violations" ]; then
  echo "FAIL [A2] hardcoded category fallback strings outside mobile/lib/categories.ts:"
  echo "$violations" | sed 's/^/  /'
  return 1
fi
```

Note: the regex tests for the most common category names in fallback position. Future check expansion can broaden this list.

### Step 4 — Implement Check B1: UI AI-generation claims match Edge Function reality

**What it catches.** If mobile has any string matching `AI generates`, `AI-generated`, or `AI-powered` in user-visible copy, then the corresponding gameplay Edge Function must actually call Anthropic. If the Edge Function is DB-backed (no `Anthropic` import), the UI claim is a lie.

**Implementation.**

```bash
ui_claims=$(grep -rnE "AI generates|AI-generated|AI-powered" \
  mobile/app \
  --include='*.tsx' --include='*.ts' 2>/dev/null || true)

solo_uses_anthropic=$(grep -l "from ['\"]@anthropic-ai/sdk['\"]" \
  supabase/functions/solo-question/index.ts 2>/dev/null || true)

if [ -n "$ui_claims" ] && [ -z "$solo_uses_anthropic" ]; then
  echo "FAIL [B1] mobile UI claims AI generation but solo-question is DB-backed:"
  echo "$ui_claims" | sed 's/^/  /'
  echo "  (solo-question/index.ts has no Anthropic import)"
  return 1
fi
```

### Step 5 — Implement Check C1: no service role key in user-facing Edge Functions

**What it catches.** `SUPABASE_SERVICE_ROLE_KEY` reference in any of the seven user-facing Edge Functions. Catches accidental privilege escalation.

**Implementation.**

```bash
user_facing_functions=(
  solo-question
  generate-questions
  daily-challenge
  create-lobby
  join-lobby
  submit-feedback
  submit-spot-check
)

violations=""
for fn in "${user_facing_functions[@]}"; do
  hits=$(grep -rn "SUPABASE_SERVICE_ROLE_KEY" \
    "supabase/functions/$fn/" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    violations+="$hits"$'\n'
  fi
done

if [ -n "$violations" ]; then
  echo "FAIL [C1] SUPABASE_SERVICE_ROLE_KEY found in user-facing Edge Function:"
  echo "$violations" | sed 's/^/  /'
  return 1
fi
```

### Step 6 — Implement Check D1: no `verification_status = 'verified'` RLS predicate

**What it catches.** Any migration introducing `verification_status = 'verified'` as an RLS predicate, after the explicit relaxation in `20240110000000_relax_facts_read_for_beta.sql`. Restoring the predicate is intentional only via a future "restore_facts_verification_gate" migration; any other reintroduction is a bug.

**Implementation.**

```bash
# Look at all migrations EXCEPT the original schema (which legitimately had it)
# and EXCEPT the explicit relaxation (which contains the predicate in a comment).
# Allow a future restoration migration matching *restore_facts_verification*.

violations=$(grep -lE "verification_status\s*=\s*'verified'" \
  supabase/migrations/*.sql 2>/dev/null \
  | grep -vE "20240106000000_fact_bank_schema|20240110000000_relax_facts_read_for_beta|restore_facts_verification" \
  || true)

if [ -n "$violations" ]; then
  echo "FAIL [D1] verification_status = 'verified' RLS predicate found in unexpected migration:"
  echo "$violations" | sed 's/^/  /'
  echo "  Restoration must be in a migration named *restore_facts_verification*."
  return 1
fi
```

Note: this check examines migration *files*, not the live DB. A check against the live DB would require a psql connection and is out of scope for v1.

### Step 7 — Implement Check D2: new migrations use real-date timestamp format

**What it catches.** Any migration with timestamp `2024-01-XX000000` other than the existing ten. Forward-only — does not flag the existing files.

**Implementation.**

```bash
# Existing pre-cutover migrations are grandfathered. Anything new with the
# 2024-01 prefix is a violation — the cutover started at the date this script
# was written.
existing_grandfathered=(
  20240101000000_initial_schema.sql
  20240102000000_game_sessions_insert_policy.sql
  20240103000000_lobbies_host_cascade.sql
  20240104000000_daily_challenge.sql
  20240105000000_bug_fixes.sql
  20240106000000_fact_bank_schema.sql
  20240107000000_auto_seed.sql
  20240108000000_feedback_reports.sql
  20240109000000_spot_check_results.sql
  20240110000000_relax_facts_read_for_beta.sql
)

violations=""
for f in supabase/migrations/2024*.sql; do
  filename=$(basename "$f")
  is_grandfathered=false
  for g in "${existing_grandfathered[@]}"; do
    if [ "$filename" = "$g" ]; then
      is_grandfathered=true
      break
    fi
  done
  if [ "$is_grandfathered" = false ]; then
    violations+="$f"$'\n'
  fi
done

if [ -n "$violations" ]; then
  echo "FAIL [D2] migration uses pre-cutover 2024-01 timestamp format:"
  echo "$violations" | sed 's/^/  /'
  echo "  New migrations must use real-date format YYYYMMDD000000 (e.g. 20260504000000_*.sql)."
  return 1
fi
```

Note: when a future migration legitimately needs this convention to be revisited, the grandfathered list gets extended in this script. The script itself is the registry.

### Step 8 — Mark the script executable

```bash
chmod +x /Users/mizzy/Developer/Trivolta/verify-consistency.sh
```

### Step 9 — Wire into `simplify-verify.cmds`

Read the existing `simplify-verify.cmds` first to understand its format. Add the new line:

```
bash verify-consistency.sh
```

Position: after the `tsc` invocation (so type errors surface first), before any Maestro invocation (so drift fails fast).

If the file does not contain a `tsc` line, place `verify-consistency.sh` after the first non-comment line. If the file format is something Claude Code doesn't recognize, **stop and ask Mike** rather than guessing.

### Step 10 — Verify the script's behavior matches its design

Run the script locally:

```bash
cd /Users/mizzy/Developer/Trivolta
bash verify-consistency.sh
echo "Exit code: $?"
```

**Expected outcome on first run:** the script will FAIL with check A1, A2, and B1 reporting violations. This is correct behavior — the audit's existing drift items must be visible to the script, and they are. C1, D1, D2 should pass (no violations exist today).

**Expected exit code:** 1.

**Expected output structure:** failure messages for each failing check, then `verify-consistency: 3 check(s) failed` (or similar with the actual count).

Do **not** "fix" the failures by modifying mobile or migration code. The fixes belong in other INSTRUCTIONS files. The job here is to confirm the detection works.

## Sites this affects

**Modified:**
- `verify-consistency.sh` (new file at repo root) — created with six check functions and a driver.
- `simplify-verify.cmds` — one new line added to invoke the script.

**Intentionally unchanged:**
- `simplify-and-verify.sh` — already invokes `simplify-verify.cmds`. No wrapper changes needed.
- `mobile/app/(tabs)/index.tsx`, `mobile/app/lobby/create.tsx`, `mobile/app/question.tsx`, `mobile/app/custom-category.tsx` — these contain the drift the script will detect; fixing them is the job of separate INSTRUCTIONS files.
- All migration files — existing ones are grandfathered into D2; none are modified.
- All Edge Functions — none currently violate the checks; no changes needed.

**Deferred:**
- `mobile/lib/categories.ts` — this canonical module does not yet exist. It is created by `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md` (audit item A from the proposed remediation list). Once it lands, A2 will pass. Tracker entry: under "Pre-Beta — In Flight."
- `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md` (not yet written) — must be the next INSTRUCTIONS file written and executed after this one. Until it lands, `verify-consistency.sh` will fail and no commit can land. That is intentional.
- `INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md` (not yet written) — fixes B1 violations.

## Verification

```bash
# 1. Script exists and is executable
test -x /Users/mizzy/Developer/Trivolta/verify-consistency.sh

# 2. Running the script produces the expected first-run failures
cd /Users/mizzy/Developer/Trivolta
bash verify-consistency.sh
# Expected: exit code 1, three check failures (A1, A2, B1), three checks pass (C1, D1, D2).

# 3. simplify-verify.cmds now references the new script
grep "verify-consistency.sh" simplify-verify.cmds
# Expected: one match, positioned after tsc.

# 4. Type check still passes (this script's addition shouldn't break compilation)
cd mobile && npx tsc --noEmit
# Expected: exit 0.

# 5. Confirm we did NOT modify any source files we weren't supposed to
cd /Users/mizzy/Developer/Trivolta
git diff --stat HEAD
# Expected to see ONLY: verify-consistency.sh (new), simplify-verify.cmds (modified).
# NOT: any mobile/ file, any supabase/ file, WORKFLOW.md, CLAUDE.md.
```

After all verification passes, the implementer ALWAYS runs, in order:

```
bash simplify-and-verify.sh
bash run-review.sh "$(git rev-parse HEAD)" INSTRUCTIONS_VERIFY_CONSISTENCY.md
```

**Expected pipeline behavior — read carefully.** Because `simplify-verify.cmds` now invokes `verify-consistency.sh`, and `verify-consistency.sh` is designed to fail until the category contract cleanup lands, `simplify-and-verify.sh` WILL fail on this commit with exactly three failing checks (A1, A2, B1). This is the intended outcome.

Mike has pre-decided the workflow rule for this specific case: **land the script anyway.** Rationale: the detector must exist before its target drift is fixed; the failing script is the gate that subsequent INSTRUCTIONS files (`INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md`, `INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md`) must clear.

Concrete sequence for the implementer:

1. Run `bash simplify-and-verify.sh`.
2. Confirm the failure is exactly the expected three checks (A1, A2, B1) and nothing else — if any other check fails, or fewer than three fail, or simplify-and-verify fails for a reason other than `verify-consistency.sh`, **stop and ask Mike**.
3. If the failure is exactly the expected one, commit the work with this commit message format:
   ```
   feat: add verify-consistency.sh drift checks

   simplify-and-verify intentionally fails: 3 pre-existing drift items
   (A1, A2, B1) detected. Fixes land in INSTRUCTIONS_CATEGORY_TYPE_CONTRACT
   and INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.
   ```
4. Run `bash run-review.sh` against this commit. The reviewer subprocess should approve (the spec was met; the script working-as-designed is not a code defect).
5. Return control to Mike with the simplify-and-verify output and the run-review verdict.

Do NOT attempt to "fix" the drift to make the script pass. The drift fixes are out of scope for this spec.

The implementer returns control to Mike after the commit lands and run-review.sh has produced a verdict.
