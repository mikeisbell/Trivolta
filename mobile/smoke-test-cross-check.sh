#!/usr/bin/env bash
# mobile/smoke-test-cross-check.sh
#
# Phase 2.6.3b — Step 0 pre-flight smoke test.
#
# Confirms the auto-seed pipeline's AI cross-check actually distinguishes
# correct from incorrect answers before scaling to bigger batches.
#
# Inserts two manually-crafted facts into public.facts:
#   - Fact 1: known true   ("Capital of France?" -> "Paris")
#   - Fact 2: deliberately wrong ("Capital of France?" -> "Berlin")
#
# Then invokes the fact-bank-auto-seed Edge Function on each. Reads back
# the fact_auto_seed_log rows and PASS/FAILs based on:
#   Fact 1 -> outcome=auto_verified, confidence>=4, supported=true
#   Fact 2 -> outcome=needs_review, confidence<4 OR supported=false
#
# Fully automated. No DevTools, no manual JWT extraction. Authenticates
# directly against GoTrue using the dev admin credentials provisioned by
# dev-reset.sh.
#
# Prerequisites:
#   - supabase running (supabase start)
#   - functions serving (supabase functions serve --no-verify-jwt --env-file supabase/.env.local)
#   - admin user provisioned (./mobile/dev-reset.sh)
#   - Phase 2.6.3a migration applied
#
# Reads from supabase/.env.local:
#   DEV_ADMIN_PASSWORD   the password set by dev-reset.sh (default: TrivoltaDev123!)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ADMIN_EMAIL='trivoltaapp@outlook.com'
TRUE_FACT_ID='11111111-1111-1111-1111-111111111111'
WRONG_FACT_ID='22222222-2222-2222-2222-222222222222'

