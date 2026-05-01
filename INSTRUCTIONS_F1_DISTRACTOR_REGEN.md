# INSTRUCTIONS — F1: Bulk distractor regeneration across imported corpus

## Task

The 3,976 facts imported via `seed-trivia-api.sh` currently use The Trivia API's own distractors (rows in `distractors` with `authored_by = 'imported'`). The Trivia API's distractor quality is uneven — many distractors are too easily eliminable, some are off-domain, some are partial duplicates of the correct answer. Trivolta already has a Haiku-backed pipeline that generates ambiguity-scored distractors (`fact-bank-generate-distractors`), but until now it has only been used for one-off admin runs and returns candidates without writing them. F1 bulk-applies that pipeline across every eligible imported fact and atomically swaps the imported distractors for AI-generated, ambiguity-scored ones.

Two pieces of work:

1. **Edge Function modification.** Extend `fact-bank-generate-distractors` with an `apply: boolean` request flag (default `false`, preserving current behavior). When `apply=true` and validation passes, the function deactivates existing `imported` distractors for that fact and inserts three new `ai-cached` distractors. The mutation is performed in the same Edge Function invocation as the validation, so existing rate-limiting and admin-auth checks apply transitively.

2. **Bulk orchestration shell script.** Create `mobile/regenerate-distractors.sh` that signs in as the dev admin, queries eligible fact_ids from the local DB, loops sequentially calling the function with `apply=true`, paces the loop to control Anthropic rate, checkpoints to a temp file for resumability, and reports per-fact and end-of-run counters.

Eligibility scope is the imported Trivia API corpus only (`source_origin = 'trivia_api_import'`). OpenTrivia DB imports are out of scope for F1 because the corpus loaded today is Trivia API; if Mike re-introduces OpenTrivia DB later, a separate F1-style pass can target that source_origin.

This is **local-only work**. No production deploy. No CI integration. Same posture as `seed-trivia-api.sh`.

### Honest cost note

Each fact requires one Haiku generation call + one Haiku validation call, with up to two retries on validation failure. Pricing for `claude-haiku-4-5` is approximately $1.00/MTok input, $5.00/MTok output. Each call averages ~500 input tokens / ~150 output tokens, so a successful pair is ~$0.003 and a worst-case retried pair is ~$0.009. Across 3,976 facts that is ~$12 baseline, ~$15 worst case. The "~$5" figure carried in `TRIVOLTA_DIFFERENTIATION.md` and `TRIVOLTA_TRACKER.md` is low. Mike should be prepared for a ~$15 spend, not $5. Do not retroactively edit those docs from inside this INSTRUCTIONS file — Mac Claude will fix them after F1 lands and produces a real measured cost.

## Verifiable objective

- [ ] `fact-bank-generate-distractors` accepts an optional `apply: boolean` field on the request body. Default `false`. When omitted or `false`, response shape and behavior are byte-for-byte identical to current main.
- [ ] When `apply=true` and validation returns scores all `< AMBIGUITY_REJECT`:
  - All existing `distractors` rows for that fact_id with `authored_by = 'imported'` and `is_active = true` flip to `is_active = false` (no DELETE).
  - Three new `distractors` rows are inserted with `authored_by = 'ai-cached'`, `is_active = true`, `quality_score = max(1, min(5, 5 - max(scores)))`, `reviewed_by = user.id`, `reviewed_at = now()`.
  - The 200 response gains `applied: true` and `quality_score: number` fields. `distractors` and `scores` fields remain.
