# INSTRUCTIONS_PHASE_2.6.3_AUTOMATED_SEEDING.md

## Task

Reduce Mike's seeding time from ~50 hours to ~5 hours by automating the mechanical parts of fact verification while keeping a human in the loop for the cases that genuinely need judgment. After this task, Mike can paste an OpenTrivia DB JSON blob (or trigger a category-fill from a hosted dataset), kick off a batch run, and come back to a queue of 10–15% of the imported facts that need human review. The other 85–90% are auto-verified through a multi-AI verification pipeline that reads the cited sources and confirms the correct answer is supportable from them.

This is a NEW sub-phase inserted between Phase 2.6.2 and the original Phase 2.6.3 (manual seeding). It does NOT replace human review — it concentrates human attention on facts that flag as ambiguous, contested, or unverifiable, instead of spreading it across all 1,500.

This sub-phase does NOT modify Phase 2.6.1 schema or Phase 2.6.2 Edge Functions. It composes them into a higher-level pipeline.

## Prerequisite

- Phase 2.6.1 ✅ (schema, admin role, RLS, verification trigger, `is_admin()` helper)
- Phase 2.6.2 ✅ (`fact-bank-import`, `fact-bank-validate-source`, `fact-bank-generate-distractors`)
- `trivoltaapp@outlook.com` has admin role granted locally
- Maestro suite green

## Verifiable objective

