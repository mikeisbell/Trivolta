#!/usr/bin/env bash
# mobile/regenerate-distractors.sh
#
# Bulk-regenerates distractors for every eligible fact imported from
# The Trivia API. For each eligible fact this calls the local
# fact-bank-generate-distractors Edge Function with apply=true. The
# function deactivates the imported distractors and inserts three new
# ai-cached distractors that have been generated and ambiguity-scored
# by Haiku 4.5. Local-only, sequential, resumable.
#
# Eligibility: facts with source_origin = 'trivia_api_import' AND
# is_high_value = false AND no active ai-cached distractor row yet.
#
# Usage:
#   ./mobile/regenerate-distractors.sh                     # process all eligible
#   ./mobile/regenerate-distractors.sh --limit 5           # smoke-test 5 facts
#   ./mobile/regenerate-distractors.sh --sleep 500         # 500ms between calls
#   ./mobile/regenerate-distractors.sh --restart           # delete checkpoint first
#   ./mobile/regenerate-distractors.sh --restart --limit 1 # full re-do, single fact
#   ./mobile/regenerate-distractors.sh --help              # print this header
#
# Resumes after the last successfully-processed fact_id via a checkpoint
# file at /tmp/trivolta-f1-checkpoint.txt. The function itself enforces
# admin auth, rate limits, and idempotency, so re-runs are safe.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ADMIN_EMAIL='trivoltaapp@outlook.com'
DB_CONTAINER='supabase_db_Trivolta'
CHECKPOINT='/tmp/trivolta-f1-checkpoint.txt'

# Rough Haiku 4.5 estimates: ~$0.003 per successful generate+validate pair,
# ~$0.009 per validation_failed pair (which retried up to 2 extra times).
# These numbers are informational only, not authoritative billing.
COST_PER_SUCCESS=0.003
COST_PER_VALIDATION_FAILURE=0.009

# ---------------------------------------------------------------------------
# CLI flag parsing
# ---------------------------------------------------------------------------
LIMIT=0
SLEEP_MS=250
RESTART=false

print_help() {
  # Print the leading comment block of this file (everything up to the first
  # blank-after-comment), without the leading "# " prefix.
  awk '
    NR == 1 { next }
    /^#/ { sub(/^# ?/, ""); print; next }
    { exit }
  ' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      shift
      LIMIT="${1:-0}"
      shift
      ;;
    --sleep)
      shift
      SLEEP_MS="${1:-250}"
      shift
      ;;
    --restart)
      RESTART=true
      shift
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "ERROR: unknown flag: $1" >&2
      echo "Run with --help for usage." >&2
      exit 64
      ;;
  esac
done

# Convert SLEEP_MS to fractional seconds for the sleep builtin.
SLEEP_SEC="$(awk -v ms="$SLEEP_MS" 'BEGIN { printf "%.3f", ms / 1000 }')"