- [ ] When `apply=true` and validation fails after retries (existing fallback path), no DB writes happen, and the existing 200 response (`ok: false, reason: 'validation_failed'`) gains `applied: false`.
- [ ] When `apply=true` and the fact is `is_high_value = true`, the existing 400 response is unchanged (already short-circuits before generation). `applied` field is not added on the 400 path — no schema change to error responses.
- [ ] When `apply=true` and the fact already has an active `ai-cached` distractor row, the function returns 200 with `ok: true, applied: false, reason: 'already_regenerated'` and performs no Anthropic calls and no writes. (Idempotency.)
- [ ] When `apply=true` and a write fails after successful validation, the function returns 200 with `ok: true, applied: false, reason: 'write_failed', error: <message>`, and the candidate distractors and scores are still returned in the response (useful for debugging).
- [ ] `mobile/regenerate-distractors.sh` exists, is executable (`chmod +x`), and runs against a started local Supabase stack with no manual edits required at runtime.
- [ ] The script reads `DEV_ADMIN_PASSWORD` (fallback `TrivoltaDev123!`) from `supabase/.env.local` — same source as `seed-trivia-api.sh`.
- [ ] The script signs in as `trivoltaapp@outlook.com` to obtain a user JWT (NOT service-role).
- [ ] The script reads API URL and publishable key from `supabase status -o env` and bails if the API URL is not localhost/127.0.0.1.
- [ ] The script bails with a clear "run mobile/dev-reset.sh first" message if the admin sign-in fails.
- [ ] Eligible-fact selection runs via `psql` against the local DB container `supabase_db_Trivolta`, returning fact_ids matching: `source_origin = 'trivia_api_import'` AND `is_high_value = false` AND no row exists in `distractors` with `(fact_id = f.id AND authored_by = 'ai-cached' AND is_active = true)`. Order results by `id` for stable iteration. Resume case adds `id > '<checkpoint>'`. Limit case appends `LIMIT N`.
- [ ] The script supports a `--limit N` CLI flag for smoke-testing (default: process all eligible). The first paragraph of `--help` documents this.
- [ ] The script supports a `--sleep MS` flag (default 250) controlling delay between calls.
- [ ] The script supports a `--restart` flag that deletes the checkpoint file at startup.
- [ ] The script supports a `--help` flag that prints the header comment of the script and exits 0.
- [ ] Checkpoint file path: `/tmp/trivolta-f1-checkpoint.txt`. Contains the last successfully-processed fact_id (success, validation_failed, or already_regenerated all advance the checkpoint; http_error does NOT advance it so a re-run retries).
- [ ] Per-fact log line format: `[N/total] <fact_id> → ok|validation_failed|http_error|skipped_already_regenerated  scores=[...]  quality=...`.
- [ ] Final summary block prints, on separate lines: total processed, succeeded, validation_failed, http_error, skipped_already_regenerated, elapsed seconds, estimated cost in USD (formula: `succeeded * 0.003 + validation_failed * 0.009`, rounded to two decimals). The estimate is informational only — a comment in the script must note the per-call figures are rough Haiku pricing, not authoritative.
- [ ] The script does not parallelize calls. Sequential with sleep only.
- [ ] `cd mobile && npx tsc --noEmit` exits 0 (no mobile TypeScript changes expected; this just guards against accidental edits).
- [ ] **Spot-check verification (Mike runs after F1 ships):** open `/admin/distractors/generate` for ten random regenerated facts, inspect the AI-cached distractors against the correct answer. Document findings in a new file `F1_SPOTCHECK_NOTES.md` at repo root. (Spot-check is post-merge; not a Claude Code deliverable. Just leave the file path expected.)
- [ ] Post-run SQL verification (every imported fact has 3 active distractors after the run, except those that hit validation_failed and retain imported distractors active by design):
  ```sql
  select count(*) from public.facts f
  where f.source_origin = 'trivia_api_import'
    and f.is_high_value = false
    and (
      select count(*) from public.distractors d
      where d.fact_id = f.id and d.is_active = true
    ) <> 3;
  ```
- [ ] Post-run SQL: deactivated-imported and active-ai-cached counts cross-check against the script summary:
  ```sql
  select authored_by, is_active, count(*) from public.distractors group by authored_by, is_active;
  ```
  Active `ai-cached` count should approximately equal `succeeded * 3` from the script summary. Inactive `imported` count should approximately equal the same.
- [ ] All 25 Maestro tests still pass after the regeneration. Distractor changes are invisible in pre-Phase-2.6.4 gameplay (mobile still calls legacy `solo-question` / `generate-questions` until F4–F6 ship), but the suite exercises lobby + solo flows that touch question rendering, and it must remain green.

## Constraints