- [ ] Two new Edge Functions exist and serve cleanly: `fact-bank-auto-seed` (single-fact pipeline) and `fact-bank-batch-seed` (orchestrator that loops auto-seed over a set of facts)
- [ ] Both new Edge Functions follow the existing auth pattern (Authorization header + `auth.getUser()` + apikey-header-with-env-fallback) AND check `app_metadata.role === 'admin'` (return 403 if not)
- [ ] `fact-bank-auto-seed` accepts a `fact_id`, runs the full mechanical pipeline (cite sources → mechanically verify → AI cross-check → distractor generation if needed), inserts confirmed sources and distractors directly into the DB, and either flips the fact to `verified` (if auto-passes) or to a new `needs_review` state (if anything fails AI cross-check)
- [ ] `fact-bank-batch-seed` accepts an optional `category_slug` and `limit` (default 50), enumerates `pending` facts matching the filter, calls `fact-bank-auto-seed` for each in serial, and returns a summary: `auto_verified`, `needs_review`, `failed` counts plus per-fact outcome
- [ ] AI cross-check uses a DIFFERENT prompt and DIFFERENT model from the source-citation pass. Specifically, the cross-check uses Sonnet (`claude-sonnet-4-6`) — slower, more capable, more conservative — while citation uses Haiku. This is the "AI verifies AI with independent failure modes" guardrail. Cross-check is given the fact text, the imported correct_answer, and the human_confirmed source URLs + excerpts. It returns `{ supported: boolean, confidence: 1-5, reasoning: string }`. A fact auto-verifies only if `supported = true` AND `confidence >= 4`.
- [ ] New `verification_status` enum value `'needs_review'` added via a new migration; the verification trigger from Phase 2.6.1 is updated to allow transitions `pending → needs_review` and `needs_review → verified` (with the same source-count requirement) and `needs_review → rejected`
- [ ] The fact_reports / sources / distractors workflow is unchanged — `fact-bank-auto-seed` writes `fact_sources` rows with `human_confirmed = true` and `added_by_ai = true` ONLY when AI cross-check passes. If cross-check fails, sources are written with `human_confirmed = false` and the fact lands in `needs_review`.
- [ ] New admin route `/admin/facts/needs-review` lists `verification_status = 'needs_review'` facts. The fact detail page (`/admin/facts/[id]`) renders the AI cross-check reasoning when present, so the human can see WHY the AI flagged the fact before deciding.
- [ ] New admin route `/admin/facts/auto-seed` is the batch-seeding control panel: a textarea for OpenTrivia DB JSON OR a category dropdown to seed from facts already imported as pending; an "Auto-seed N facts" button; and a real-time progress display (X / N processed; live counts of auto_verified, needs_review, failed)
- [ ] Telemetry: full forensic logging via two linked tables — `fact_auto_seed_log` for the per-fact outcome and `fact_auto_seed_sources` for the per-proposed-source detail. Schema below in Step 1. Logs include token counts (cost), model versions, failure stage, and per-source mechanical-check details.
- [ ] New admin route `/admin/telemetry` is a read-only dashboard reading from the two log tables: aggregate counts by outcome, average cross-check confidence, average cost per fact, top failing source domains, and latest 50 runs with drill-down into individual logs.
- [ ] All 25 active Maestro tests still pass (no regression to non-admin flows)
- [ ] `TRIVOLTA_TRACKER.md` shows Phase 2.6.3 split into two sub-phases: 2.6.3a (this — automated seeding tooling), 2.6.3b (Mike's reduced-scope curation, ~5 hrs)

## Constraints

- Do NOT modify the Phase 2.6.1 schema except to add the `'needs_review'` enum value and the two new telemetry tables. The 7 fact-bank tables and the verification trigger logic are otherwise unchanged.
- Do NOT modify the 3 Phase 2.6.2 Edge Functions. `fact-bank-auto-seed` calls them as building blocks.
- Do NOT bypass the verification trigger. A fact still cannot reach `verified` without ≥2 confirmed sources (cross-referenced category). The new pipeline writes sources with `human_confirmed = true` only when AI cross-check passes; the trigger still does its work.
- Do NOT use the same model for citation and cross-check. Citation = Haiku, cross-check = Sonnet. Independent failure modes are the whole point.
- Do NOT auto-verify if AI cross-check confidence is below 4. Borderline facts go to `needs_review` for human eyes.
- Do NOT remove the manual-review path. `/admin/sources/cite`, `/admin/distractors/generate`, and the manual Approve/Reject on `/admin/facts/[id]` continue to work exactly as in Phase 2.6.2. The new automated path is additive.
- Do NOT introduce new third-party dependencies. Reuse the Anthropic SDK and Supabase client already in use.
- Do NOT log Anthropic API keys, JWTs, user emails, or any auth credentials in either telemetry table. Log fact-related fields, model identifiers, token counts, durations, mechanical flags, source URLs (these are public anyway), and AI reasoning text.
- Do NOT process more than one fact concurrently in the batch orchestrator. Serial processing keeps the pipeline observable, gives Mike a clean progress bar, and avoids hammering Anthropic with parallel calls. If throughput becomes a real bottleneck post-launch, parallelization is a future optimization.
- Do NOT auto-generate distractors for high-value facts. Same constraint as Phase 2.6.2 — long-tail only. If an imported fact has no `is_high_value` value set yet, the auto-seed pipeline treats it as long-tail (default false).
- Do NOT use `Alert.alert` for confirmations or warnings on admin pages. `Alert.alert` is iOS-only and silently no-ops on Expo Web, which is where the admin tooling lives. For confirmations like "Process 50 facts?" use `window.confirm()` (works on web, also works in iOS WebViews where applicable) or build a custom modal component using existing theme tokens. This is a known issue from Phase 2.6.1's profile page that will be patched in Phase 2.6.7; new admin code must avoid the trap.
- Do NOT modify `mobile/lib/supabase.ts`, `mobile/lib/api.ts`, `mobile/lib/types.ts`, or `mobile/lib/theme.ts`.
- Do NOT modify any non-admin mobile route. All mobile changes happen under `mobile/app/admin/`.

## Steps

### Step 1 — Migration: add `'needs_review'` enum value and the two telemetry tables

Create `supabase/migrations/20240107000000_auto_seed.sql`. The migration must:

1. Add `'needs_review'` to the `verification_status` check constraint on `public.facts`. Postgres doesn't allow editing a check constraint in place — drop and recreate it.

2. Update the `check_fact_verification` trigger function to allow:
   - `pending → needs_review` (no source-count requirement)
   - `needs_review → verified` (existing source-count requirement)
   - `needs_review → rejected` (always allowed)
   - All Phase 2.6.1 transitions remain valid

3. Create `fact_auto_seed_log` (one row per `fact-bank-auto-seed` invocation):
   - `id` uuid primary key
   - `fact_id` uuid references facts on delete cascade
   - `outcome` text not null check (in `'auto_verified'`, `'needs_review'`, `'failed'`)
   - `failure_stage` text nullable check (in `'citation'`, `'mechanical_check'`, `'cross_check'`, `'distractor_generation'`, `'db_write'`, `'unknown'`)
   - `failure_reason` text nullable — short error message for `failed` and `needs_review` outcomes (e.g., `'insufficient_mechanical_sources'`, `'cross_check_low_confidence'`, `'anthropic_429'`)
   - `cross_check_confidence` integer nullable check (1-5)
   - `cross_check_reasoning` text nullable
   - `cross_check_supported` boolean nullable
   - `cross_check_model` text nullable — model identifier used for cross-check (e.g., `'claude-sonnet-4-6'`)
   - `citation_model` text nullable — model identifier used for citation (e.g., `'claude-haiku-4-5-20251001'`)
   - `sources_attempted` integer not null default 0 — count of URLs the citation AI proposed
   - `sources_confirmed` integer not null default 0 — count that passed mechanical check
   - `distractors_attempted` boolean not null default false
   - `distractors_succeeded` boolean not null default false
   - `total_input_tokens` integer not null default 0 — summed across all Anthropic calls in this run
   - `total_output_tokens` integer not null default 0 — summed across all Anthropic calls
   - `estimated_cost_usd` numeric(10, 6) not null default 0 — computed from token counts and known per-model rates
   - `total_duration_ms` integer not null default 0
   - `created_at` timestamptz not null default now()
   - Indexes: `(fact_id, created_at desc)`, `(outcome, created_at desc)`, `(created_at desc)` for the latest-runs telemetry view

4. Create `fact_auto_seed_sources` (one row per source URL the citation AI proposed, including ones rejected by the mechanical check):
   - `id` uuid primary key
   - `auto_seed_log_id` uuid not null references `fact_auto_seed_log(id)` on delete cascade
   - `fact_id` uuid not null references `facts(id)` on delete cascade — denormalized for direct querying
   - `url` text not null — the URL the AI proposed
   - `source_type` text not null check (in `'wikipedia'`, `'imdb'`, `'official_record'`, `'reference_book'`, `'other'`)
   - `proposed_excerpt` text not null — what the AI quoted
   - `verified_reachable` boolean not null
   - `excerpt_match` boolean not null
   - `http_status_code` integer nullable
   - `fetch_error` text nullable — captured error message if the fetch threw
   - `fetch_duration_ms` integer nullable
   - `inserted_into_fact_sources` boolean not null default false — true if the candidate was good enough to write to the canonical `fact_sources` table
   - `created_at` timestamptz not null default now()
   - Indexes: `(auto_seed_log_id)`, `(fact_id, created_at desc)`, on the URL's host (extract via expression index) for "what domain fails most often" queries

5. RLS on both new tables: admin-only (matches Phase 2.6.1 pattern using `is_admin()`). Service role bypasses RLS (default behavior); the Edge Function will use a service-role client for inserts.

6. Add a SQL helper function `public.estimate_anthropic_cost(model text, input_tokens int, output_tokens int) returns numeric`. Hardcoded per-model rates as of Apr 2026:
   - `claude-sonnet-4-6`: $3 per 1M input tokens, $15 per 1M output tokens
   - `claude-haiku-4-5-20251001`: $0.80 per 1M input tokens, $4 per 1M output tokens
   - Unknown model: returns 0
   - This function is `IMMUTABLE` and does not access any tables — pure math from inputs.
   - The Edge Function calls this when writing the log to compute `estimated_cost_usd`.

Verify the migration applies cleanly via `supabase db reset` and the existing 25 Maestro tests still pass before proceeding to Step 2.

### Step 2 — `fact-bank-auto-seed` Edge Function

Create `supabase/functions/fact-bank-auto-seed/index.ts`. Auth pattern matches Phase 2.6.2 (Authorization + getUser + admin gate + apikey-with-env-fallback).

Accept POST body:
```
{ "fact_id": "<uuid>" }
```

Pipeline steps for a single fact:

1. **Initialize a telemetry accumulator** — an in-memory object that collects token counts, durations, model identifiers, and per-source proposals as the pipeline runs. Final state gets written to the two log tables in step 9.

2. **Load the fact.** 404 if not found, 400 if `verification_status != 'pending'` (only pending facts are eligible for auto-seed).

3. **Citation pass.** Internally invoke the same logic as `fact-bank-validate-source` — call Haiku for 2 source URL proposals + excerpts, mechanically verify each (URL reachability + excerpt substring match). For each proposed source, capture in the telemetry accumulator: url, source_type, proposed_excerpt, verified_reachable, excerpt_match, http_status_code, fetch_error, fetch_duration_ms. Capture the Anthropic call's input_tokens / output_tokens / model.

4. **Hard requirement: ≥2 candidates pass mechanical check.** If fewer than 2 candidates have `verified_reachable = true AND excerpt_match = true`, the fact lands in `needs_review` immediately. Skip cross-check. Set `failure_stage = 'mechanical_check'`, `failure_reason = 'insufficient_mechanical_sources'`. Continue to step 9 (write logs and DB updates).

5. **AI cross-check.** Call Sonnet (`claude-sonnet-4-6`) with a different prompt: "Given this fact, this stated correct answer, and these source excerpts, is the correct answer supported by the sources? Rate confidence 1-5. Return JSON: `{ supported: boolean, confidence: 1-5, reasoning: string }`." Sonnet sees the imported `correct_answer` and the mechanically-verified source excerpts ONLY — not the original AI's citation reasoning, not the OpenTrivia DB metadata, nothing else. The independence is the point. Capture input_tokens / output_tokens / model into the telemetry accumulator.

6. **Decide outcome based on cross-check.**
   - `supported = true AND confidence >= 4` → auto-verify path (step 7)
   - Anything else → needs_review path (step 8). Set `failure_reason = 'cross_check_low_confidence'` or `'cross_check_unsupported'` accordingly.

7. **Auto-verify path.**
   - Insert the mechanically-validated sources into `fact_sources` with `human_confirmed = true`, `added_by_ai = true`. For each inserted source, set `inserted_into_fact_sources = true` in the corresponding telemetry accumulator entry.
   - Generate distractors if the fact has fewer than 3 active distractors (call the same logic as `fact-bank-generate-distractors`); insert them with `authored_by = 'ai-cached'` if cross-validated by the existing distractor-validation pass. Track `distractors_attempted` and `distractors_succeeded` flags. Capture token counts.
   - Update `verification_status = 'verified'` (the trigger will allow this because ≥2 confirmed sources are present).
   - Set outcome = `'auto_verified'` in telemetry. Continue to step 9.

8. **needs_review path.**
   - Insert the mechanically-validated sources into `fact_sources` with `human_confirmed = false` (preserves the AI's work for the human reviewer to consider) and `added_by_ai = true`. Track `inserted_into_fact_sources` accordingly.
   - Update `verification_status = 'needs_review'`.
   - Do NOT generate distractors — the human may reject the fact entirely.
   - Set outcome = `'needs_review'` in telemetry. Continue to step 9.

9. **Write telemetry, then return.**
   - Insert one row into `fact_auto_seed_log` from the accumulator. Compute `estimated_cost_usd` by summing `estimate_anthropic_cost(model, in, out)` across each Anthropic call recorded.
   - Insert N rows into `fact_auto_seed_sources` (one per proposed source, regardless of whether it was approved).
   - Both inserts use the service-role client. Telemetry write failures should NOT abort the run — log to stdout but return success. The DB state is the source of truth; telemetry is best-effort.
   - Return the response shape below.

10. **Failure modes that don't fit the above** (e.g. Anthropic SDK errors, DB errors that ARE fatal): set `verification_status` unchanged (still `pending`), set telemetry outcome = `'failed'`, set `failure_stage` to the appropriate value, set `failure_reason` to the error message (truncated to 500 chars), write telemetry, return 503 with the error message.

Return shape:
```
{
  "fact_id": "<uuid>",
  "outcome": "auto_verified" | "needs_review" | "failed",
  "confidence": <int|null>,
  "reasoning": "<string|null>",
  "sources_attempted": <int>,
  "sources_confirmed": <int>,
  "distractors_added": <int>,
  "input_tokens": <int>,
  "output_tokens": <int>,
  "estimated_cost_usd": <number>,
  "duration_ms": <int>,
  "failure_stage": "<string|null>",
  "failure_reason": "<string|null>"
}
```

### Step 3 — `fact-bank-batch-seed` Edge Function

Create `supabase/functions/fact-bank-batch-seed/index.ts`. Same auth pattern.

Accept POST body:
```
{
  "category_slug": "<optional, filters to one category>",
  "limit": 50,
  "fact_ids": ["<optional explicit list>"]
}
```

If `fact_ids` is provided, use it directly. Otherwise, query `pending` facts (optionally filtered by category) ordered by `created_at` ascending, limited to `limit`.

Process each fact in serial (NOT parallel — see constraint). For each:
- Invoke `fact-bank-auto-seed` internally (use a service-role Supabase client to call the function via `supabase.functions.invoke` OR import its handler function directly, whichever is cleaner; the function isolation matters less than logging consistency).
- Capture the outcome and append to a results array.
- Continue on individual failures — don't abort the batch.

Return shape:
```
{
  "processed": <int>,
  "auto_verified": <int>,
  "needs_review": <int>,
  "failed": <int>,
  "total_input_tokens": <int>,
  "total_output_tokens": <int>,
  "total_estimated_cost_usd": <number>,
  "duration_ms": <int>,
  "results": [
    { "fact_id": "...", "outcome": "...", "confidence": ..., "reasoning": "...",
      "sources_attempted": ..., "sources_confirmed": ...,
      "estimated_cost_usd": ..., "duration_ms": ... },
    ...
  ]
}
```

The admin UI uses this to render the progress and final summary, including the running cost.

### Step 4 — Admin UI: `/admin/facts/auto-seed`

Add a new admin route at `mobile/app/admin/facts/auto-seed.tsx`. Reuse existing theme tokens and component patterns from the other admin pages.

Required UI:
- Two input modes selectable via a tab control or radio:
  - **Mode A: Paste OpenTrivia DB JSON.** Same textarea + Import button as `/admin/facts/import`. The submit flow first calls `fact-bank-import` to land facts as pending, then calls `fact-bank-batch-seed` with the freshly-imported `fact_ids` (the import response should include them; if not, query for pending facts created in the last minute by the current user).
  - **Mode B: Auto-seed existing pending facts.** A category dropdown (populated from `categories` table) and a limit slider/input (default 50, max 200). Clicking "Auto-seed N facts" calls `fact-bank-batch-seed` with the category and limit.
- Real-time progress display while the batch runs (poll-based or based on the response stream — simplest is to wait for the response and render the summary at the end; if the batch is small enough that this doesn't feel slow, that's fine).
- Final summary view after completion: counts of auto_verified / needs_review / failed, total cost in USD, plus a link to `/admin/facts/needs-review` to handle the flagged ones and a link to `/admin/telemetry` for deeper analysis.
- Loading states and error display matching the pattern in `/admin/facts/import`.
- Confirm-before-running prompt for any batch larger than 20 facts. The prompt should show the estimated cost (compute from `~$0.020 × N` as a quick rule of thumb until real telemetry replaces it). Use `window.confirm()` (NOT `Alert.alert` — see constraints). Skip the prompt for batches ≤20.

### Step 5 — Admin UI: `/admin/facts/needs-review`

Add a new admin route at `mobile/app/admin/facts/needs-review.tsx`. Same pattern as `/admin/facts/queue` but filtered to `verification_status = 'needs_review'`.

For each row, display:
- Fact text
- Correct answer
- Latest cross-check reasoning from `fact_auto_seed_log` (this is the WHY — show it inline as a 2-3 line preview)
- Latest cross-check confidence
- `failure_stage` and `failure_reason` if present (e.g., a fact that hit the mechanical-sources requirement but never reached cross-check has no confidence, just a `failure_stage = 'mechanical_check'`)

Tapping a row navigates to `/admin/facts/[id]` for full review.

### Step 6 — Update `/admin/facts/[id]` to show full telemetry

Modify the existing fact detail page to show:
- The latest `fact_auto_seed_log` row for the fact (if any) — outcome, confidence, full reasoning, failure_stage, failure_reason, cost, models used, timestamp
- The N `fact_auto_seed_sources` rows linked to that log — for each, show URL (clickable), source_type, proposed_excerpt, the two flags (reachable, excerpt match), HTTP status code, fetch error if any, and whether it was inserted into the canonical `fact_sources` table

This is read-only context to inform the admin's decision when manually reviewing a `needs_review` fact. Do NOT change the existing Approve/Reject behavior. The trigger remains the gate.

### Step 7 — Admin UI: `/admin/telemetry` (read-only dashboard)

Add a new admin route at `mobile/app/admin/telemetry.tsx`. This is a single-page read-only dashboard backed by SQL queries against the two log tables.

Required widgets:
- **Aggregate counts** for the last 24 hours, 7 days, and all time: rows per `outcome` value
- **Average cross-check confidence** for `auto_verified` facts (sanity check: should be ≥4) and for `needs_review` facts (sanity check: should be <4)
- **Cost summary**: total `estimated_cost_usd` to date, average per fact, average per `auto_verified` fact, average per `needs_review` fact
- **Top failing source domains**: GROUP BY URL host of `fact_auto_seed_sources` rows where `excerpt_match = false`, ORDER BY count DESC, top 10. Tells you which domains the AI keeps failing on (e.g., Wikipedia's dynamic rendering issue).
- **Failure-stage distribution**: how often the pipeline fails at each stage. Helps prioritize tuning.
- **Latest 50 runs**: a table with timestamp, fact preview (first 80 chars), outcome, confidence, cost. Click row → navigate to `/admin/facts/[id]`.

All queries use the admin's user-scoped Supabase client. RLS enforces admin-only access. No new Edge Function needed — direct PostgREST queries from the mobile UI.

### Step 8 — Update admin home dashboard

Modify `mobile/app/admin/index.tsx` to add three new stats:
- `needs_review` count (facts with `verification_status = 'needs_review'`)
- Latest auto-seed batch summary (most recent 24h: total processed, auto-verify rate)
- Total cost to date (sum of `estimated_cost_usd` from `fact_auto_seed_log`)

Add navigation links to `/admin/facts/auto-seed` and `/admin/telemetry`.

### Step 9 — Telemetry & sanity check (Mike's calibration pass, post-implementation)

After the implementation is complete, Mike will run a calibration pass:
1. Auto-seed 50 facts in Geography (low-controversy category, easy to verify)
2. Open `/admin/telemetry` — verify the data is flowing and the cost matches expectations (~$1 for 50 facts)
3. Manually spot-check the first 20 auto-verified facts (open each in `/admin/facts/[id]`, click the source URLs, confirm the fact is correct)
4. Manually review the `needs_review` facts (should be 5–8 of the 50)
5. Note any auto-verified facts that should have been needs_review (false positives — bad outcome) and any needs_review facts that were obviously correct (false negatives — okay, just inefficient)

If false positive rate is >5%, Mike pauses and we tune the cross-check confidence threshold or model selection. If acceptable, Mike scales up to bigger batches across other categories.

This calibration step is NOT automated — it's the human verification that the AI-verifies-AI loop is actually working before trusting it at scale. Mike's calibration time: ~30 min.

### Step 10 — Run the Maestro suite

```
cd /Users/mizzy/Developer/Trivolta
supabase db reset
```

In separate terminal:
```
supabase functions serve --no-verify-jwt --env-file supabase/.env.local
```

Original terminal:
```
cd mobile && ./run_tests.sh
```

All 25 tests must pass. Re-grant admin to `trivoltaapp@outlook.com` after the reset.

### Step 11 — Update tracker

Edit `TRIVOLTA_TRACKER.md`:

- Under the Phase 2.6 section, restructure the seeding sub-phase:
  - `Phase 2.6.3a — Automated seeding tooling — INSTRUCTIONS_PHASE_2.6.3_AUTOMATED_SEEDING.md`
  - `Phase 2.6.3b — Calibration + curation (Mike, ~5 hrs reduced from 50)`
- Add `INSTRUCTIONS_PHASE_2.6.3_AUTOMATED_SEEDING.md` to the INSTRUCTIONS Files Written section, marked ✅ when this task ships.

### Step 12 — Commit

```
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > /tmp/trivolta_diff.txt
```

Stop and hand to Mac Claude for review. After approval, commit with message: `feat: Phase 2.6.3a — automated seeding pipeline (AI-verifies-AI cross-check, full forensic telemetry)`.

Commit list:
- `INSTRUCTIONS_PHASE_2.6.3_AUTOMATED_SEEDING.md` (this file)
- `TRIVOLTA_TRACKER.md`
- `supabase/migrations/20240107000000_auto_seed.sql`
- `supabase/functions/fact-bank-auto-seed/index.ts`
- `supabase/functions/fact-bank-batch-seed/index.ts`
- `mobile/app/admin/facts/auto-seed.tsx`
- `mobile/app/admin/facts/needs-review.tsx`
- `mobile/app/admin/facts/[id].tsx` (modified to show full telemetry)
- `mobile/app/admin/telemetry.tsx` (new)
- `mobile/app/admin/index.tsx` (modified to add needs_review count, cost, auto-seed link, telemetry link)
- `mobile/app/admin/_layout.tsx` (modified if necessary to register the new telemetry route in the Stack screens list)

Verify nothing secret is staged: `git status --porcelain | grep -E '\.env\.local|signing_keys\.json'` returns no output.

## Verification

```bash
# 1. Migration applies
cd /Users/mizzy/Developer/Trivolta && supabase db reset 2>&1 | tail -3
# expect: Finished supabase db reset

# 2. needs_review enum value present
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select pg_get_constraintdef(oid) from pg_constraint
where conname like '%verification_status%' and conrelid = 'public.facts'::regclass;
"
# expect: includes 'needs_review' in the check clause

# 3. Both telemetry tables exist with RLS enabled
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from information_schema.tables
where table_name in ('fact_auto_seed_log', 'fact_auto_seed_sources');
"
# expect: 2
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select bool_and(relrowsecurity) from pg_class
where relname in ('fact_auto_seed_log', 'fact_auto_seed_sources');
"
# expect: t

# 4. Cost helper function exists and computes correctly
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select public.estimate_anthropic_cost('claude-sonnet-4-6', 1000000, 1000000);
"
# expect: 18.000000  (= $3 + $15 per 1M each)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select public.estimate_anthropic_cost('claude-haiku-4-5-20251001', 1000000, 1000000);
"
# expect: 4.800000  (= $0.80 + $4.00 per 1M each)

# 5. Two new Edge Functions exist
ls /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-auto-seed/index.ts
ls /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-batch-seed/index.ts

# 6. Auto-seed uses Sonnet for cross-check; citation still uses Haiku
grep -l "claude-sonnet-4-6" /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-auto-seed/index.ts
grep -l "claude-haiku-4-5-20251001" /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-auto-seed/index.ts

# 7. Both new functions admin-gated
for fn in fact-bank-auto-seed fact-bank-batch-seed; do
  grep -c "app_metadata" /Users/mizzy/Developer/Trivolta/supabase/functions/$fn/index.ts
done
# expect: at least 1 each

# 8. Admin routes exist
ls /Users/mizzy/Developer/Trivolta/mobile/app/admin/facts/auto-seed.tsx
ls /Users/mizzy/Developer/Trivolta/mobile/app/admin/facts/needs-review.tsx
ls /Users/mizzy/Developer/Trivolta/mobile/app/admin/telemetry.tsx

# 9. Admin pages don't use Alert.alert (cross-platform issue)
grep -l "Alert.alert" /Users/mizzy/Developer/Trivolta/mobile/app/admin/facts/auto-seed.tsx \
                     /Users/mizzy/Developer/Trivolta/mobile/app/admin/facts/needs-review.tsx \
                     /Users/mizzy/Developer/Trivolta/mobile/app/admin/telemetry.tsx \
                     2>/dev/null || echo "OK: no Alert.alert in new admin pages"
# expect: OK: no Alert.alert in new admin pages

# 10. Maestro suite green
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh 2>&1 | tail -10
# expect: 25 passed, 0 failed

# 11. Cross-check threshold enforced (smoke test, post-deploy)
# Manually trigger fact-bank-auto-seed with curl on a known-true fact, expect auto_verified
# Manually trigger on a fact with deliberately wrong correct_answer (e.g. "capital of France" → "Berlin"),
# expect needs_review with low confidence and reasoning explaining the mismatch.

# 12. Telemetry rows are written (smoke test, post-deploy)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from public.fact_auto_seed_log;
"
# expect: at least 2 (one per smoke-test invocation above)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from public.fact_auto_seed_sources;
"
# expect: at least 4 (two sources proposed per fact × 2 facts)

# 13. Cost is non-zero on successful runs
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select bool_or(estimated_cost_usd > 0) from public.fact_auto_seed_log where outcome = 'auto_verified';
"
# expect: t  (assuming at least one auto_verified run completed in smoke testing)

# 14. Tracker updated
grep -c "Phase 2.6.3a" /Users/mizzy/Developer/Trivolta/TRIVOLTA_TRACKER.md
# expect: at least 1

# 15. No secrets staged
cd /Users/mizzy/Developer/Trivolta
git status --porcelain | grep -E '\.env\.local|signing_keys\.json'
# expect: no output
```

If any check fails, do not commit. Report to Mac Claude with the failing command output.
