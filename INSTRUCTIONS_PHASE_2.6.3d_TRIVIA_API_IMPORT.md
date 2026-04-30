# INSTRUCTIONS — Phase 2.6.3d: The Trivia API as a second import source

## Task

Trivolta currently imports facts from OpenTrivia DB via the `fact-bank-import` Edge Function. The Edge Function expects a JSON body shaped `{ results: [...] }` with OpenTrivia DB field names (`correct_answer`, `incorrect_answers`).

This phase adds **The Trivia API** (`the-trivia-api.com`) as a second import source. The Trivia API is free, requires no API key, and returns clean multiple-choice trivia. Its response shape and field names differ from OpenTrivia DB:

- Top-level shape: bare array `[...]` (vs OpenTrivia DB's `{ results: [...] }`)
- Field names: `correctAnswer` / `incorrectAnswers` (vs `correct_answer` / `incorrect_answers`)
- Has a `tags: string[]` field used for category disambiguation
- Some answers contain trailing `\u00a0` (non-breaking space) that must be stripped

The goal: extend `fact-bank-import` to **auto-detect** which source shape was pasted, normalise both into a single internal row format, and import them. The admin UI keeps its existing textarea and gains updated help text saying both formats are accepted. The response payload gains a `source` field (`'opentdb'` or `'trivia_api'`) and an `imported_ids: string[]` field listing every fact ID inserted.

A category map module for The Trivia API already exists at `supabase/functions/_shared/trivia-api-category-map.ts` — do not recreate it. Read it once for context, then import its functions.

The verification layer (`fact_sources`, `verification_status`) is unchanged. Imported Trivia API rows land as `pending`, the same as OpenTrivia DB rows. The only addition is `source_origin = 'trivia_api_import'` so future tooling can distinguish the two corpora.

## Verifiable objective

Every check below is binary. Do not report done until all pass.

- [ ] `supabase/functions/fact-bank-import/index.ts` accepts both `{ results: [...] }` and bare `[...]` request bodies without erroring on either.
- [ ] When the body is `{ results: [...] }`, the response includes `"source": "opentdb"`.
- [ ] When the body is bare `[...]`, the response includes `"source": "trivia_api"`.
- [ ] The response always includes an `imported_ids` array containing the UUID of every inserted fact, in import order. Length equals `imported`.
- [ ] OpenTrivia DB imports continue to work end-to-end — tested by re-running an existing OpenTrivia DB payload against the updated function and seeing identical `imported` count to before.
- [ ] A Trivia API payload of 5 questions imports successfully, each with 3 distractors, `source_origin = 'trivia_api_import'`, `verification_status = 'pending'`.
- [ ] Trailing `\u00a0` characters are stripped from `correctAnswer`, every entry in `incorrectAnswers`, and `question` text.
- [ ] HTML entity decoding is still applied to Trivia API rows (the existing `decodeEntities` function is reused, not duplicated).
- [ ] Tag-level category disambiguation works: a Trivia API row with `category: "Arts & Literature"` and `tags: ["painting"]` imports into the `art` Trivolta category, while one with `tags: ["novels"]` imports into `literature`.
- [ ] `mobile/app/admin/facts/import.tsx` accepts either format pasted into the textarea — no parse error fires for a top-level array.
- [ ] The body text under the heading on `/admin/facts/import` is updated to mention both sources are accepted (rough wording: "Paste either an OpenTrivia DB response (`{ results: [...] }`) or a Trivia API response (`[...]`). Auto-detected.").
- [ ] The result panel on the admin import page shows the detected source (e.g. a row labelled "Source" with value `opentdb` or `trivia_api`).
- [ ] `cd mobile && npx tsc --noEmit` exits 0.
- [ ] `./run_tests.sh` runs the full Maestro suite to completion (no new tests required for this phase — the existing 25 must all still pass against the modified import flow code, even though they don't exercise it directly).

## Constraints

- **Do not modify** `supabase/functions/_shared/trivia-api-category-map.ts`. It already exists and is correct. Import from it; do not change it.
- **Do not modify** `supabase/functions/_shared/opentdb-category-map.ts` or anything related to OpenTrivia DB mapping. The OpenTrivia DB path must remain byte-for-byte equivalent in behaviour.
- **Do not** create a new Edge Function. All work goes into the existing `fact-bank-import` function.
- **Do not** add a "Fetch from Trivia API" button or any URL-fetch flow to the admin UI. Paste-only, same as today.
- **Do not** introduce any new dependencies in `supabase/functions/fact-bank-import/index.ts` beyond what's already imported plus the existing `trivia-api-category-map.ts` shared module.
- **Do not** change the `pending` verification status, do not auto-confirm sources, do not call Anthropic from this function — this is pure import.
- **Do not** change the auth preamble (Authorization header check, `auth.getUser()`, admin role check). Keep the apikey-header-with-env-fallback pattern.
- **Do not** rename or remove existing fields from the response (`imported`, `skipped_non_multiple`, `skipped_unknown_category`, `failed`, `errors`). Only **add** `source` and `imported_ids`.
- **Do not** loosen the existing `type: 'multiple'` filter. Trivia API rows do not have a `type` field, so the multiple-choice filter is implicit (the API only returns multiple-choice). The OpenTrivia DB filter must continue to skip non-multiple rows.
- **Do not** edit any other file under `mobile/app/admin/`. Only `import.tsx` changes on the mobile side.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read the existing pieces (no edits)

Read these files in order, just for context:

1. `supabase/functions/fact-bank-import/index.ts` — the function being modified
2. `supabase/functions/_shared/trivia-api-category-map.ts` — the existing map module to import from
3. `supabase/functions/_shared/opentdb-category-map.ts` — the existing OpenTrivia DB map module (for reference, do not edit)
4. `mobile/app/admin/facts/import.tsx` — the admin UI being modified

### 2. Modify `supabase/functions/fact-bank-import/index.ts`

Add the auto-detection, normalisation, and per-source import paths. Suggested shape (Claude Code can adapt as long as the verifiable objectives pass):

- Add an import: `import { mapTriviaApiCategory, FALLBACK_SLUG } from '../_shared/trivia-api-category-map.ts'`
- Add a `TriviaApiRow` type covering: `category: string`, `tags?: string[]`, `difficulty?: string`, `question: { text: string } | string`, `correctAnswer: string`, `incorrectAnswers: string[]`. (The Trivia API has wrapped `question.text` in newer responses; handle both string and `{ text }` defensively — fall back gracefully if neither.)
- Add a small helper `stripNbsp(s: string): string` that removes trailing `\u00a0` characters (and leading/trailing whitespace as a side-effect — use `.replace(/\u00a0/g, ' ').trim()`).
- Replace the body-parsing block. After `JSON.parse`:
  - If `body` is an array → `source = 'trivia_api'`, `rows = body`.
  - Else if `body?.results` is an array → `source = 'opentdb'`, `rows = body.results`.
  - Else → 400 with message `Body must be either { results: [...] } (OpenTrivia DB) or [...] (Trivia API)`.
- Build a normalised row processor. Two thin adapters that produce the same internal shape:
  ```
  { slug: string, factText: string, correctAnswer: string, incorrectAnswers: string[], difficulty: number, sourceOrigin: 'opentdb_import' | 'trivia_api_import' }
  ```
  - OpenTrivia DB adapter: existing logic, `source_origin = 'opentdb_import'`. Keep the `type !== 'multiple'` skip.
  - Trivia API adapter: extract `factText` from `row.question` (string or `.text`), strip nbsp, decode entities, map category via `mapTriviaApiCategory(row.category, row.tags ?? [])`, difficulty via the same `DIFFICULTY_MAP` (Trivia API uses `easy` / `medium` / `hard` strings, same as OpenTrivia DB), `source_origin = 'trivia_api_import'`. Run `stripNbsp` AND `decodeEntities` on `correctAnswer` and every `incorrectAnswers` entry.
  - For the Trivia API path, add an unknown-category counter — when `mapTriviaApiCategory` falls through to `FALLBACK_SLUG` AND the input was not `'General Knowledge'` or `'Food & Drink'` (the two known fallback cases), increment `skipped_unknown_category`. Use `isKnownTriviaApiCategory` from the shared module.
- Track `imported_ids: string[]` alongside the existing counters. Push each successful `factInsert.id` onto it.
- Final response JSON: `{ source, imported, imported_ids, skipped_non_multiple, skipped_unknown_category, failed, errors }`.
- For Trivia API rows, `skipped_non_multiple` is always 0 (the API only serves multiple-choice). Don't introduce special logic — just don't increment it on that path.

### 3. Modify `mobile/app/admin/facts/import.tsx`

- Update the help text under the heading to roughly: `Paste either an OpenTrivia DB response ({ results: [...] }) or a Trivia API response ([...]). Auto-detected.`
- Update `ImportResult` type to add `source: 'opentdb' | 'trivia_api'` and `imported_ids: string[]`.
- Update the parse-validation block in `handleImport`. Currently it rejects anything that isn't `{ results: [...] }`. Change to: accept either a top-level array OR an object with `.results` array. If neither, parse error: `Expected an array (Trivia API) or { results: [...] } (OpenTrivia DB)`.
- The body sent to the Edge Function is the parsed value as-is — pass arrays as arrays, objects as objects. The Supabase JS client's `functions.invoke` serialises whatever's passed. Do not wrap arrays.
- Add a `Source` row to the result panel showing `result.source`. Place it as the first row in the result panel, above `Imported`. No accent colour.
- Do not add new buttons or input fields. Do not change styles. Token-only changes plus the help text and the new result row.

### 4. Verify locally

Run, in order:

1. `cd mobile && npx tsc --noEmit` — must exit 0.
2. Restart the Edge Function:
   ```
   supabase functions serve --no-verify-jwt --env-file supabase/.env.local
   ```
3. **OpenTrivia DB regression test.** Use this exact payload (5 rows, the canonical OpenTrivia DB shape) via the admin import page. Confirm `source: opentdb`, `imported: 5`, `imported_ids` length 5, no errors:
   ```
   curl -sS "https://opentdb.com/api.php?amount=5&type=multiple&category=22"
   ```
   Paste the response into `/admin/facts/import` and click Import.
4. **Trivia API smoke test.** Fetch and paste:
   ```
   curl -sS "https://the-trivia-api.com/api/questions?categories=geography&limit=5"
   ```
   Paste the response (a top-level array) into the same textarea and click Import. Expected: `source: trivia_api`, `imported: 5`, `imported_ids` length 5.
5. **Tag-disambiguation test.** Fetch:
   ```
   curl -sS "https://the-trivia-api.com/api/questions?categories=arts_and_literature&limit=10"
   ```
   Paste and import. Then in Studio (`http://127.0.0.1:54323`) run:
   ```sql
   select c.slug, count(*)
   from facts f join categories c on c.id = f.category_id
   where f.source_origin = 'trivia_api_import'
   group by c.slug;
   ```
   Confirm rows are split between `art` and `literature` based on tags (not all in one bucket).
6. **NBSP-strip test.** After the imports above, run:
   ```sql
   select count(*) from facts where correct_answer like '%' || chr(160) || '%';
   select count(*) from distractors where distractor_text like '%' || chr(160) || '%';
   ```
   Both must return 0.
7. **Error-shape test.** Send `{}` to the function (paste literal `{}` and click Import). The mobile UI should show the parse error from step 3's logic. Send `{ "foo": "bar" }` — same parse error. These should never reach the server. Send a malformed array (`[{ "category": "Geography" }]`) — the server accepts it, attempts to insert, and reports it under `failed` with an error message. Confirm.
8. **Maestro full suite.**
   ```
   cd mobile && ./run_tests.sh
   ```
   Confirm all 25 tests pass. Confirm a simulator was actually booted (per the known `run_tests.sh` masking issue — eyeball the test count and timings, don't trust a sub-10s run).

### 5. Capture diff

```
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
```

Stop. Do not commit. Report back with: TypeScript pass/fail, OpenTrivia DB regression result, Trivia API smoke result, tag split counts from step 5, NBSP query results, Maestro test count, and any errors observed. Mac Claude will review the diff against the four criteria before commit.

## Verification

Final command set Claude Code must run and report results from:

```
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh
```

Plus the SQL spot-checks from step 4.5 and 4.6.

Do not report success until every box in **Verifiable objective** is ticked and Mac Claude has approved the diff.

---

Read INSTRUCTIONS_PHASE_2.6.3d_TRIVIA_API_IMPORT.md and execute all steps exactly as written.
