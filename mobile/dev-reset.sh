#!/usr/bin/env bash
# mobile/dev-reset.sh
#
# Wipes the local Supabase DB, re-applies all migrations, recreates the
# admin user (trivoltaapp@outlook.com), and grants the admin role.
#
# After this runs you can sign into localhost:8081 (Expo Web) or the iOS
# Simulator with the credentials printed at the end. The new JWT will
# carry app_metadata.role = 'admin'.
#
# Reads from supabase/.env.local:
#   DEV_ADMIN_PASSWORD   the password to set on the dev admin user
#                        (default: TrivoltaDev123! if unset)
#
# Reads from `supabase status` at runtime:
#   API URL              local Supabase project URL
#   service_role / sb_secret_*  service-role key for the auth admin API
#
# Safe to run repeatedly. Idempotent: skips user creation if the user
# already exists, just re-grants the role.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ADMIN_EMAIL='trivoltaapp@outlook.com'
ADMIN_USERNAME='mike'

# ---------------------------------------------------------------------------
# 1. Load DEV_ADMIN_PASSWORD if set in supabase/.env.local
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
# 3. db reset (wipes auth.users, applies all migrations)
# ---------------------------------------------------------------------------
echo ">>> Resetting local database..."
supabase db reset

# ---------------------------------------------------------------------------
# 4. Pull API URL + service-role key from `supabase status -o env`
#
# The boxed human output of `supabase status` uses Unicode separators that
# are awkward to parse. Recent CLI versions support `-o env` for a clean
# KEY=VALUE format. Fall back to the boxed format if `-o env` isn't supported.
# ---------------------------------------------------------------------------
API_URL=""
SERVICE_KEY=""

if ENV_OUTPUT="$(supabase status -o env 2>/dev/null)"; then
  API_URL="$(echo "$ENV_OUTPUT" | awk -F'=' '/^API_URL=/ {gsub(/^"|"$/, "", $2); print $2; exit}')"
  # Try common env var names for the service-role key. Order matters: prefer
  # the new-key naming, fall back to legacy.
  for key_name in SECRET_KEY SERVICE_ROLE_KEY; do
    candidate="$(echo "$ENV_OUTPUT" | awk -F'=' -v k="^${key_name}=" '$0 ~ k {gsub(/^"|"$/, "", $2); print $2; exit}')"
    if [[ -n "$candidate" ]]; then
      SERVICE_KEY="$candidate"
      break
    fi
  done
fi

if [[ -z "$API_URL" || -z "$SERVICE_KEY" ]]; then
  # Fallback: parse the human boxed format. Strip Unicode box chars and
  # collapse whitespace so we can match by label keyword.
  STATUS="$(supabase status)"
  STATUS_PLAIN="$(echo "$STATUS" | sed 's/[│╭╮╯╰├┤┬┴┼─━┃]/ /g' | tr -s ' ')"

  API_URL="$(echo "$STATUS_PLAIN" | awk '/Project URL/ {for(i=1;i<=NF;i++) if($i ~ /^https?:\/\//) {print $i; exit}}')"
  if [[ -z "$API_URL" ]]; then
    API_URL="$(echo "$STATUS_PLAIN" | awk '/API URL/ {for(i=1;i<=NF;i++) if($i ~ /^https?:\/\//) {print $i; exit}}')"
  fi

  # Match either `Secret  sb_secret_...` or `service_role key  eyJ...`
  SERVICE_KEY="$(echo "$STATUS_PLAIN" | awk '/Secret/ {for(i=1;i<=NF;i++) if($i ~ /^sb_secret_/) {print $i; exit}}')"
  if [[ -z "$SERVICE_KEY" ]]; then
    SERVICE_KEY="$(echo "$STATUS_PLAIN" | awk '/service_role key/ {for(i=1;i<=NF;i++) if($i ~ /^eyJ/) {print $i; exit}}')"
  fi
fi

if [[ -z "$API_URL" || -z "$SERVICE_KEY" ]]; then
  echo "ERROR: could not parse API URL or service key from supabase status." >&2
  echo "----- supabase status -o env -----" >&2
  supabase status -o env 2>&1 >&2 || true
  echo "----- supabase status (boxed) -----" >&2
  supabase status >&2 || true
  exit 1
fi

echo "    API URL:     $API_URL"
echo "    Service key: ${SERVICE_KEY:0:20}... (${#SERVICE_KEY} chars)"

# ---------------------------------------------------------------------------
# 5. Create or look up the admin user via the GoTrue admin API
# ---------------------------------------------------------------------------
echo ">>> Ensuring admin user $ADMIN_EMAIL exists..."

EXISTING_ID="$(curl -sS \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  "$API_URL/auth/v1/admin/users?per_page=200" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
users = data.get('users', data) if isinstance(data, dict) else data
for u in users:
    if u.get('email') == '$ADMIN_EMAIL':
        print(u['id'])
        break
")"

if [[ -n "$EXISTING_ID" ]]; then
  echo "    User already exists (id=$EXISTING_ID). Skipping create."
  USER_ID="$EXISTING_ID"
else
  CREATE_RESPONSE="$(curl -sS \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$DEV_ADMIN_PASSWORD\",\"email_confirm\":true}" \
    "$API_URL/auth/v1/admin/users")"

  USER_ID="$(echo "$CREATE_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'id' in data:
    print(data['id'])
else:
    print('ERROR:', data, file=sys.stderr)
    sys.exit(1)
")"

  if [[ -z "$USER_ID" ]]; then
    echo "ERROR: failed to create admin user. Response:" >&2
    echo "$CREATE_RESPONSE" >&2
    exit 1
  fi

  echo "    Created user id=$USER_ID"

  # Insert the profiles row to match what the mobile signup flow does.
  curl -sS \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -X POST \
    -d "{\"id\":\"$USER_ID\",\"username\":\"$ADMIN_USERNAME\"}" \
    "$API_URL/rest/v1/profiles" >/dev/null
fi

# ---------------------------------------------------------------------------
# 6. Grant admin role via raw_app_meta_data
# ---------------------------------------------------------------------------
echo ">>> Granting admin role..."

curl -sS \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -X PUT \
  -d '{"app_metadata":{"role":"admin"}}' \
  "$API_URL/auth/v1/admin/users/$USER_ID" >/dev/null

# Belt-and-suspenders: confirm the grant via SQL. If anyone changes
# the GoTrue endpoint shape in a future Supabase release this catches it.
ROLE_CHECK="$(docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select raw_app_meta_data ->> 'role' from auth.users where email = '$ADMIN_EMAIL';")"

if [[ "$ROLE_CHECK" != "admin" ]]; then
  echo "ERROR: admin role grant did not stick. Got: '$ROLE_CHECK'" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 7. Print credentials and next steps
# ---------------------------------------------------------------------------
cat <<EOF

=============================================================
Dev reset complete.

Admin credentials (local only):
  email:    $ADMIN_EMAIL
  password: $DEV_ADMIN_PASSWORD
  role:     admin

Next steps:
  1. Make sure 'supabase functions serve --no-verify-jwt --env-file supabase/.env.local'
     is running in another terminal.
  2. In the iOS Simulator or Expo Web, sign in with the credentials above.
     Sign OUT and back IN if the app already has a stale session.
  3. Navigate to /admin (Expo Web only — admin tooling lives at
     localhost:8081/admin).

To override the password, set DEV_ADMIN_PASSWORD in supabase/.env.local
before running this script.
=============================================================
EOF