- **Do not** delete imported distractor rows. Set `is_active = false` only. The audit trail of "what we replaced" is part of the value of this work.
- **Do not** insert new distractor rows without going through `fact-bank-generate-distractors`. The validation pass and ambiguity scoring are the whole point. Bypassing them defeats F1's purpose.
- **Do not** call the function with `apply=true` on facts where `is_high_value = true`. The function already 400s; the script's pre-filter must also exclude them so the 400s don't pollute counters.
- **Do not** parallelize the loop. Sequential with sleep keeps Anthropic rate predictable and makes the checkpoint file meaningful. F1 is not latency-sensitive.
- **Do not** modify `fact-bank-import` or any imports-related code. F1 only touches `fact-bank-generate-distractors` and adds a new shell script.
- **Do not** modify the existing `/admin/distractors/generate` UI. The default `apply=false` path must keep working there unchanged. F1 does not add UI.
- **Do not** write to `TRIVOLTA_DIFFERENTIATION.md`, `TRIVOLTA_TRACKER.md`, or `TRIVOLTA_HALLUCINATION_STRATEGY.md`. Mac Claude updates the tracker after F1 lands and a real cost figure is known.
- **Do not** add `regenerate-distractors.sh` to any CI workflow, package.json script, or Maestro flow. It is a manual convenience tool.
- **Do not** introduce new env vars or env files. Reuse `supabase/.env.local`.
- **Do not** issue HTTP retries inside the script for transport errors — the function itself already retries inside the validation loop. A 5xx from the function on a single fact is logged and skipped; the loop continues.
- **Do not** use `set -e` alone; use `set -euo pipefail` and explicit error handling so a single failed fact doesn't kill the whole run.
- **Do not** call the production Supabase URL from the script. Add a localhost/127.0.0.1 guard at the top.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files (no edits)

1. `supabase/functions/fact-bank-generate-distractors/index.ts` — function being modified. Note the existing structure: auth → admin check → fact load → high-value short-circuit → generate/validate retry loop → success/failure responses.
2. `supabase/migrations/20240106000000_fact_bank_schema.sql` — confirm `distractors` columns: `authored_by`, `is_active`, `quality_score`, `reviewed_by`, `reviewed_at`.
3. `mobile/seed-trivia-api.sh` — reference for env loading, `supabase status -o env` parsing, admin sign-in flow, localhost guard. Mirror its style and structure.
4. `mobile/dev-reset.sh` — reference for psql invocations against the local DB container (the container name is `supabase_db_Trivolta`).

### 2. Modify `supabase/functions/fact-bank-generate-distractors/index.ts`

Add the `apply` flag and gate writes on it. The function currently has this flow:

  authorize → admin check → parse `fact_id` → load fact → high-value short-circuit → generate/validate retry loop → respond.

Modify it to:

  authorize → admin check → parse `fact_id` AND `apply` (default `false`) → load fact → high-value short-circuit → **idempotency check (only if `apply=true`)** → generate/validate retry loop → on success: **(if `apply=true`) deactivate-imported + insert-ai-cached, then build success response with `applied`/`quality_score`** → on validation failure: build response with `applied: false`.

The idempotency check queries `distractors` for any row with the given `fact_id` and `authored_by = 'ai-cached'` and `is_active = true`. If found, short-circuit with a 200 response containing `ok: true`, `applied: false`, `reason: 'already_regenerated'`. No Anthropic calls. No writes.

The deactivation is an UPDATE on `distractors` setting `is_active = false` filtered by `fact_id`, `authored_by = 'imported'`, and `is_active = true`. The insert is three rows, one per generated distractor, each with: `fact_id`, `distractor_text`, `authored_by = 'ai-cached'`, `is_active = true`, `quality_score = clamp(5 - max(scores), 1, 5)`, `reviewed_by = user.id`, `reviewed_at = current timestamp`.

Both writes use the existing service-role client (already constructed in the current code). They run sequentially: deactivate first, then insert. If either errors, the function returns 200 with `ok: true`, `applied: false`, `reason: 'write_failed'`, and includes the error message under an `error` field. Even on write failure, return the candidate distractors and scores in the response so the caller can debug.

The success-with-apply response shape adds two fields to the existing `{ ok, fact_id, distractors, scores }` shape: `applied: true` and `quality_score: <computed value>`. The validation-failed-with-apply response adds `applied: false` to the existing `{ ok: false, fact_id, reason, distractors, scores }` shape. The 400 high-value response is unchanged.

When `apply=false` (or omitted), the response is byte-for-byte identical to current main. No `applied` field. No DB writes. Verify this by running the existing `/admin/distractors/generate` admin UI flow and comparing response payload before vs. after.

The clamp helper for `quality_score` is one line: clamp `5 - max(scores)` between 1 and 5 inclusive.

