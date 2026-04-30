# INSTRUCTIONS — Phase 2.6.3e: Bulk seed ~5,000 facts from The Trivia API

## Task

Mike needs the local Supabase DB populated with ~5,000 trivia facts so he can test the app on his iPhone against realistic data volume. The Trivia API is the source. Two pieces of work:

1. **Importer dedupe.** Add fact-text deduplication to `fact-bank-import` so re-importing overlapping API responses doesn't create duplicate `facts` rows. Two passes: within-batch dedupe (same fact text appears twice in one paste) and cross-batch dedupe (fact text already exists in DB for the same category). Add a `skipped_duplicate` counter to the response.

2. **Seed script.** Create `mobile/seed-trivia-api.sh` that loops 10 Trivia API top-level categories, pulling 10 batches of 50 questions per category (500/category × 10 = ~5,000 raw rows; actual imported count will be lower due to dedupe). Each batch is POSTed to the local `fact-bank-import` Edge Function with admin JWT. Script reports per-category and total counters.

Credentials are already provisioned by `mobile/dev-reset.sh` — `seed-trivia-api.sh` reuses them rather than introducing a new credential file. The dev admin user is `trivoltaapp@outlook.com`; password comes from `DEV_ADMIN_PASSWORD` in `supabase/.env.local` (default `TrivoltaDev123!`). The seed script reads from the same env file `dev-reset.sh` reads from. No new env vars in `.env.maestro`.

After both ship, Mike runs `dev-reset.sh` (or already has a populated admin user from a previous run), then `seed-trivia-api.sh`, confirms the DB is populated via verification SQL, then plays on iPhone.

This is **local-only work**. No production deploy. The seed script is for dev convenience and never runs in CI.

## Verifiable objective

- [ ] `fact-bank-import` response JSON includes a new `skipped_duplicate: number` field, populated for both OpenTrivia DB and Trivia API source paths.
- [ ] Within-batch dedupe: pasting a payload where the same `fact_text` appears twice imports it once and increments `skipped_duplicate` by 1.
- [ ] Cross-batch dedupe: re-running the same payload a second time imports zero new rows and increments `skipped_duplicate` by the full batch size on the second run.
- [ ] Dedupe is scoped per `category_id` (a fact with identical text under a different category is allowed). Comparison is on the **post-decode, post-stripNbsp** `factText` value, not the raw input.
- [ ] `mobile/seed-trivia-api.sh` exists, is executable (`chmod +x`), and runs against a started local Supabase stack with no manual edits required at runtime.
- [ ] The script reads `DEV_ADMIN_PASSWORD` (and falls back to `TrivoltaDev123!`) from `supabase/.env.local` — same source `dev-reset.sh` uses. No new credential files.
- [ ] The script signs in as `trivoltaapp@outlook.com` via `/auth/v1/token?grant_type=password` to obtain a real user JWT (NOT the service-role key — the Edge Function checks `app_metadata.role === 'admin'` on the JWT user, not service-role bypass).
- [ ] The script reads the API URL and publishable key from `supabase status -o env` at runtime (same parsing pattern as `dev-reset.sh`), so a fresh `supabase start` produces a working script with no hardcoding.
- [ ] The script loops these 10 Trivia API categories: `general_knowledge`, `geography`, `history`, `science`, `music`, `film_and_tv`, `arts_and_literature`, `society_and_culture`, `sport_and_leisure`, `food_and_drink`. For each, 10 sequential requests with `limit=50` and a 250ms delay between requests.
- [ ] Per-category progress is printed to stdout in the form `[geography] batch 3/10 → imported=42 skipped_duplicate=8 failed=0`.
- [ ] Final summary printed: total imported, total skipped_duplicate, total skipped_unknown_category, total failed, elapsed time.
- [ ] Script bails with a clear error if the parsed API URL is not localhost / 127.0.0.1, if the admin sign-in fails, or if `supabase status` returns non-zero.
- [ ] If `trivoltaapp@outlook.com` does not exist or sign-in fails, the script prints `Run mobile/dev-reset.sh first to provision the dev admin user.` and exits non-zero.
- [ ] `cd mobile && npx tsc --noEmit` exits 0.
- [ ] After running the script against a freshly-reset DB, the following SQL returns ≥3,500 rows and shows non-zero counts in at least 8 distinct slugs:
  ```sql
  select c.slug, count(*) from facts f
  join categories c on c.id = f.category_id
  where f.source_origin = 'trivia_api_import'
  group by c.slug order by count(*) desc;
  ```
- [ ] After running the script, every imported fact has 3 distractors:
  ```sql
  select count(*) from facts f
  where f.source_origin = 'trivia_api_import'
    and (select count(*) from distractors d where d.fact_id = f.id) <> 3;
  -- must return 0
  ```
