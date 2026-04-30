#!/usr/bin/env bash
# mobile/seed-trivia-api.sh
#
# Bulk imports ~5,000 facts from The Trivia API into the local Supabase DB
# via the fact-bank-import Edge Function. Reuses the dev admin user
# provisioned by mobile/dev-reset.sh. Local-only.
#
# Run mobile/dev-reset.sh once before this script if the admin user
# doesn't exist yet (e.g. after a fresh `supabase db reset`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ADMIN_EMAIL='trivoltaapp@outlook.com'

# ---------------------------------------------------------------------------
# 1. Load DEV_ADMIN_PASSWORD if set in supabase/.env.local (same source as
#    dev-reset.sh). Default to TrivoltaDev123! to match dev-reset.sh.
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
# 5. Loop categories and batches
# ---------------------------------------------------------------------------
CATEGORIES=(general_knowledge geography history science music film_and_tv arts_and_literature society_and_culture sport_and_leisure food_and_drink)
BATCHES_PER_CATEGORY=10
LIMIT=50

TOTAL_IMPORTED=0
TOTAL_DUP=0
TOTAL_UNK=0
TOTAL_FAILED=0
START_TS=$(date +%s)

for cat in "${CATEGORIES[@]}"; do
  for i in $(seq 1 $BATCHES_PER_CATEGORY); do
    PAYLOAD="$(curl -sS "https://the-trivia-api.com/api/questions?categories=$cat&limit=$LIMIT" || echo '[]')"
    if [[ -z "$PAYLOAD" ]]; then
      PAYLOAD='[]'
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

    echo "[$cat] batch $i/$BATCHES_PER_CATEGORY → imported=$IMP skipped_duplicate=$DUP skipped_unknown_category=$UNK failed=$FAIL"
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + IMP))
    TOTAL_DUP=$((TOTAL_DUP + DUP))
    TOTAL_UNK=$((TOTAL_UNK + UNK))
    TOTAL_FAILED=$((TOTAL_FAILED + FAIL))
    sleep 0.25
  done
done

ELAPSED=$(($(date +%s) - START_TS))
echo
echo "=== Bulk seed complete ==="
echo "imported:                  $TOTAL_IMPORTED"
echo "skipped_duplicate:         $TOTAL_DUP"
echo "skipped_unknown_category:  $TOTAL_UNK"
echo "failed:                    $TOTAL_FAILED"
echo "elapsed:                   ${ELAPSED}s"