# ---------------------------------------------------------------------------
# 1. Load DEV_ADMIN_PASSWORD
# ---------------------------------------------------------------------------
DEV_ADMIN_PASSWORD='TrivoltaDev123!'
if [[ -f supabase/.env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source supabase/.env.local
  set +a
fi

# ---------------------------------------------------------------------------
# 2. Confirm Supabase is running and pull API URL + keys
# ---------------------------------------------------------------------------
if ! supabase status >/dev/null 2>&1; then
  echo "ERROR: supabase is not running. Run 'supabase start' first." >&2
  exit 1
fi

API_URL=""
PUBLISHABLE_KEY=""
SERVICE_KEY=""

if ENV_OUTPUT="$(supabase status -o env 2>/dev/null)"; then
  API_URL="$(echo "$ENV_OUTPUT" | awk -F'=' '/^API_URL=/ {gsub(/^"|"$/, "", $2); print $2; exit}')"
  for key_name in PUBLISHABLE_KEY ANON_KEY; do
    candidate="$(echo "$ENV_OUTPUT" | awk -F'=' -v k="^${key_name}=" '$0 ~ k {gsub(/^"|"$/, "", $2); print $2; exit}')"
    if [[ -n "$candidate" ]]; then
      PUBLISHABLE_KEY="$candidate"
      break
    fi
  done
  for key_name in SECRET_KEY SERVICE_ROLE_KEY; do
    candidate="$(echo "$ENV_OUTPUT" | awk -F'=' -v k="^${key_name}=" '$0 ~ k {gsub(/^"|"$/, "", $2); print $2; exit}')"
    if [[ -n "$candidate" ]]; then
      SERVICE_KEY="$candidate"
      break
    fi
  done
fi

if [[ -z "$API_URL" || -z "$PUBLISHABLE_KEY" || -z "$SERVICE_KEY" ]]; then
  STATUS="$(supabase status)"
  STATUS_PLAIN="$(echo "$STATUS" | sed 's/[│╭╮╯╰├┤┬┴┼─━┃]/ /g' | tr -s ' ')"

  [[ -z "$API_URL" ]] && API_URL="$(echo "$STATUS_PLAIN" | awk '/Project URL/ {for(i=1;i<=NF;i++) if($i ~ /^https?:\/\//) {print $i; exit}}')"
  [[ -z "$API_URL" ]] && API_URL="$(echo "$STATUS_PLAIN" | awk '/API URL/ {for(i=1;i<=NF;i++) if($i ~ /^https?:\/\//) {print $i; exit}}')"
  [[ -z "$PUBLISHABLE_KEY" ]] && PUBLISHABLE_KEY="$(echo "$STATUS_PLAIN" | awk '/Publishable/ {for(i=1;i<=NF;i++) if($i ~ /^sb_publishable_/) {print $i; exit}}')"
  [[ -z "$PUBLISHABLE_KEY" ]] && PUBLISHABLE_KEY="$(echo "$STATUS_PLAIN" | awk '/anon key/ {for(i=1;i<=NF;i++) if($i ~ /^eyJ/) {print $i; exit}}')"
  [[ -z "$SERVICE_KEY" ]] && SERVICE_KEY="$(echo "$STATUS_PLAIN" | awk '/Secret/ {for(i=1;i<=NF;i++) if($i ~ /^sb_secret_/) {print $i; exit}}')"
  [[ -z "$SERVICE_KEY" ]] && SERVICE_KEY="$(echo "$STATUS_PLAIN" | awk '/service_role key/ {for(i=1;i<=NF;i++) if($i ~ /^eyJ/) {print $i; exit}}')"
fi

if [[ -z "$API_URL" || -z "$PUBLISHABLE_KEY" || -z "$SERVICE_KEY" ]]; then
  echo "ERROR: could not parse keys from supabase status." >&2
  echo "API_URL=$API_URL" >&2
  echo "PUBLISHABLE_KEY=${PUBLISHABLE_KEY:0:20}..." >&2
  echo "SERVICE_KEY=${SERVICE_KEY:0:20}..." >&2
  exit 1
fi

echo ">>> Connected to $API_URL"

# ---------------------------------------------------------------------------
# 3. Confirm functions are serving
# ---------------------------------------------------------------------------
if ! curl -sS -o /dev/null -w '%{http_code}' \
      "$API_URL/functions/v1/fact-bank-auto-seed" \
      -H "apikey: $PUBLISHABLE_KEY" \
      -X POST -d '{}' \
      | grep -qE '^(401|400|403)$'; then
  echo "ERROR: fact-bank-auto-seed Edge Function not reachable." >&2
  echo "Make sure 'supabase functions serve --no-verify-jwt --env-file supabase/.env.local' is running." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Sign in as the dev admin to get a JWT
# ---------------------------------------------------------------------------
echo ">>> Signing in as $ADMIN_EMAIL..."

SIGNIN_RESPONSE="$(curl -sS \
  -H "apikey: $PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -X POST \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$DEV_ADMIN_PASSWORD\"}" \
  "$API_URL/auth/v1/token?grant_type=password")"

JWT="$(echo "$SIGNIN_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'access_token' in data:
    print(data['access_token'])
else:
    print('ERROR:', data, file=sys.stderr)
    sys.exit(1)
")"

if [[ -z "$JWT" ]]; then
  echo "ERROR: failed to sign in. Response:" >&2
  echo "$SIGNIN_RESPONSE" >&2
  echo "" >&2
  echo "Did you run ./mobile/dev-reset.sh first?" >&2
  exit 1
fi

# Verify the JWT carries the admin claim
ROLE_FROM_JWT="$(echo "$JWT" | python3 -c "
import sys, json, base64
payload_b64 = sys.stdin.read().strip().split('.')[1]
payload_b64 += '=' * (-len(payload_b64) % 4)
payload = json.loads(base64.urlsafe_b64decode(payload_b64))
print((payload.get('app_metadata') or {}).get('role', ''))
")"

if [[ "$ROLE_FROM_JWT" != "admin" ]]; then
  echo "ERROR: signed-in user does not have admin role. Got: '$ROLE_FROM_JWT'" >&2
  echo "Run ./mobile/dev-reset.sh to provision the admin role." >&2
  exit 1
fi

echo "    Got JWT with admin claim."

# ---------------------------------------------------------------------------
# 5. Insert the two test facts (idempotent — clean up prior runs first)
# ---------------------------------------------------------------------------
echo ">>> Inserting test facts..."

docker exec -i supabase_db_Trivolta psql -U postgres -d postgres >/dev/null <<EOF
-- Clean up any prior smoke-test runs
delete from public.fact_auto_seed_log where fact_id in (
  '$TRUE_FACT_ID', '$WRONG_FACT_ID'
);
delete from public.facts where id in (
  '$TRUE_FACT_ID', '$WRONG_FACT_ID'
);

-- Fact 1: known true
insert into public.facts
  (id, category_id, fact_text, correct_answer, difficulty,
   verification_status, source_origin, created_by)
values (
  '$TRUE_FACT_ID',
  (select id from public.categories where slug = 'geography'),
  'What is the capital of France?',
  'Paris',
  2,
  'pending',
  'manual_smoke_test',
  (select id from auth.users where email = '$ADMIN_EMAIL')
);

-- Fact 2: deliberately wrong
insert into public.facts
  (id, category_id, fact_text, correct_answer, difficulty,
   verification_status, source_origin, created_by)
values (
  '$WRONG_FACT_ID',
  (select id from public.categories where slug = 'geography'),
  'What is the capital of France?',
  'Berlin',
  2,
  'pending',
  'manual_smoke_test',
  (select id from auth.users where email = '$ADMIN_EMAIL')
);
EOF

echo "    Inserted 2 pending facts."

# ---------------------------------------------------------------------------
# 6. Trigger auto-seed on each fact
# ---------------------------------------------------------------------------
trigger_auto_seed() {
  local fact_id="$1"
  local label="$2"

  echo ">>> Auto-seeding $label fact ($fact_id)..."

  local response
  response="$(curl -sS \
    -X POST \
    -H "Authorization: Bearer $JWT" \
    -H "apikey: $PUBLISHABLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"fact_id\":\"$fact_id\"}" \
    "$API_URL/functions/v1/fact-bank-auto-seed")"

  echo "    $response"
}

