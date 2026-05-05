#!/usr/bin/env bash
# verify-consistency.sh
#
# Runs six grep-based drift checks against the codebase. Each check is a
# hard block: any failure exits 1 and the simplify-and-verify pipeline
# aborts. New drift classes get their own check function appended below.
#
# This is the cross-file detection backstop for the Tech Debt Audit
# (TECH_DEBT_AUDIT_2026_05_04.md). Future audits add checks here.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# A1: Every category id referenced in mobile CATEGORIES consts must match a
#     slug in the DB seed. Catches drift like `pop_culture` vs `pop-culture`.
# ---------------------------------------------------------------------------
check_a1_mobile_db_slug_consistency() {
  local mobile_slugs db_slugs missing_in_db
  mobile_slugs=$(grep -hE "^[[:space:]]*\{ id: '[a-z_-]+'" \
      "mobile/app/(tabs)/index.tsx" \
      mobile/app/lobby/create.tsx 2>/dev/null \
    | grep -oE "id: '[a-z_-]+'" \
    | sed -E "s/id: '(.+)'/\1/" \
    | sort -u)

  # One slug per matching INSERT row (the leading quoted token).
  db_slugs=$(grep -E "^[[:space:]]*\('[a-z-]+'," \
      supabase/migrations/20240106000000_fact_bank_schema.sql 2>/dev/null \
    | sed -E "s/^[[:space:]]*\('([^']+)'.*/\1/" \
    | sort -u)

  missing_in_db=$(comm -23 <(echo "$mobile_slugs") <(echo "$db_slugs"))
  if [ -n "$missing_in_db" ]; then
    echo "FAIL [A1] mobile slugs not found in DB seed:"
    echo "$missing_in_db" | sed 's/^/  /'
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# A2: No hardcoded category fallback strings in mobile code outside the
#     canonical mobile/lib/categories.ts module (which doesn't exist yet but
#     will once INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md lands).
# ---------------------------------------------------------------------------
check_a2_no_hardcoded_category_fallbacks() {
  local violations
  violations=$(grep -rnE "\?\? *['\"](general|general knowledge|science|history|sports)['\"]" \
      mobile/app mobile/lib \
      --exclude='categories.ts' \
      --include='*.ts' --include='*.tsx' 2>/dev/null || true)

  if [ -n "$violations" ]; then
    echo "FAIL [A2] hardcoded category fallback strings outside mobile/lib/categories.ts:"
    echo "$violations" | sed 's/^/  /'
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# B1: If mobile UI claims AI generation, the corresponding gameplay Edge
#     Function must actually call Anthropic. Catches stale "AI-generated"
#     copy left over after a function gets switched to a DB lookup.
# ---------------------------------------------------------------------------
check_b1_ai_generation_ui_claims() {
  local ui_claims solo_uses_anthropic
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
  return 0
}

# ---------------------------------------------------------------------------
# C1: SUPABASE_SERVICE_ROLE_KEY must not appear in user-facing Edge Functions.
#     Admin-only fact-bank-* functions and _shared modules are allowed.
# ---------------------------------------------------------------------------
check_c1_no_service_role_in_user_functions() {
  local user_facing_functions=(
    solo-question
    generate-questions
    daily-challenge
    create-lobby
    join-lobby
    submit-feedback
    submit-spot-check
  )
  local violations="" hits fn
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
  return 0
}

# ---------------------------------------------------------------------------
# D1: After 20240110000000_relax_facts_read_for_beta.sql, no migration may
#     reintroduce verification_status = 'verified' as an RLS predicate
#     except a deliberate *restore_facts_verification* migration.
# ---------------------------------------------------------------------------
check_d1_no_verified_rls_predicate() {
  local violations
  # 20240107000000_auto_seed contains the literal in a trigger-function IF
  # body, not an RLS predicate. Whitelisted alongside schema and relax.
  violations=$(grep -lE "verification_status[[:space:]]*=[[:space:]]*'verified'" \
      supabase/migrations/*.sql 2>/dev/null \
    | grep -vE "20240106000000_fact_bank_schema|20240107000000_auto_seed|20240110000000_relax_facts_read_for_beta|restore_facts_verification" \
    || true)

  if [ -n "$violations" ]; then
    echo "FAIL [D1] verification_status = 'verified' RLS predicate found in unexpected migration:"
    echo "$violations" | sed 's/^/  /'
    echo "  Restoration must be in a migration named *restore_facts_verification*."
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# D2: New migrations must use real-date YYYYMMDD timestamps. Existing
#     2024-01-XX migrations are grandfathered; the list below is the
#     registry. Any new file with a 2024-01 prefix is a violation.
# ---------------------------------------------------------------------------
check_d2_migration_timestamp_format() {
  local existing_grandfathered=(
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

  local violations="" filename is_grandfathered f g
  for f in supabase/migrations/2024*.sql; do
    [ -e "$f" ] || continue
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
    printf '%s' "$violations" | sed 's/^/  /'
    echo "  New migrations must use real-date format YYYYMMDD000000 (e.g. 20260504000000_*.sql)."
    return 1
  fi
  return 0
}

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
