# INSTRUCTIONS — Replace `solo-question` with DB Fact Lookup

## Objective

Replace the Anthropic API call inside the `solo-question` Edge Function with a direct read from the `facts` table. Solo gameplay should make zero AI calls and cost $0 to serve. The mobile app must not need any changes — the response shape stays identical.

## Why

The 3,285 OpenTrivia DB questions in the local `facts` table are vetted, commercially-licensed (CC BY-SA 4.0), and ready to serve. Generating questions on every solo play via Anthropic is unnecessary cost and unnecessary hallucination risk. See `HANDOFF_2026_05_04.md` for the full decision context.

---

## Scope

Three things change:

1. **`supabase/functions/solo-question/index.ts`** — Anthropic call replaced with DB query
2. **One new migration** — relax the `facts_read_verified` RLS policy so authenticated users can read all facts (including `verification_status = 'pending'`) for beta
3. **`TRIVOLTA_TRACKER.md`** — add a Post-Beta Restoration entry tracking the relaxed policy

Out of scope (separate INSTRUCTIONS file later):
- `generate-questions` lobby function (still calls Anthropic — replace next)
- Anti-repetition via `fact_exposures` writes (defer; client-side `previousQuestions` filter is sufficient for beta)
- Cleaning up the `Anthropic` import / env var usage if `solo-question` is the only consumer (defer until lobby function is also replaced)

---

## Pre-flight checks

Run before writing any code:

```bash
git status                       # working tree must be clean
cd mobile && npx tsc --noEmit    # baseline must compile
```

If either fails, stop and tell Mike.

---

## Task 1 — Migration: relax `facts` read policy

Create a new migration. Use today's date and an unused timestamp:

**Path:** `supabase/migrations/<timestamp>_relax_facts_read_for_beta.sql`

**Content:**

```sql
-- Beta-only: allow authenticated users to read facts regardless of verification_status.
-- The original policy gated reads on verification_status = 'verified', which made sense
-- when facts were ingested from arbitrary AI-authored sources. For beta, all facts come
-- from OpenTrivia DB (a vetted, commercially-licensed source) and remain status='pending'
-- because Trivolta's own verification pipeline (fact_sources confirmations) does not
-- apply to externally-vetted imports.
--
-- TODO(post-beta): Restore the verification gate before opening to non-beta users, OR
-- decide on a permanent verification model for externally-imported facts. The original
-- policy was:
--
--   create policy "facts_read_verified" on public.facts
--     for select using (
--       auth.role() = 'authenticated' and verification_status = 'verified'
--     );
--
-- See TRIVOLTA_TRACKER.md → "Post-Beta Restoration" for tracking.

drop policy if exists "facts_read_verified" on public.facts;

create policy "facts_read_authenticated" on public.facts
  for select using (auth.role() = 'authenticated');
```

**Apply the migration WITHOUT a DB reset (preserve the OpenTrivia DB import):**

```bash
supabase migration up
```

This applies pending migrations against the existing DB. The 3,285 facts stay in place. **Do not run `supabase db reset`** — it would wipe the OpenTrivia DB import and force a costly re-download.

**Verify the policy is installed:**

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -c \
  "select polname from pg_policy where polrelid = 'public.facts'::regclass;"
```

Expected: `facts_read_authenticated` is listed; `facts_read_verified` is gone.

**Verify the data is still there:**

```bash
docker exec -i supabase_db_Trivolta psql -U postgres -d postgres -tAc \
  "select count(*) from public.facts where source_origin = 'opentdb_import';"
