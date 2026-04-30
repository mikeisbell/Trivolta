# INSTRUCTIONS — Phase 2.6.4: Render + Compose Edge Functions

## Task

Phase 2.6.4 wires the fact bank to gameplay. Two new Edge Functions and one new schema table.

**`render-question`** takes a fact + style + target_difficulty + tone and produces a rendered question (stem + correct answer + 3 distractors). Output cached in a new `question_renderings` table keyed by `(fact_id, style, target_difficulty, tone)`. Cache hit = single SELECT, no Anthropic call. Cache miss = Sonnet rewords, **then a Haiku correctness check validates the rendering preserves meaning** (per `TRIVOLTA_HALLUCINATION_STRATEGY.md`). Failed correctness checks retry up to 2 times before giving up and falling back to the raw fact.

**`compose-game`** is the new gameplay entry point. Takes `category_slug` + `count` + optional `style_mix` + the player's session state. Selects N facts from the bank using the verification gate (prod = `verified` only; dev/Simulator/Maestro = `pending` allowed), calls `render-question` per fact, returns the assembled game.

**`question_renderings` schema** caches the validated output so subsequent requests are pure reads.

This phase **does not** modify any mobile code. Phase 2.6.5 is the cutover. After 2.6.4 ships, Mike can hit `compose-game` via curl/admin UI to validate end-to-end, but `solo-question` and `generate-questions` remain the live gameplay path until 2.6.5.

The hallucination strategy (`TRIVOLTA_HALLUCINATION_STRATEGY.md`) is the authoritative design doc for the correctness check. Read it before writing the render-question prompt.

---

## Verifiable Objective

### Schema
- [ ] New migration file at `supabase/migrations/20240108000000_question_renderings.sql` creating the `question_renderings` table with columns: `id uuid pk`, `fact_id uuid fk facts on delete cascade`, `style text`, `target_difficulty integer (1-5)`, `tone text`, `question_text text`, `correct_answer text`, `distractors text[] (length 3)`, `model_used text`, `correctness_check_passed boolean`, `correctness_check_reasoning text`, `created_at timestamptz default now()`.
- [ ] Unique index on `(fact_id, style, target_difficulty, tone)`.
- [ ] Lookup index on `(fact_id)` for cache reads.
- [ ] RLS enabled. SELECT permitted for authenticated users. INSERT/UPDATE/DELETE service-role only.
- [ ] Schema applied cleanly via `supabase db reset` with no errors.

### `render-question` Edge Function
- [ ] New directory `supabase/functions/render-question/index.ts` exists.
- [ ] Accepts POST body `{ fact_id: uuid, style: 'direct' | 'indirect' | 'timed_challenge', target_difficulty: 1-5, tone: 'neutral' | 'playful' | 'formal' }`.
- [ ] Auth preamble matches existing fact-bank functions (Authorization header + `auth.getUser()` + admin-or-authenticated check; gameplay uses authenticated, no admin requirement).
- [ ] **Cache hit path**: SELECT from `question_renderings` by the four-tuple. If found AND `correctness_check_passed = true`, return it. Zero Anthropic calls.
- [ ] **Cache miss path**: SELECT fact + active distractors from DB. Call Sonnet with the constrained-prompt structure below. Call Haiku correctness check on the result. Retry up to 2 times on correctness failure. If all 3 attempts fail, return the raw fact (`fact_text` as question, `correct_answer` as answer, original distractors) with `correctness_check_passed: false` flagged in the response — this is the safe fallback, not a feature.
- [ ] Successful renderings INSERT into `question_renderings` with `correctness_check_passed = true`. Failed-after-retry renderings are NOT cached (returned to caller with the flag, but not persisted, so the next request retries).
- [ ] Response shape: `{ question_text, correct_answer, distractors: string[3], style, target_difficulty, tone, fact_id, cached: boolean, correctness_check_passed: boolean, model_used: string }`.

### Sonnet rendering prompt (constrained)
- [ ] System prompt instructs Sonnet to:
  - Reword the verbatim `fact_text` into a question that resolves to the verbatim `correct_answer`.
  - Preserve all proper nouns, years, numerical values, and units **exactly** as written in the source fact.
  - Do not introduce facts not present in the source.
  - Do not change the answer.
  - Match the requested style (direct/indirect/timed_challenge) and tone.
- [ ] User prompt includes: verbatim `fact_text`, verbatim `correct_answer`, the 3 distractors, requested style, requested target_difficulty, requested tone.
- [ ] Model: `claude-sonnet-4-6`. Temperature: 0.4 (some variety, but constrained). Max tokens: 400.

