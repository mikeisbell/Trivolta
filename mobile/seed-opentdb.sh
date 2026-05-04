#!/usr/bin/env bash
# mobile/seed-opentdb.sh
#
# Bulk imports facts from OpenTrivia DB (opentdb.com, CC BY-SA 4.0) into the
# local Supabase DB via the fact-bank-import Edge Function. Reuses the dev
# admin user provisioned by mobile/dev-reset.sh. Local-only.
#
# Run mobile/dev-reset.sh once before this script if the admin user
# doesn't exist yet (e.g. after a fresh `supabase db reset`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ADMIN_EMAIL='trivoltaapp@outlook.com'

# ---------------------------------------------------------------------------
# 1. Load DEV_ADMIN_PASSWORD if set in supabase/.env.local. Default matches
#    dev-reset.sh.
# ---------------------------------------------------------------------------
DEV_ADMIN_PASSWORD='TrivoltaDev123!'
if [[ -f supabase/.env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source supabase/.env.local
  set +a
fi

# ---------------------------------------------------------------------------
# 2. Confirm Supabase is running
# ---------------------------------------------------------------------------
if ! supabase status >/dev/null 2>&1; then
  echo "ERROR: supabase is not running. Run 'supabase start' first." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Pull API URL + publishable key from `supabase status -o env`
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
# 4. Sign in as admin to get a real user JWT
# ---------------------------------------------------------------------------
JWT_RESPONSE="$(curl -sS "$API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$DEV_ADMIN_PASSWORD\"}")"

JWT="$(echo "$JWT_RESPONSE" | python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get('access_token',''))
except Exception:
  print('')")"

if [[ -z "$JWT" ]]; then
  echo "ERROR: failed to sign in as $ADMIN_EMAIL." >&2
  echo "Run mobile/dev-reset.sh first to provision the dev admin user." >&2
  exit 3
fi

# ---------------------------------------------------------------------------
# 5. Loop OpenTrivia DB categories and batches
#
# Empty CAT_ID = no &category param (returns "General Knowledge"-style mix).
# OpenTrivia DB rate-limits aggressively; one request per 5s minimum.
# ---------------------------------------------------------------------------
CAT_IDS=("" "11" "12" "17" "22" "23" "21" "10" "25" "26" "14" "15" "18" "19" "20" "27" "28" "29" "31" "32")
LABELS=("general" "film" "music" "science" "geography" "history" "sports" "literature" "art" "pop_culture" "television" "video_games" "computers" "mathematics" "mythology" "animals" "vehicles" "comics" "anime" "cartoons")
BATCHES_PER_CATEGORY=8
AMOUNT=50

TOTAL_IMPORTED=0
TOTAL_DUP=0
TOTAL_UNK=0
TOTAL_FAILED=0
START_TS=$(date +%s)

for idx in "${!CAT_IDS[@]}"; do
  CAT_ID="${CAT_IDS[$idx]}"
  LABEL="${LABELS[$idx]}"
  for i in $(seq 1 $BATCHES_PER_CATEGORY); do
    URL="https://opentdb.com/api.php?amount=${AMOUNT}&type=multiple"
    if [[ -n "$CAT_ID" ]]; then
      URL="${URL}&category=${CAT_ID}"
    fi

    attempt=1
    while true; do
      RAW="$(curl -sS "$URL" || echo '{"response_code":99,"results":[]}')"
      CODE="$(echo "$RAW" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  print(d.get('response_code', 99))
except Exception:
  print(99)" 2>/dev/null || echo 99)"

      if [[ "$CODE" == "5" && $attempt -lt 2 ]]; then
        echo "[$LABEL] batch $i — rate limited (response_code=5), sleeping 30s before retry"
        sleep 30
        attempt=$((attempt + 1))
        continue
      fi
      break
    done

    if [[ "$CODE" != "0" ]]; then
      echo "[$LABEL] batch $i/$BATCHES_PER_CATEGORY → response_code=$CODE, skipping"
      sleep 5
      continue
    fi

    # Extract the results array (drops response_code from the payload).
    # Re-wrap as {results: [...]} so the Edge Function routes to its
    # OpenTrivia DB adapter and writes source_origin='opentdb_import'.
    PAYLOAD="$(echo "$RAW" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(json.dumps({'results': d.get('results', [])}))")"

    RESULTS_LEN="$(echo "$PAYLOAD" | python3 -c "
import sys, json
print(len(json.load(sys.stdin).get('results', [])))" 2>/dev/null || echo 0)"

    if [[ "$RESULTS_LEN" == "0" ]]; then
      echo "[$LABEL] batch $i/$BATCHES_PER_CATEGORY → empty results, skipping"
      sleep 5
      continue
    fi

    RESP="$(curl -sS -X POST "$API_URL/functions/v1/fact-bank-import" \
      -H "apikey: $PUBLISHABLE_KEY" \
      -H "Authorization: Bearer $JWT" \
      -H "Content-Type: application/json" \
      --data-binary "$PAYLOAD" || echo '{"imported":0,"skipped_duplicate":0,"skipped_unknown_category":0,"failed":1}')"

    READ='import sys, json
try:
  d = json.load(sys.stdin)
  print(d.get("imported", 0), d.get("skipped_duplicate", 0), d.get("skipped_unknown_category", 0), d.get("failed", 0))
except Exception:
  print(0, 0, 0, 1)'

    read -r IMP DUP UNK FAIL < <(echo "$RESP" | python3 -c "$READ" 2>/dev/null || echo "0 0 0 1")

    echo "[$LABEL] batch $i/$BATCHES_PER_CATEGORY → imported=$IMP skipped_duplicate=$DUP skipped_unknown_category=$UNK failed=$FAIL"
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + IMP))
    TOTAL_DUP=$((TOTAL_DUP + DUP))
    TOTAL_UNK=$((TOTAL_UNK + UNK))
    TOTAL_FAILED=$((TOTAL_FAILED + FAIL))
    sleep 5
  done
done

ELAPSED=$(($(date +%s) - START_TS))
echo
echo "=== OpenTrivia DB seed complete ==="
echo "imported:                  $TOTAL_IMPORTED"
echo "skipped_duplicate:         $TOTAL_DUP"
echo "skipped_unknown_category:  $TOTAL_UNK"
echo "failed:                    $TOTAL_FAILED"
echo "elapsed:                   ${ELAPSED}s"