# ---------------------------------------------------------------------------
# Env load — same source as seed-trivia-api.sh / dev-reset.sh
# ---------------------------------------------------------------------------
DEV_ADMIN_PASSWORD='TrivoltaDev123!'
if [[ -f supabase/.env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source supabase/.env.local
  set +a
fi

# ---------------------------------------------------------------------------
# Confirm Supabase is running
# ---------------------------------------------------------------------------
if ! supabase status >/dev/null 2>&1; then
  echo "ERROR: supabase is not running. Run 'supabase start' first." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Pull API URL + publishable key from `supabase status -o env`
# ---------------------------------------------------------------------------
API_URL=""
PUBLISHABLE_KEY=""
if ENV_OUTPUT="$(supabase status -o env 2>/dev/null)"; then
  API_URL="$(echo "$ENV_OUTPUT" | awk -F'=' '/^API_URL=/ {gsub(/^"|"$/, "", $2); print $2; exit}')"
  for key_name in PUBLISHABLE_KEY ANON_KEY; do
    candidate="$(echo "$ENV_OUTPUT" | awk -F'=' -v k="^${key_name}=" '$0 ~ k {gsub(/^"|"$/, "", $2); print $2; exit}')"
    if [[ -n "$candidate" ]]; then
      PUBLISHABLE_KEY="$candidate"
      break
    fi
  done
fi

if [[ -z "$API_URL" || -z "$PUBLISHABLE_KEY" ]]; then
  echo "ERROR: could not parse API URL or publishable key from supabase status." >&2
  exit 1
fi

# Localhost guard — never run against production.
if [[ "$API_URL" != http://127.0.0.1:* && "$API_URL" != http://localhost:* ]]; then
  echo "Refusing to run against non-local API URL: $API_URL" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Sign in as admin to get a real user JWT
#
# Supabase JWTs default to a 3600s TTL. Bulk runs that exceed an hour must
# re-mint the JWT mid-run or the function starts returning 401. The script
# refreshes when the JWT is older than JWT_REFRESH_AFTER_SEC.
# ---------------------------------------------------------------------------
JWT_REFRESH_AFTER_SEC=3000

sign_in_admin() {
  local response
  response="$(curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $PUBLISHABLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$DEV_ADMIN_PASSWORD\"}")"
  echo "$response" | python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get('access_token',''))
except Exception:
  print('')"
}

JWT="$(sign_in_admin)"
JWT_ISSUED_AT=$(date +%s)

if [[ -z "$JWT" ]]; then
  echo "ERROR: failed to sign in as $ADMIN_EMAIL." >&2
  echo "Run mobile/dev-reset.sh first to provision the dev admin user." >&2
  exit 3
fi

# ---------------------------------------------------------------------------
# Checkpoint handling
# ---------------------------------------------------------------------------
if [[ "$RESTART" == "true" ]]; then
  rm -f "$CHECKPOINT"
fi

LAST_DONE=""
if [[ -f "$CHECKPOINT" ]]; then
  LAST_DONE="$(tr -d '[:space:]' < "$CHECKPOINT")"
fi
if [[ -n "$LAST_DONE" ]]; then
  echo "Resuming after fact_id: $LAST_DONE"
fi

# ---------------------------------------------------------------------------
# Eligibility query
# ---------------------------------------------------------------------------
SQL="select f.id from public.facts f
where f.source_origin = 'trivia_api_import'
  and f.is_high_value = false
  and not exists (
    select 1 from public.distractors d
    where d.fact_id = f.id
      and d.authored_by = 'ai-cached'
      and d.is_active = true
  )"

if [[ -n "$LAST_DONE" ]]; then
  SQL+=$'\n  and f.id > \''"$LAST_DONE"$'\''
fi

SQL+=$'\norder by f.id'

if [[ "$LIMIT" -gt 0 ]]; then
  SQL+=$'\nlimit '"$LIMIT"
fi

# Capture eligible fact_ids into an array (bash 3.2 compatible — no mapfile).
IDS=()
while IFS= read -r line; do
  if [[ -n "$line" ]]; then
    IDS+=("$line")
  fi
done < <(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tAc "$SQL")

TOTAL="${#IDS[@]}"

if [[ "$TOTAL" -eq 0 ]]; then
  echo "No eligible facts. Nothing to do."
  exit 0
fi

echo "Eligible facts: $TOTAL  (sleep ${SLEEP_MS}ms between calls)"

# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------
SUCCEEDED=0
VAL_FAILED=0
HTTP_ERROR=0
SKIPPED_ALREADY=0
START_TS=$(date +%s)

# ---------------------------------------------------------------------------
# Main loop — sequential, paced, resumable
# ---------------------------------------------------------------------------
PARSE_PY='import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("ERR|||||")
    sys.exit(0)
ok = d.get("ok")
applied = d.get("applied")
reason = d.get("reason", "")
scores = d.get("scores", [])
quality = d.get("quality_score", "")
print("OK|" + repr(ok) + "|" + repr(applied) + "|" + str(reason) + "|" + json.dumps(scores) + "|" + str(quality))'

for i in "${!IDS[@]}"; do
  ID="${IDS[$i]}"
  N=$((i + 1))

  # Refresh JWT before it hits the 3600s TTL.
  if (( $(date +%s) - JWT_ISSUED_AT >= JWT_REFRESH_AFTER_SEC )); then
    NEW_JWT="$(sign_in_admin)"
    if [[ -n "$NEW_JWT" ]]; then
      JWT="$NEW_JWT"
      JWT_ISSUED_AT=$(date +%s)
      echo "    (refreshed admin JWT)"
    else
      echo "    (WARN: JWT refresh failed — will retry on next iteration)"
    fi
  fi

  RESP="$(curl -sS -X POST "$API_URL/functions/v1/fact-bank-generate-distractors" \
    -H "apikey: $PUBLISHABLE_KEY" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"fact_id\":\"$ID\",\"apply\":true}" || echo '{"__transport_error":true}')"

  PARSED="$(echo "$RESP" | python3 -c "$PARSE_PY" 2>/dev/null || echo 'ERR|||||')"

  IFS='|' read -r TAG OK APPLIED REASON SCORES QUALITY <<< "$PARSED"

  if [[ "$TAG" == "OK" && "$OK" == "True" && "$APPLIED" == "True" ]]; then
    SUCCEEDED=$((SUCCEEDED + 1))
    echo "[$N/$TOTAL] $ID → ok  scores=$SCORES  quality=$QUALITY"
    echo "$ID" > "$CHECKPOINT"
  elif [[ "$TAG" == "OK" && "$OK" == "True" && "$REASON" == "already_regenerated" ]]; then
    SKIPPED_ALREADY=$((SKIPPED_ALREADY + 1))
    echo "[$N/$TOTAL] $ID → skipped_already_regenerated  scores=[]  quality="
    echo "$ID" > "$CHECKPOINT"
  elif [[ "$TAG" == "OK" && "$OK" == "False" && "$REASON" == "validation_failed" ]]; then
    VAL_FAILED=$((VAL_FAILED + 1))
    echo "[$N/$TOTAL] $ID → validation_failed  scores=$SCORES  quality="
    echo "$ID" > "$CHECKPOINT"
  else
    HTTP_ERROR=$((HTTP_ERROR + 1))
    echo "[$N/$TOTAL] $ID → http_error or unknown response  scores=[]  quality="
    # Do NOT advance checkpoint — re-run will retry this fact.
  fi

  sleep "$SLEEP_SEC"
done

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
ELAPSED=$(($(date +%s) - START_TS))
COST="$(awk -v s="$SUCCEEDED" -v v="$VAL_FAILED" \
  -v cs="$COST_PER_SUCCESS" -v cv="$COST_PER_VALIDATION_FAILURE" \
  'BEGIN { printf "%.2f", s * cs + v * cv }')"

echo
echo "=== F1 distractor regen complete ==="
echo "total processed:               $TOTAL"
echo "succeeded:                     $SUCCEEDED"
echo "validation_failed:             $VAL_FAILED"
echo "http_error:                    $HTTP_ERROR"
echo "skipped_already_regenerated:   $SKIPPED_ALREADY"
echo "elapsed:                       ${ELAPSED}s"
echo "estimated cost:                \$${COST}  (rough Haiku 4.5 estimate, not authoritative)"