```

Expected: `3285`.

---

## Task 2 — Replace `solo-question` Edge Function body

**Path:** `supabase/functions/solo-question/index.ts`

**Current request shape (do not change):**

```ts
{ category: string, streak: number, previousQuestions: string[] }
```

**Current response shape (do not change):**

```ts
{
  question: string          // the question text
  answers: string[]         // length 4, pre-shuffled
  correct_index: number     // 0..3, points into answers
  explanation: string       // one sentence
  difficulty: string        // 'easy' | 'medium' | 'hard'
  category: string          // echoes input slug
}
```

The mobile app's `generateSoloQuestion` in `mobile/lib/api.ts` consumes this exact shape. Do not change field names or types.

**New behavior:**

1. Keep the existing CORS / OPTIONS handling.
2. Keep the existing `Authorization` header check + `auth.getUser()` flow exactly as-is. Do not weaken auth.
3. Parse `{ category, streak = 0, previousQuestions = [] }` from the body (same as today).
4. Compute `difficulty` from `streak` using the existing `difficultyFromStreak` helper. Keep the helper.
5. Construct a Supabase client using the user's JWT (same pattern as today). Use it for the SELECT — no service role.
6. Run a single SQL query that:
   - JOINs `facts` with `categories` on `facts.category_id = categories.id`
   - Filters `categories.slug = <category>`
   - Filters `facts.source_origin = 'opentdb_import'`
   - Excludes any fact where `fact_text = ANY(previousQuestions)` (skip the filter if `previousQuestions` is empty)
   - Joins `distractors` on `distractors.fact_id = facts.id` and `distractors.is_active = true`
   - Returns one random fact and its 3 active distractors

   The cleanest way: two queries are acceptable if a single query is awkward. First fetch the fact (random row matching filters), then fetch its distractors by `fact_id`.

7. Build the response:
   - `question` ← `facts.fact_text`
   - Build a 4-element array from `[correct_answer, distractor_1, distractor_2, distractor_3]`
   - **Shuffle the array** (Fisher-Yates or equivalent — do not use `Math.random() - 0.5` sort)
   - `correct_index` ← post-shuffle index of the correct answer
   - `answers` ← the shuffled array
   - `explanation` ← empty string `""` (OpenTrivia DB facts have no explanations; mobile app already handles this gracefully — verify by reading `mobile/app/question.tsx` if uncertain)
   - `difficulty` ← the `difficultyFromStreak(streak)` value (string)
   - `category` ← echo the input `category` string
8. Error handling:
   - If no fact matches (e.g. all questions in category exhausted by `previousQuestions`, or category slug invalid): return `503` with `{ error: 'no_questions_available' }`. Same status code as today's Anthropic-failure path so the mobile error UI behaves identically.
   - If a fact matches but has fewer than 3 active distractors: return `503` with `{ error: 'insufficient_distractors', fact_id: <id> }`. This indicates a data integrity problem worth surfacing rather than silently padding.
   - All other unexpected errors: `503` with `{ error: String(err) }` (matches today).

**Constraints — pulled from `CLAUDE.md`, do not violate:**

- **Answer Shuffle Rule:** Answers arrive pre-shuffled from the backend. The Edge Function does the shuffle once. Mobile must not re-shuffle.
- **Authorization:** Edge Function MUST validate the `Authorization` header and return 401 on missing/invalid JWT. Use the apikey-header-with-env-fallback pattern for the Supabase client construction.
- **No service role:** Do not introduce `SUPABASE_SERVICE_ROLE_KEY` usage. The user's JWT is sufficient now that the read policy is relaxed.
- **API Key Rule:** No Anthropic API key reads. Remove the `Anthropic` import and the `ANTHROPIC_API_KEY` reference from this file. (The key is still used by `generate-questions` and `daily-challenge`, so leave the Supabase secret alone.)

---

## Task 3 — Verification (mandatory, in order)

```bash
# 1. Edge function compiles / serves
cd supabase
supabase functions serve --no-verify-jwt
# In another terminal:
curl -X POST http://localhost:54321/functions/v1/solo-question \
  -H "Authorization: Bearer <a valid local JWT>" \
  -H "apikey: <local sb_publishable key>" \
  -H "Content-Type: application/json" \
  -d '{"category":"science","streak":0,"previousQuestions":[]}'
# Expected: 200, response shape matches contract above. Inspect by eye.

# 2. Mobile compiles
cd mobile && npx tsc --noEmit
# Expected: no errors.

# 3. Native build for Maestro
cd mobile
npx expo prebuild --platform ios --clean
npx expo run:ios

# 4. Full Maestro suite
./run_tests.sh
# Expected: 26/26 passing.
```

If any step fails, diagnose root cause before patching (per `CLAUDE.md` → "Root Cause Before Fix"). State the diagnosed cause explicitly before changing any file.

**Do not commit before verification passes.**

---

## Task 4 — Tracker entry

Edit `TRIVOLTA_TRACKER.md` (use `Filesystem:edit_file` with `dryRun: true` first to confirm the patch). Add a new top-level section if "Post-Beta Restoration" doesn't already exist:

```markdown
## Post-Beta Restoration

Items relaxed for beta that must be revisited before opening to non-beta users.

- **`facts` RLS read policy** — Migration `<timestamp>_relax_facts_read_for_beta.sql` replaced `facts_read_verified` with `facts_read_authenticated`, allowing authenticated users to read facts regardless of `verification_status`. Original predicate was `verification_status = 'verified'`. Decision: revisit before non-beta launch — either restore the gate (and ingest a verification model for external imports) or commit to the relaxed policy permanently. Migration comment carries the full restoration SQL.
```

If the section already exists, append the bullet under it.

---

## Task 5 — Commit

Single commit. Suggested message:

```
feat(solo-question): replace Anthropic generation with DB fact lookup

- Migration: relax facts read policy for beta (authenticated, no status gate)
- Edge function: SELECT random fact + 3 distractors, shuffle, return existing shape
- Mobile contract preserved: no client changes
- Tracker: post-beta restoration item logged

26/26 Maestro passing. Mobile tsc clean.
```

Capture the diff at `~/trivolta_diff.txt` per `CLAUDE.md`. Do **not** push or commit until Mike has reviewed the diff.

---

## Out-of-scope reminders (do not do these in this task)

- Do not touch `generate-questions`, `daily-challenge`, `create-lobby`, `join-lobby`, or `submit-feedback`.
- Do not write to `fact_exposures`. Anti-repetition stays client-side (`previousQuestions`) for now.
- Do not delete `INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md` or any other historical INSTRUCTIONS file. They stay on disk per project convention.
- Do not change `CLAUDE.md`. Mike will update it after the code lands.
- Do not run `bash simplify-and-verify.sh` or `bash run-review.sh` — Mike will handle review tooling once he's reviewed the diff.
- **Do not run `supabase db reset`** under any circumstances during this task. It wipes the imported facts and forces a re-download.

---

## Stop conditions

Stop and ask Mike if any of these happen:

- `supabase migration up` fails or reports an unexpected state
- The post-migration row count check returns anything other than `3285`
- Maestro fails any test after your fix attempt(s)
- The mobile app crashes or renders incorrectly against the new function
- You discover the response contract is broader than documented above (extra fields the mobile expects)
- Anything in `CLAUDE.md` appears to conflict with these instructions