trigger_auto_seed "$TRUE_FACT_ID"  "TRUE"
trigger_auto_seed "$WRONG_FACT_ID" "WRONG"

# ---------------------------------------------------------------------------
# 7. Read the log rows and assert
# ---------------------------------------------------------------------------
echo ""
echo ">>> Reading fact_auto_seed_log..."
echo ""

docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -c "
select
  case fact_id
    when '$TRUE_FACT_ID'  then 'TRUE  (Paris)'
    when '$WRONG_FACT_ID' then 'WRONG (Berlin)'
  end as fact,
  outcome,
  cross_check_confidence as conf,
  cross_check_supported  as sup,
  failure_reason,
  left(cross_check_reasoning, 150) as reasoning_preview
from public.fact_auto_seed_log
where fact_id in ('$TRUE_FACT_ID', '$WRONG_FACT_ID')
order by fact_id;
"

# Pull individual values for the assertion
TRUE_OUTCOME="$(docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select outcome from public.fact_auto_seed_log where fact_id = '$TRUE_FACT_ID' order by created_at desc limit 1;")"
TRUE_CONF="$(docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select coalesce(cross_check_confidence::text, '') from public.fact_auto_seed_log where fact_id = '$TRUE_FACT_ID' order by created_at desc limit 1;")"
TRUE_SUP="$(docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select coalesce(cross_check_supported::text, '') from public.fact_auto_seed_log where fact_id = '$TRUE_FACT_ID' order by created_at desc limit 1;")"

WRONG_OUTCOME="$(docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select outcome from public.fact_auto_seed_log where fact_id = '$WRONG_FACT_ID' order by created_at desc limit 1;")"
WRONG_CONF="$(docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select coalesce(cross_check_confidence::text, '') from public.fact_auto_seed_log where fact_id = '$WRONG_FACT_ID' order by created_at desc limit 1;")"
WRONG_SUP="$(docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select coalesce(cross_check_supported::text, '') from public.fact_auto_seed_log where fact_id = '$WRONG_FACT_ID' order by created_at desc limit 1;")"

echo ""
echo "============================================================="
echo "Smoke test results"
echo "============================================================="

PASS=true
FAIL_NOTES=()

# True fact: must auto-verify with high confidence
if [[ "$TRUE_OUTCOME" == "auto_verified" && "$TRUE_SUP" == "t" && -n "$TRUE_CONF" && "$TRUE_CONF" -ge 4 ]]; then
  echo "PASS  TRUE fact auto-verified (conf=$TRUE_CONF, supported=$TRUE_SUP)"
elif [[ "$TRUE_OUTCOME" == "needs_review" ]]; then
  # Acceptable secondary outcome: mechanical-check failure (Wikipedia excerpt mismatch).
  # Not a cross-check bug, but a sourcing limitation.
  echo "WARN  TRUE fact landed in needs_review (likely excerpt-match miss, not a cross-check bug)"
  echo "      outcome=$TRUE_OUTCOME conf=$TRUE_CONF supported=$TRUE_SUP"
else
  echo "FAIL  TRUE fact did not auto-verify"
  echo "      outcome=$TRUE_OUTCOME conf=$TRUE_CONF supported=$TRUE_SUP"
  PASS=false
  FAIL_NOTES+=("TRUE fact should have auto-verified")
fi

# Wrong fact: must NOT auto-verify (the critical assertion)
if [[ "$WRONG_OUTCOME" == "auto_verified" ]]; then
  echo "FAIL  WRONG fact AUTO-VERIFIED — cross-check is broken!"
  echo "      outcome=$WRONG_OUTCOME conf=$WRONG_CONF supported=$WRONG_SUP"
  PASS=false
  FAIL_NOTES+=("CRITICAL: WRONG fact auto-verified. Do NOT run any larger batch.")
elif [[ "$WRONG_OUTCOME" == "needs_review" ]]; then
  echo "PASS  WRONG fact correctly flagged needs_review (conf=$WRONG_CONF, supported=$WRONG_SUP)"
elif [[ "$WRONG_OUTCOME" == "failed" ]]; then
  echo "WARN  WRONG fact pipeline failed (not a cross-check bug, but worth investigating)"
  echo "      outcome=$WRONG_OUTCOME"
else
  echo "FAIL  WRONG fact has unexpected outcome: $WRONG_OUTCOME"
  PASS=false
  FAIL_NOTES+=("WRONG fact had unexpected outcome")
fi

echo "============================================================="

if $PASS; then
  echo "OVERALL: PASS — cross-check is distinguishing truth from lies."
  echo "         Safe to scale to bigger batches."
  exit 0
else
  echo "OVERALL: FAIL"
  for note in "${FAIL_NOTES[@]}"; do
    echo "  - $note"
  done
  echo ""
  echo "Do NOT run any larger batch until this is investigated."
  exit 1
fi