No changes to imports, prompts, retry logic, model name, ambiguity threshold, or any other behavior.

### 3. Create `mobile/regenerate-distractors.sh`

The script has the following sections, in order. Mirror `mobile/seed-trivia-api.sh` for the env, supabase-status parsing, admin sign-in, and localhost-guard sections — those should be near-identical to that script's equivalents. The novel parts of F1 are the CLI flag parsing, the eligibility query, the loop body, and the checkpoint/summary handling.

**Header comment.** Filename, one-paragraph purpose, usage examples for each CLI flag (`--limit`, `--sleep`, `--restart`, `--help`), and a "local-only / sequential / resumable" note. The `--help` flag prints this header.

**`set -euo pipefail`** at the top. Then `cd` to repo root.

**Constants.** `ADMIN_EMAIL='trivoltaapp@outlook.com'`, `DB_CONTAINER='supabase_db_Trivolta'`, `CHECKPOINT='/tmp/trivolta-f1-checkpoint.txt'`, plus the two cost figures `COST_PER_SUCCESS` and `COST_PER_VALIDATION_FAILURE` with a comment explaining they are rough Haiku 4.5 estimates and not authoritative.

**CLI flag parsing.** Parse `--limit N` (default 0 = no limit), `--sleep MS` (default 250), `--restart` (default false), `--help`. Unknown flags exit non-zero with a clear error. Convert `SLEEP_MS` to a fractional seconds value usable by `sleep`.

**Env load.** Source `supabase/.env.local` if present (using `set -a` / `source` / `set +a` pattern, same as `seed-trivia-api.sh`). Default `DEV_ADMIN_PASSWORD` to `TrivoltaDev123!` if not set.

**Supabase status check.** Bail with clear error if `supabase status` returns non-zero.

**API URL and publishable key parsing.** Parse from `supabase status -o env` using the same awk pattern as `seed-trivia-api.sh` (try `PUBLISHABLE_KEY`, fall back to `ANON_KEY`). Bail if either is empty.

**Localhost guard.** If `API_URL` does not start with `http://127.0.0.1:` or `http://localhost:`, exit 2 with a clear refusal message.

**Admin sign-in.** POST to `/auth/v1/token?grant_type=password` with the admin email and password. Parse `access_token` out of the JSON response. If empty, print "Run mobile/dev-reset.sh first to provision the dev admin user." and exit 3.

**Checkpoint handling.** If `--restart`, delete `$CHECKPOINT`. Read `$CHECKPOINT` if present and store the value in `LAST_DONE`; otherwise empty. Print "Resuming after fact_id: $LAST_DONE" if non-empty.

**Eligibility query.** Build the SQL string (use the form documented in the verifiable objective above). When `LAST_DONE` is non-empty, append `and f.id > '<value>'`. Order by `id`. When `--limit N` was supplied with N > 0, append `LIMIT N`. Run the query via `docker exec -i $DB_CONTAINER psql -U postgres -d postgres -tAc "<sql>"` and capture the lines into a bash array (`mapfile`). If the array is empty, print "No eligible facts. Nothing to do." and exit 0.

**Print pre-flight info.** Echo the eligible-fact count and the configured sleep value.

**Counters.** `SUCCEEDED`, `VAL_FAILED`, `HTTP_ERROR`, `SKIPPED_ALREADY` all start at 0. Capture `START_TS` from `date +%s`.

**Main loop.** For each `ID` at index `i` (with `N=i+1`):

  1. POST to `$API_URL/functions/v1/fact-bank-generate-distractors` with `apikey` header, `Authorization: Bearer $JWT` header, `Content-Type: application/json`, and JSON body `{"fact_id":"$ID","apply":true}`. On curl failure, fall back to a JSON literal that the parser will recognize as `http_error`.
  2. Parse `ok`, `applied`, `reason`, `scores`, `quality_score` out of the response body. Use Python one-liners (`python3 -c "import sys,json;..."`) for parsing — same approach `seed-trivia-api.sh` uses for response counters. Wrap each parse in a `2>/dev/null || echo <fallback>` so a malformed response doesn't kill the script.
  3. Branch on the parsed values:
     - `ok=True` and `applied=True` → increment `SUCCEEDED`, log `ok scores=... quality=...`, write `$ID` to `$CHECKPOINT`.
     - `ok=True` and `reason=already_regenerated` → increment `SKIPPED_ALREADY`, log `skipped_already_regenerated`, write `$ID` to `$CHECKPOINT`.
     - `ok=False` and `reason=validation_failed` → increment `VAL_FAILED`, log `validation_failed scores=...`, write `$ID` to `$CHECKPOINT`.
     - Anything else (including `write_failed`, missing fields, transport errors) → increment `HTTP_ERROR`, log `http_error or unknown response`, **do not advance the checkpoint**.
  4. `sleep $SLEEP_SEC`.

