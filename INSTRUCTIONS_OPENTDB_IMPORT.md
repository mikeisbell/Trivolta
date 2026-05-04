# INSTRUCTIONS — OpenTrivia DB Import

## Task

Replace the 3,976 Trivia API questions in the local `facts` table with questions
from OpenTrivia DB (opentdb.com). OpenTrivia DB is licensed under CC BY-SA 4.0
which allows commercial use. The Trivia API questions are non-commercial only and
must be removed.

This is local-only. Production import happens separately.

## Verifiable objective

- [ ] All rows with `source_origin = 'trivia_api_import'` deleted from `facts` table (cascades to `distractors`)
- [ ] New script `mobile/seed-opentdb.sh` exists and is executable
- [ ] Script successfully imports questions from OpenTrivia DB
- [ ] At least 3,000 facts in `facts` table with `source_origin = 'opentdb_import'`
- [ ] `distractors` table populated — each imported fact has 3 distractor rows
- [ ] `cd mobile && npx tsc --noEmit` exits 0
- [ ] All 26 active Maestro tests still pass

## Constraints

- Do NOT modify the `fact-bank-import` Edge Function
- Do NOT modify any mobile code
- Do NOT run against production Supabase — local only
- Do NOT use `&encode=url3986` in OpenTrivia DB requests — fetch plain UTF-8
- Do NOT post the full OpenTrivia DB response to the importer — extract the `results` array first (see Steps)
- Do NOT loop faster than one request per 5 seconds — OpenTrivia DB rate limits aggressively
- Do NOT commit until Mac Claude has reviewed the diff

## Steps

### 1. Wipe Trivia API questions

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -c "
DELETE FROM public.facts WHERE source_origin = 'trivia_api_import';
"
```

Verify:

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc "
SELECT COUNT(*) FROM public.facts WHERE source_origin = 'trivia_api_import';
"
# must be 0 before proceeding
```

### 2. Create `mobile/seed-opentdb.sh`

Model the script on `mobile/seed-trivia-api.sh` for the auth/JWT/supabase-status
boilerplate. The fetch-and-import loop is different — follow this logic exactly:

**OpenTrivia DB endpoint:**
```
https://opentdb.com/api.php?amount=50&type=multiple
```
Append `&category=<id>` to filter by category.

**Category list to iterate:**

| Category ID | Label | Notes |
|---|---|---|
| (no filter) | General Knowledge | omit &category param |
| 11 | Film | |
| 12 | Music | |
| 17 | Science | |
| 22 | Geography | |
| 23 | History | |
| 21 | Sports | |
| 10 | Literature | |
| 25 | Art | |
| 26 | Pop Culture | |

Run 8 batches per category (8 × 50 = 400 questions max per category).

**Critical — extract results array before posting:**

OpenTrivia DB returns:
```json
{"response_code": 0, "results": [ ... array of questions ... ]}
```

The `fact-bank-import` Edge Function expects a raw JSON array, NOT the wrapper
object. You must extract only the `results` array before posting.

Response code meanings:
- `0` = success, extract `results` array and post
- `5` = rate limited — sleep 30s and retry the batch once; if still 5, skip and continue
- anything else = error, skip batch, log it

**Import call pattern (per batch):**
1. `curl` the OpenTrivia DB endpoint
2. Extract `results` array via python3 (check response_code first)
3. If results is empty or rate limited, handle as above
4. POST the results array to `$API_URL/functions/v1/fact-bank-import`
5. Parse the importer response for `imported`, `skipped_duplicate`, `skipped_unknown_category`, `failed`
6. Print per-batch summary line
7. `sleep 5` before next request

**Running totals:** track and print grand totals at the end.

### 3. Make script executable and run it

```bash
chmod +x mobile/seed-opentdb.sh
bash mobile/seed-opentdb.sh
```

Expected runtime: 15-20 minutes.

### 4. Verify import

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -c "
SELECT c.slug, COUNT(f.id) as fact_count
FROM public.facts f
JOIN public.categories c ON c.id = f.category_id
WHERE f.source_origin = 'opentdb_import'
GROUP BY c.slug
ORDER BY c.slug;
"
```

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc "
SELECT COUNT(*) FROM public.facts WHERE source_origin = 'opentdb_import';
"
# must be 3000+
```

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc "
SELECT COUNT(*) FROM public.distractors d
JOIN public.facts f ON f.id = d.fact_id
WHERE f.source_origin = 'opentdb_import';
"
# must be roughly 3x the fact count
```

### 5. TypeScript check and Maestro suite

```bash
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh
```

All 26 active tests must pass.

### 6. Pipeline tail

```bash
cd /Users/mizzy/Developer/Trivolta
bash simplify-and-verify.sh
bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_OPENTDB_IMPORT.md
```

Do not return control to Mike until `run-review.sh` exits 0.

## Verification

Final report must include:

- Trivia API fact count after wipe (must be 0)
- Total OpenTrivia DB facts imported
- Per-category breakdown
- Distractor count
- TypeScript pass/fail
- Maestro result (26 active expected)
- `run-review.sh` verdict and path to review file