### Haiku correctness check
- [ ] After Sonnet returns, the rendered question goes to Haiku for validation.
- [ ] System prompt instructs Haiku to answer two questions: (a) Does the rendered question, taken at face value, resolve to the same correct answer as the source fact? (b) Are all key entities (people, places, dates, numbers, units) from the source fact preserved verbatim in the rendered question or its expected answer?
- [ ] Haiku returns JSON: `{ passes: boolean, reasoning: string }`.
- [ ] Model: `claude-haiku-4-5-20251001`. Temperature: 0. Max tokens: 200.
- [ ] On `passes = false`, retry the Sonnet rendering (up to 2 retries, 3 attempts total). Each retry adds the failed reasoning to the Sonnet prompt as a "do not repeat this mistake" hint.
- [ ] Reasoning from the final attempt is stored in `correctness_check_reasoning` regardless of pass/fail.

### `compose-game` Edge Function
- [ ] New directory `supabase/functions/compose-game/index.ts` exists.
- [ ] Accepts POST body `{ category_slug: string, count: number, style_mix?: { direct?: number, indirect?: number, timed_challenge?: number }, target_difficulty?: 1-5 }`.
- [ ] Auth preamble: authenticated user required, no admin gate.
- [ ] **Verification gate**: reads `Deno.env.get('TRIVOLTA_ENV')`. If `'production'`, filters facts by `verification_status = 'verified'`. Otherwise allows `verification_status in ('verified', 'pending')`. Default env when unset: `'development'` (i.e. permissive).
- [ ] Selects `count` facts from the category using the gate, `ORDER BY random()`, no fact repeated within the response.
- [ ] If insufficient facts available (e.g. category has 5 verified facts but `count = 10`), returns 422 with a clear error message naming the slug and counts.
- [ ] Calls `render-question` for each selected fact. Default `style_mix`: 7 direct, 2 indirect, 1 timed_challenge. Default `target_difficulty`: derived from fact's stored difficulty.
- [ ] Returns `{ questions: Array<RenderedQuestion>, category: { slug, display_name }, env: 'production' | 'development' }`.
- [ ] **Renders run in parallel** via `Promise.all`. A single failed render does NOT fail the whole game — it falls back to the raw-fact safe fallback (same as render-question's internal fallback).

### Verification & testing
- [ ] `cd mobile && npx tsc --noEmit` exits 0 (no mobile changes, but ensures nothing was broken in shared types).
- [ ] Edge Functions deploy via `supabase functions serve --no-verify-jwt --env-file supabase/.env.local` without error.
- [ ] Smoke test 1: POST to `render-question` with a fact_id from the seeded geography facts. First call returns `cached: false`, `correctness_check_passed: true`, valid question. Second identical call returns `cached: true` and is sub-100ms.
- [ ] Smoke test 2: POST to `compose-game` with `{ category_slug: 'geography', count: 10 }`. Returns 10 distinct questions. All have `correctness_check_passed: true` OR a fallback flag.
- [ ] Smoke test 3: POST to `compose-game` with `{ category_slug: 'art', count: 10 }` (only 76 facts available). Returns 10 questions or 422 if dedup constraints make 10 unreachable — either is acceptable, the failure mode just must be clean.
- [ ] Smoke test 4: induce a correctness failure by manually patching the Sonnet prompt temporarily to swap years (Claude Code can do this in a scratch test). Confirm the Haiku check catches it, retries, and either recovers or falls back. Revert the patch.
- [ ] All 25 Maestro tests still pass (no mobile changes — this verifies nothing in the shared code path was broken).

---

## Constraints

- **Do not** modify `solo-question`, `generate-questions`, or any existing Edge Function. They remain the live gameplay path until Phase 2.6.5.
- **Do not** modify any mobile code. No `import.tsx`, no admin pages, no theme, no nothing.
- **Do not** add a hard schema migration that drops or alters existing tables. The new migration is additive only.
- **Do not** skip the correctness check on cache misses. The whole point of this phase is the check.
- **Do not** cache renderings that failed the correctness check. The fallback path returns them to the caller but does not persist them.
- **Do not** call Sonnet for the correctness check. It must be Haiku — cost matters at scale.
- **Do not** introduce a third model. Sonnet for rendering, Haiku for checking. That's it.
- **Do not** parallelize Sonnet + Haiku calls. They are sequential by necessity (Haiku validates Sonnet's output).
- **Do not** add the verification-gate logic to `render-question`. That's `compose-game`'s job. `render-question` operates on whatever fact_id it's given.
- **Do not** add new dependencies beyond what existing fact-bank functions already import.
- **Do not** silently swallow Anthropic errors. Wrap each call in try/catch and surface the model name + error in the response so debugging is possible.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

---

## Steps

### 1. Read existing pieces (no edits)

1. `supabase/migrations/20240106000000_fact_bank_schema.sql` — existing fact bank schema for column reference
2. `supabase/functions/fact-bank-validate-source/index.ts` — existing pattern for Haiku JSON-mode calls
3. `supabase/functions/fact-bank-generate-distractors/index.ts` — existing retry-on-AI-failure pattern
4. `supabase/functions/fact-bank-import/index.ts` — existing auth preamble pattern
5. `TRIVOLTA_HALLUCINATION_STRATEGY.md` — design rationale for the correctness check
6. `PHASE_2.6_ARCHITECTURE.md` (if present) — original architecture notes

### 2. Create the migration

`supabase/migrations/20240108000000_question_renderings.sql`. Schema per the verifiable objective above. Apply via `supabase db reset` to verify it's clean.

### 3. Create `supabase/functions/render-question/index.ts`

Follow the auth + Anthropic-call patterns from `fact-bank-validate-source` and `fact-bank-generate-distractors`. Structure:

1. Auth preamble (Authorization header + `auth.getUser()`).
2. Parse + validate body. 400 on invalid.
3. Cache lookup. Return early on hit.
4. Load fact + active distractors from DB. 404 if fact_id not found.
5. Sonnet attempt loop (max 3):
   a. Build prompt with verbatim fact_text, correct_answer, distractors, style, target_difficulty, tone.
   b. On retry attempts, append the previous Haiku rejection reasoning to the prompt as a "do not repeat" hint.
   c. Call Sonnet. Parse rendered question + answer.
   d. Call Haiku correctness check. Parse `{ passes, reasoning }`.
   e. If `passes`, break.
6. If passed: INSERT into `question_renderings`, return rendering with `cached: false, correctness_check_passed: true`.
7. If all 3 attempts failed: return raw fact as fallback, `correctness_check_passed: false`. Do NOT cache.

### 4. Create `supabase/functions/compose-game/index.ts`

1. Auth preamble (authenticated only, no admin).
2. Parse + validate body. 400 on invalid.
3. Read `TRIVOLTA_ENV`. Build verification filter.
4. SELECT facts from the category with the filter, `ORDER BY random()`, LIMIT count. 404 if category not found, 422 if insufficient facts.
5. Build the style mix per request (or default 7/2/1).
6. `Promise.all` over `render-question` calls (one per selected fact). Use `Deno.env.get('SUPABASE_URL')` + service-role auth to invoke render-question internally — DO NOT make a second auth round-trip per render.
7. Return assembled game.

### 5. Verify locally

In order:

1. `cd mobile && npx tsc --noEmit` → exit 0.
2. `supabase db reset` → migration applies cleanly, all 8 migrations succeed.
3. `./mobile/dev-reset.sh` → admin user provisioned.
4. `./mobile/seed-trivia-api.sh` → ~3,976 facts back in DB.
5. `supabase functions serve --no-verify-jwt --env-file supabase/.env.local`.
6. **Smoke test 1 (render-question, cache miss + cache hit)**:
   ```bash
   FACT_ID=$(psql "$DB_URL" -tAc "select id from facts where source_origin = 'trivia_api_import' and category_id = (select id from categories where slug = 'geography') limit 1")
   curl -sS -X POST "http://127.0.0.1:54321/functions/v1/render-question" \
     -H "Authorization: Bearer $JWT" -H "apikey: $PUBLISHABLE_KEY" \
     -H "Content-Type: application/json" \
     -d "{\"fact_id\":\"$FACT_ID\",\"style\":\"direct\",\"target_difficulty\":3,\"tone\":\"neutral\"}"
   # Expect cached: false, correctness_check_passed: true.
   # Repeat the same call → cached: true, sub-100ms.
   ```
7. **Smoke test 2 (compose-game)**:
   ```bash
   curl -sS -X POST "http://127.0.0.1:54321/functions/v1/compose-game" \
     -H "Authorization: Bearer $JWT" -H "apikey: $PUBLISHABLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"category_slug":"geography","count":10}'
   # Expect 10 questions, all correctness_check_passed: true.
   ```
8. **Smoke test 3 (sparse category)**:
   ```bash
   curl -sS -X POST "http://127.0.0.1:54321/functions/v1/compose-game" \
     -H "Authorization: Bearer $JWT" -H "apikey: $PUBLISHABLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"category_slug":"art","count":10}'
   # 76 facts available, expect 10 questions or clean 422.
   ```
9. **Smoke test 4 (induced correctness failure)**:
   Temporarily patch the Sonnet prompt in `render-question/index.ts` to instruct Sonnet to swap the year by 3 (e.g. "if the fact mentions 1979, output 1982"). Run smoke test 1 again with a different fact_id. Confirm Haiku catches it, retries up to 2x, and either recovers (Sonnet ignores the bad instruction on retry) or falls back. Revert the patch. Restart functions serve.
10. **Maestro suite**: `cd mobile && ./run_tests.sh` → 25/25 pass.
11. `git diff HEAD > ~/trivolta_diff.txt` and stop. Mac Claude reviews before commit.

---

## Verification

Final commands Claude Code must run and report from:

```
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit
# the four smoke tests above (output captured)
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh
```

Report: TS pass/fail, migration apply pass/fail, smoke test 1 (cache miss latency, cache hit latency, both passing correctness check), smoke test 2 (10 questions returned, all passing), smoke test 3 (10 returned OR clean 422), smoke test 4 (catch + retry + recovery OR catch + fallback), Maestro count.

After Mac Claude approves the diff, commit. Phase 2.6.4 done. Phase 2.6.5 (mobile cutover) is the next handoff.

---

Read INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md and execute all steps exactly as written.
