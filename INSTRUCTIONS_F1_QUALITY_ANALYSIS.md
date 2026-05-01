# INSTRUCTIONS — F1 Quality Analysis Data Collection

## Task

Mac Claude needs raw data from the local Postgres DB to analyze whether F1's distractor regeneration improved quality. Write a single shell script that runs all required queries and dumps results to one file Mac Claude can read.

This is data collection only. No code changes, no migrations, no Edge Function changes. Pure read-only.

## Verifiable objective

- [ ] File `/Users/mizzy/Developer/Trivolta/F1_QUALITY_DATA.txt` exists after running.
- [ ] File contains all six query result blocks below, each preceded by its `=== QUERY N: <name> ===` header.
- [ ] Script exits 0.
- [ ] No DB writes occurred (verify by re-running `select count(*) from distractors group by authored_by, is_active;` before and after — counts identical).

## Constraints

- Read-only queries. No DML.
- Output file is plain text, suitable for Mac Claude to read in full.
- No truncation of query results — full output, even if long.

## Steps

1. Create file `/Users/mizzy/Developer/Trivolta/collect-f1-quality-data.sh`.
2. The script runs the six queries below via `docker exec -i supabase_db_Trivolta psql -U postgres -d postgres` and writes all output to `/Users/mizzy/Developer/Trivolta/F1_QUALITY_DATA.txt`.
3. Each query block is preceded by a `=== QUERY N: <name> ===` header line written via `\echo` so it appears in the output file.
4. Script is `chmod +x`.
5. Run it. Confirm the output file exists and contains all six blocks.

The six queries:

**QUERY 1: Quality score distribution across all changed facts.** Group active `ai-cached` distractors by `quality_score`. Show count of rows and count/3 as facts.

**QUERY 2: Pre/post distractor row totals reconciliation.** `select authored_by, is_active, count(*) from distractors group by authored_by, is_active order by 1, 2;`

**QUERY 3: Distractor text length comparison, deactivated-imported vs active-ai-cached.** Group by `authored_by`, filter to (`imported` AND `is_active=false`) OR (`ai-cached` AND `is_active=true`). Show count, avg length, min length, max length, stddev length of `distractor_text`.

**QUERY 4: Pairwise text overlap between old (imported, deactivated) and new (ai-cached, active) distractors on the same fact_id.** Use a CTE that joins deactivated-imported rows to active-ai-cached rows on `fact_id`. Count: total pairs, exact case-insensitive duplicates, substring overlap (one contains the other, case-insensitive, length differs), pairs that share ≥3 leading characters case-insensitive (proxy for "same answer with minor formatting").

**QUERY 5: 30 random sample pairs for human spot-inspection.** For 10 random fact_ids that were regenerated, output: `fact_text`, `correct_answer`, the three deactivated `imported` distractor texts, and the three active `ai-cached` distractor texts and their shared `quality_score`. Use `\x` expanded display so the output is human-readable. Limit to 10 facts (so 10 expanded records, each showing both distractor sets side-by-side).

**QUERY 6: Validation_failed bucket sample.** 10 random fact_ids where the only active distractors are `imported` (no active `ai-cached` row exists for that fact). Output: `fact_text`, `correct_answer`, the three active `imported` distractor texts. This is the bucket that Haiku could not regenerate to passing quality. Use `\x` expanded.

## Verification

```
cat /Users/mizzy/Developer/Trivolta/F1_QUALITY_DATA.txt | head -50
wc -l /Users/mizzy/Developer/Trivolta/F1_QUALITY_DATA.txt
```

Report file size and whether all six `=== QUERY N:` headers are present (`grep -c '=== QUERY' /Users/mizzy/Developer/Trivolta/F1_QUALITY_DATA.txt` should return 6).

---

Read INSTRUCTIONS_F1_QUALITY_ANALYSIS.md and execute all steps exactly as written.