- [ ] All 25 Maestro tests still pass after the import (the data volume increase shouldn't affect them — `verification_status = 'pending'` filter still excludes these from gameplay locally).

## Constraints

- **Do not** add a unique constraint or migration on `facts.fact_text`. Dedupe lives in the importer only.
- **Do not** dedupe globally across all categories. Same text under different `category_id` is allowed (some questions legitimately fit multiple categories).
- **Do not** change the existing `imported`, `imported_ids`, `skipped_non_multiple`, `skipped_unknown_category`, `failed`, `errors`, or `source` response fields. Only add `skipped_duplicate`.
- **Do not** modify `supabase/functions/_shared/trivia-api-category-map.ts` or `opentdb-category-map.ts`.
- **Do not** modify `mobile/dev-reset.sh`. Only read its env-loading pattern as a reference.
- **Do not** add new env vars to `mobile/maestro/.env.maestro`. Credentials live in `supabase/.env.local` only, alongside `DEV_ADMIN_PASSWORD`.
- **Do not** add the seed script to any CI workflow, package.json script, or Maestro flow. It is a manual convenience tool.
- **Do not** call the production Supabase URL from the script. Read API URL from `supabase status -o env` and add a guard at the top of the script that bails if the parsed URL is not localhost/127.0.0.1.
- **Do not** add a "Fetch from Trivia API" button to the admin UI. Script is shell-only.
- **Do not** use `set -e` alone; use `set -euo pipefail` and explicit error handling so a single failed batch doesn't kill the whole 100-batch run. Failed batches log a warning and continue.
- **Do not** introduce any dedupe logic that issues a query per row. Use a single `select fact_text from facts where category_id = $1` per batch and dedupe in memory against that set plus the within-batch set.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files (no edits)

1. `supabase/functions/fact-bank-import/index.ts` — function being modified
2. `mobile/app/admin/facts/import.tsx` — admin UI (will need a small update)
3. `mobile/dev-reset.sh` — reference for env loading and `supabase status -o env` parsing
4. `supabase/.env.local` (do NOT read its contents back through the conversation; only verify it's gitignored and confirm it contains or can contain `DEV_ADMIN_PASSWORD`)

### 2. Modify `supabase/functions/fact-bank-import/index.ts`

- Add `skipped_duplicate = 0` counter alongside the existing counters.
- After loading `slugToId` from `categories`, group the inbound rows by their resolved slug. For each unique `categoryId` involved in the import, query existing fact texts:
  ```ts
  const { data: existing } = await service
    .from('facts')
    .select('fact_text')
    .eq('category_id', categoryId)
  const existingSet = new Set((existing ?? []).map((r) => r.fact_text as string))
  ```
  Build a `Map<categoryId, Set<string>>` of these. This is one query per unique category_id involved (at most 10 queries even for a 5,000-row import).
- Maintain a within-batch `Set<string>` keyed as `${categoryId}::${factText}` to catch duplicates inside a single request payload.
- After adapt → before the fact insert, check both sets. If hit, increment `skipped_duplicate++` and `continue`. After a successful insert, add the fact_text to the per-category set so subsequent rows in the same batch with identical text are caught.
- Add `skipped_duplicate` to the final response JSON. Include it in the `ImportResult` type in the mobile UI as well.
- Add a `Skipped (duplicate)` row to the result panel on `mobile/app/admin/facts/import.tsx`. Place it between `Skipped (non-multiple)` and `Skipped (unknown category, fell back to general)`.

### 3. Create `mobile/seed-trivia-api.sh`

Approximate shape — adapt as needed to satisfy the verifiable objectives. Key structural decisions: load env from `supabase/.env.local` (same as `dev-reset.sh`), parse API URL + publishable key from `supabase status -o env`, sign in as `trivoltaapp@outlook.com` with `DEV_ADMIN_PASSWORD`, hardcode the admin email constant at the top.

```bash
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

# Load DEV_ADMIN_PASSWORD from supabase/.env.local (same source as dev-reset.sh)
DEV_ADMIN_PASSWORD='TrivoltaDev123!'
if [[ -f supabase/.env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source supabase/.env.local
  set +a
fi

# Parse API URL + publishable key from `supabase status -o env`,
# with the same env/boxed fallback that dev-reset.sh uses.
if ! supabase status >/dev/null 2>&1; then
  echo "ERROR: supabase is not running. Run 'supabase start' first." >&2
  exit 1
fi

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

# Localhost guard
if [[ "$API_URL" != http://127.0.0.1:* && "$API_URL" != http://localhost:* ]]; then
  echo "Refusing to run against non-local API URL: $API_URL" >&2
  exit 2
fi

# Sign in as admin to get a real user JWT
JWT_RESPONSE="$(curl -sS "$API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$DEV_ADMIN_PASSWORD\"}")"

JWT="$(echo "$JWT_RESPONSE" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('access_token',''))")"

if [[ -z "$JWT" ]]; then
  echo "ERROR: failed to sign in as $ADMIN_EMAIL." >&2
  echo "Run mobile/dev-reset.sh first to provision the dev admin user." >&2
  exit 3
fi

CATEGORIES=(general_knowledge geography history science music film_and_tv arts_and_literature society_and_culture sport_and_leisure food_and_drink)
BATCHES_PER_CATEGORY=10
LIMIT=50

TOTAL_IMPORTED=0; TOTAL_DUP=0; TOTAL_UNK=0; TOTAL_FAILED=0
START_TS=$(date +%s)

for cat in "${CATEGORIES[@]}"; do
  for i in $(seq 1 $BATCHES_PER_CATEGORY); do
    PAYLOAD="$(curl -sS "https://the-trivia-api.com/api/questions?categories=$cat&limit=$LIMIT" || echo '[]')"
    RESP="$(curl -sS -X POST "$API_URL/functions/v1/fact-bank-import" \
      -H "apikey: $PUBLISHABLE_KEY" \
      -H "Authorization: Bearer $JWT" \
      -H "Content-Type: application/json" \
      --data-binary "$PAYLOAD" || echo '{"imported":0,"skipped_duplicate":0,"skipped_unknown_category":0,"failed":1}')"

    IMP="$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('imported',0))" 2>/dev/null || echo 0)"
    DUP="$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('skipped_duplicate',0))" 2>/dev/null || echo 0)"
    UNK="$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('skipped_unknown_category',0))" 2>/dev/null || echo 0)"
    FAIL="$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('failed',0))" 2>/dev/null || echo 0)"

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
```

`chmod +x mobile/seed-trivia-api.sh` after creating.

The exact env var names returned by `supabase status -o env` may differ between CLI versions for the publishable key. The fallback list above (`PUBLISHABLE_KEY`, `ANON_KEY`) covers current and recent CLI output. Verify by running `supabase status -o env` once during development and confirming the key name is in the fallback list. If neither matches, add the actual key name to the loop — do not introduce a new env file.

### 4. Verification

1. `cd mobile && npx tsc --noEmit` → exit 0.
2. Confirm `mobile/dev-reset.sh` was run at least once on the current DB (or run it now): `./mobile/dev-reset.sh`. This guarantees the admin user exists.
3. Restart Edge Function:
   ```
   supabase functions serve --no-verify-jwt --env-file supabase/.env.local
   ```
4. **Dedupe smoke test (small).** Manually paste the same Trivia API 5-row response into `/admin/facts/import` twice. First run: `imported=5 skipped_duplicate=0`. Second run: `imported=0 skipped_duplicate=5`.
5. **Within-batch dedupe test.** Construct a payload that contains the same fact twice (duplicate one row of a 3-row response), paste it. Confirm `imported=2 skipped_duplicate=1`.
6. **Run the seed script.**
   ```
   cd /Users/mizzy/Developer/Trivolta
   ./mobile/seed-trivia-api.sh
   ```
   Expect ~5–10 minutes wall time. Watch for non-zero `failed` counts in the per-batch log; isolated failures are acceptable, sustained failures across many batches are not.
7. **Run verification SQL** in Studio (`http://127.0.0.1:54323`):
   ```sql
   select c.slug, count(*) from facts f
   join categories c on c.id = f.category_id
   where f.source_origin = 'trivia_api_import'
   group by c.slug order by count(*) desc;
   ```
   Expect ≥3,500 total across ≥8 slugs.
8. **Distractor-completeness check.**
   ```sql
   select count(*) from facts f
   where f.source_origin = 'trivia_api_import'
     and (select count(*) from distractors d where d.fact_id = f.id) <> 3;
   ```
   Must be 0.
9. **Maestro suite.** `cd mobile && ./run_tests.sh` — confirm 25/25 pass on a booted simulator (per the known masking issue, eyeball wall time).
10. `git diff HEAD > ~/trivolta_diff.txt` and stop. Mac Claude reviews before commit.

## Verification

Final commands Claude Code must run and report from:

```
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit
cd /Users/mizzy/Developer/Trivolta && ./mobile/seed-trivia-api.sh
# plus the two SQL queries above against http://127.0.0.1:54323
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh
```

Report: TS pass/fail, dedupe smoke (run 1 + run 2 counts), within-batch dedupe count, seed script summary line (imported / dup / unk / failed / elapsed), category-distribution SQL output, distractor SQL output, Maestro count.

After Mac Claude approves the diff and Mike confirms iPhone testing works against the populated DB, this phase is done.

---

Read INSTRUCTIONS_PHASE_2.6.3e_BULK_TRIVIA_API_SEED.md and execute all steps exactly as written.