**Final summary.** Compute `ELAPSED` and `COST` (formula in verifiable objective). Print the summary block exactly as specified — header line `=== F1 distractor regen complete ===`, then the named counters, elapsed, and estimated cost with a parenthetical noting it's rough.

**Permissions.** Issue `chmod +x mobile/regenerate-distractors.sh` after creation.

The script is bash, not zsh-specific. No bash 4+ features beyond `mapfile` (which is bash 4+ but ships with the macOS Xcode bash on Mike's machine — same as `seed-trivia-api.sh` already uses). Match the style and structural conventions of `seed-trivia-api.sh` so the two scripts read as a pair.

### 4. Verification

1. `cd mobile && npx tsc --noEmit` → exit 0.
2. Restart Edge Function:
   ```
   supabase functions serve --no-verify-jwt --env-file supabase/.env.local
   ```
3. **Backwards-compat smoke test (default apply=false).** Open `/admin/distractors/generate`, run on any one fact via existing admin UI. Confirm response shape unchanged from main (no `applied` field present, no DB writes). This is the regression check on the `apply=false` path.
4. **apply=true smoke test (single fact).**
   ```
   ./mobile/regenerate-distractors.sh --limit 1
   ```
   Expect a single `ok` line. Open `/admin/distractors/generate` and view that fact — confirm three new distractors with `authored_by = 'ai-cached'` are visible. Run:
   ```sql
   select authored_by, is_active, count(*) from public.distractors
   where fact_id = '<that fact_id>' group by 1,2;
   ```
   Expect: `imported / false / 3` and `ai-cached / true / 3`.
5. **Idempotency test.** Re-run the script with `--limit 1`. Expect either "No eligible facts. Nothing to do." (preferred — eligibility filter excludes the just-processed fact) OR a `skipped_already_regenerated` line if the eligibility query picks a different fact. Both outcomes prove idempotency.
6. **Checkpoint test.**
   - Run `./mobile/regenerate-distractors.sh --restart --limit 5`.
   - Interrupt with Ctrl+C after 2–3 facts complete.
   - Re-run `./mobile/regenerate-distractors.sh --limit 5` (no `--restart`).
   - Confirm it resumes after the checkpoint, skipping already-processed facts.
7. **Full run.**
   ```
   ./mobile/regenerate-distractors.sh --restart
   ```
   Expect ~30–60 minutes wall time at default sleep (3,976 facts × ~0.5s API + 0.25s sleep ≈ 50min). Watch HTTP error rate; sustained errors indicate Edge Function or rate-limit issues — abort.
8. **Post-run SQL verification.** Run both queries from the verifiable-objective list. Capture output for the diff review.
9. **Maestro suite.** `cd mobile && ./run_tests.sh` — confirm 25/25 pass.
10. `git diff HEAD > ~/trivolta_diff.txt` and stop. Mac Claude reviews before commit.

## Verification

Final commands Claude Code must run and report from:

```
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit
cd /Users/mizzy/Developer/Trivolta && ./mobile/regenerate-distractors.sh --restart --limit 1
# Manual: spot-check via /admin/distractors/generate
cd /Users/mizzy/Developer/Trivolta && ./mobile/regenerate-distractors.sh --restart
# Plus the two SQL queries above against http://127.0.0.1:54323
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh
```

Report: TS pass/fail, single-fact smoke output, idempotency check result, full-run summary block (succeeded / val_failed / http_err / skipped_already / elapsed / cost), both SQL outputs, Maestro count.

After Mac Claude approves the diff and Mike confirms the spot-check on 10 random regenerated facts looks good, this phase is done. Update `TRIVOLTA_TRACKER.md` to mark F1 ✅ and record the actual measured Anthropic cost.

---

Read INSTRUCTIONS_F1_DISTRACTOR_REGEN.md and execute all steps exactly as written.
