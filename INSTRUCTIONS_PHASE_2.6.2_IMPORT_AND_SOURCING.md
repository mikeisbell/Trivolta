# INSTRUCTIONS_PHASE_2.6.2_IMPORT_AND_SOURCING.md

## Task

Wire up the import and source-citation pipeline that turns the Phase 2.6.1 admin shell into a functional seeding tool. After this task, Mike can paste OpenTrivia DB JSON into the import page, see facts land in `pending` state with imported distractors attached, then move through a queue where AI proposes 2 source URLs per fact, the backend mechanically validates each URL is reachable AND its excerpt actually appears at that URL, and Mike approves or rejects. On reaching ≥2 confirmed sources for a `cross-referenced` category, the verification trigger from Phase 2.6.1 auto-promotes the fact to `verified`. Approve and Reject buttons on the fact detail page are wired up. AI distractor generation for long-tail facts is provided as a separate flow.

This is the second sub-phase of Phase 2.6. See `PHASE_2.6_ARCHITECTURE.md` for the full design — that document is authoritative for the overall pipeline. Phase 2.6.1 schema is locked and is NOT modified by this sub-phase.

## Prerequisite

Phase 2.6.1 is complete: schema migrated, admin role granted, admin route stubs render, Maestro suite green. `trivoltaapp@outlook.com` has admin role and signs into Expo Web admin tooling.

## Verifiable objective

- [ ] Three new Edge Functions exist and deploy/serve cleanly: `fact-bank-import`, `fact-bank-validate-source`, `fact-bank-generate-distractors`
- [ ] All three functions follow the existing auth pattern: `--no-verify-jwt` flag, `Authorization` header check + `auth.getUser()`, `apikey` header read with env fallback. Additionally, all three reject non-admin callers (return 403 if `auth.user.app_metadata.role !== 'admin'`)
- [ ] Source citation and distractor generation use `claude-haiku-4-5-20251001` (NOT `claude-sonnet-4-6`) — work is mechanical, Haiku is cheaper and faster
- [ ] `fact-bank-import` accepts OpenTrivia DB JSON only (no CSV in this sub-phase). Inserts each row as a `pending` fact with `source_origin = 'opentdb_import'`, attaches the 3 imported wrong answers as `distractors` rows with `authored_by = 'imported'`, maps OpenTrivia DB difficulty (`easy` / `medium` / `hard`) to the integer 1-5 scale (easy=2, medium=3, hard=4), maps category strings to existing `categories.slug` values via a documented lookup table, returns counts of imported / skipped / failed
- [ ] `fact-bank-validate-source` accepts a `fact_id`, asks Haiku to propose 2 source URLs each with a quoted excerpt, mechanically verifies each URL is reachable (HTTP 200-299) AND the proposed excerpt substring appears on the fetched page, returns up to 2 source candidates with `verified_reachable` and `excerpt_match` flags. Does NOT insert into `fact_sources` directly — returns proposals for the admin UI to display
- [ ] `fact-bank-generate-distractors` accepts a `fact_id`, generates 3 distractors using Haiku, runs a second Haiku validation call asking "could any of these distractors arguably also be correct?" — if any score ≥3 reject and retry up to 2x, returns the validated 3 distractors. Does NOT insert into `distractors` directly — returns proposals for the admin UI to display
- [ ] `/admin/facts/import` page is functional: paste OpenTrivia DB JSON into a textarea, click Import, see counts of imported / skipped / failed, errors surfaced inline. JSON shape mismatches surface a clear error
- [ ] `/admin/sources/cite` page is functional: shows next pending fact lacking ≥2 confirmed sources, displays AI-proposed URLs with their excerpts and mechanical-check results, admin clicks Approve on each candidate to insert into `fact_sources` with `human_confirmed = true` and `verified_reachable` from the mechanical check
- [ ] `/admin/distractors/generate` page is functional: shows pending facts that have <3 active distractors, displays AI-proposed distractors with the validation pipeline's per-distractor ambiguity scores, admin clicks Approve to insert into `distractors` with `authored_by = 'ai-cached'`
- [ ] Approve and Reject buttons on `/admin/facts/[id]` are wired up: Approve attempts to flip `verification_status = 'verified'` (the trigger enforces source-count requirements), Reject flips to `verification_status = 'rejected'`. Both refresh the page state on success and surface the trigger error on failure
- [ ] OpenTrivia DB category-string → Trivolta `categories.slug` lookup table is defined in a single shared module, documented, and covers the 10 most common OpenTrivia DB categories that map cleanly to the 10 seeded Trivolta categories. Unknown categories fall back to `general`
- [ ] All 25 active Maestro tests still pass
- [ ] `TRIVOLTA_TRACKER.md` shows Phase 2.6.2 as ✅ after this task ships

## Constraints

- Do NOT modify the schema from Phase 2.6.1. Do NOT add columns, indexes, or triggers in this sub-phase. If a schema change feels needed, stop and flag to Mac Claude.
- Do NOT modify any of the 5 existing Edge Functions (`solo-question`, `generate-questions`, `create-lobby`, `join-lobby`, `daily-challenge`).
- Do NOT modify any non-admin mobile route. All mobile changes happen under `mobile/app/admin/`.
- Do NOT use Sonnet for Haiku tasks. Source citation and distractor generation MUST use `claude-haiku-4-5-20251001`. Verify the model string against the Anthropic SDK before deploying.
- Do NOT trust AI-proposed source URLs. Every URL must pass mechanical verification (URL reachable + excerpt substring match) before it becomes a candidate the admin UI displays. The AI is generating proposals, not citations.
- Do NOT auto-insert AI proposals into `fact_sources` or `distractors`. The admin UI must show the proposal and require an explicit Approve click. The only auto-action is the verification trigger flipping `verification_status` to `verified` once enough confirmed sources accumulate (already handled by Phase 2.6.1's trigger).
- Do NOT attempt CSV parsing. JSON only.
- Do NOT introduce a new third-party HTTP-fetch or HTML-parsing library. Use Deno's built-in `fetch` for the URL reachability check. For excerpt match, do a case-insensitive substring search on the fetched response body — no full HTML parsing required (the goal is "did the AI cite something real," not "parse the page semantically").
- Do NOT install any new mobile dependency. Use existing patterns (state hooks, the Supabase client, theme tokens) for the admin UI changes.
- Do NOT relax the constraint that all three new Edge Functions check `app_metadata.role === 'admin'`. Admin-only functions must reject non-admin callers regardless of valid auth.
- Do NOT bypass URL reachability. If `fetch` fails (network error, non-2xx, timeout), the source candidate is `verified_reachable: false` and the admin UI must show that — never silently mark it reachable.
- Do NOT block the import on slow/failed sourcing. Import lands facts in `pending` state and exits. Source citation runs as a separate admin-driven pass.
- Do NOT generate distractors for high-value facts (`is_high_value = true`) automatically. The architecture assigns AI-cached distractors only to long-tail facts. The distractor-generation page must filter to `is_high_value = false` AND distractor count < 3.
- Do NOT modify `mobile/lib/supabase.ts`, `mobile/lib/api.ts`, `mobile/lib/types.ts`, or `mobile/lib/theme.ts`.

## Steps

### Step 1 — OpenTrivia DB category lookup module

Create a single shared TypeScript module that maps OpenTrivia DB's category strings to Trivolta `categories.slug` values. Place it where both Edge Functions and admin UI can reach the source of truth — likely `supabase/functions/_shared/opentdb-category-map.ts` (Deno-resolvable for the Edge Function side; the admin UI can read its own copy if path resolution is awkward across mobile/Deno boundaries).

Map at minimum these OpenTrivia DB categories to their closest Trivolta slug:

- `General Knowledge` → `general`
- `Entertainment: Books` → `literature`
- `Entertainment: Film` → `film`
- `Entertainment: Music` → `music`
- `Entertainment: Television` → `film`
- `Entertainment: Video Games` → `pop-culture`
- `Entertainment: Board Games` → `pop-culture`
- `Science & Nature` → `science`
- `Science: Computers` → `science`
- `Science: Mathematics` → `science`
- `Mythology` → `history`
- `Sports` → `sports`
- `Geography` → `geography`
- `History` → `history`
- `Politics` → `general`
- `Art` → `art`
- `Celebrities` → `pop-culture`
- `Animals` → `science`
- `Vehicles` → `general`
- `Entertainment: Comics` → `pop-culture`
- `Science: Gadgets` → `science`
- `Entertainment: Japanese Anime & Manga` → `pop-culture`
- `Entertainment: Cartoon & Animations` → `film`

Unknown categories must fall back to `general`. Document this fallback at the top of the module.

Export the resolver as `mapOpenTdbCategory(s: string): string` returning a slug.

### Step 2 — `fact-bank-import` Edge Function

Create `supabase/functions/fact-bank-import/index.ts`. Follow the auth pattern from the existing functions exactly: CORS handling, `Authorization` header check, `auth.getUser()` against a user-scoped Supabase client built with the apikey-header-with-env-fallback pattern. After auth, additionally check `user.app_metadata?.role === 'admin'` — return 403 if not.

Use a service-role Supabase client (built with `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!`) for inserts, since RLS on `facts` and `distractors` requires admin to insert and the trigger needs to read across categories.

Accept POST body shape:

```
{
  "results": [
    {
      "category": "Entertainment: Film",
      "type": "multiple",
      "difficulty": "medium",
      "question": "Who directed Alien?",
      "correct_answer": "Ridley Scott",
      "incorrect_answers": ["James Cameron", "John Carpenter", "Stanley Kubrick"]
    },
    ...
  ]
}
```

This is OpenTrivia DB's native API response shape. Do not invent a wrapper.

For each row:
1. Decode HTML entities in `question`, `correct_answer`, and each `incorrect_answers` element. OpenTrivia DB ships them HTML-encoded (e.g. `&quot;`, `&#039;`). A small inline decoder is fine — no new dep.
2. Skip rows where `type !== 'multiple'` (Trivolta is multiple-choice only).
3. Map category via `mapOpenTdbCategory`. Look up the `categories.id` for that slug.
4. Map difficulty: `easy` → 2, `medium` → 3, `hard` → 4.
5. Use `fact_text` = the decoded question string. Use `correct_answer` = the decoded correct answer string.
6. Insert a `facts` row with `verification_status = 'pending'`, `is_high_value = false`, `source_origin = 'opentdb_import'`, `created_by = user.id`.
7. Insert 3 `distractors` rows for that fact with the decoded incorrect answers, `authored_by = 'imported'`, `is_active = true`. Do NOT mark them reviewed in this sub-phase — review can come from a future "approve imported distractors" pass.
8. On any per-row error (mapping fails, insert fails), capture the error and continue. Do not let one bad row abort the batch.

Return:

```
{
  "imported": <count>,
  "skipped_non_multiple": <count>,
  "skipped_unknown_category": <count>,
  "failed": <count>,
  "errors": [<array of {row_index, message}>]
}
```

`skipped_unknown_category` should never trigger if the `general` fallback is in place — but log it anyway for observability.

### Step 3 — `fact-bank-validate-source` Edge Function

Create `supabase/functions/fact-bank-validate-source/index.ts`. Auth pattern identical to Step 2 (user-scoped check + admin role check). Use a service-role client to read the fact details.

Accept POST body:

```
{
  "fact_id": "<uuid>"
}
```

Steps:
1. Look up the fact by id. 404 if not found.
2. Call Anthropic with `model: 'claude-haiku-4-5-20251001'`, asking for 2 source URLs that confirm the fact, each with a short verbatim excerpt (≤30 words) that should be findable on the page. Prompt must require the response as JSON with no markdown, shape:
   ```
   {
     "sources": [
       {
         "url": "https://...",
         "source_type": "wikipedia" | "imdb" | "official_record" | "reference_book" | "other",
         "excerpt": "..."
       },
       ...
     ]
   }
   ```
3. For each proposed source, mechanically verify:
   a. `fetch` the URL with a 10-second timeout, `redirect: 'follow'`. Treat any non-2xx as `verified_reachable: false`.
   b. If reachable, read the response body as text. Lowercase both the body and the proposed excerpt. Check that the excerpt is a substring of the body. Set `excerpt_match: boolean` accordingly. (Stripping HTML tags is not required — the text body of most reference pages contains the literal text. If the AI cited something only present in alt text or JSON-LD, that's a miss and the admin sees it as `excerpt_match: false`.)
   c. Capture the response status code. If the fetch threw (DNS error, timeout, etc.), `verified_reachable: false` and capture the error message.
4. Return the candidates with all flags. Do NOT insert into `fact_sources`. The admin UI does the insert on Approve.

Return shape:

```
{
  "fact_id": "<uuid>",
  "candidates": [
    {
      "url": "...",
      "source_type": "wikipedia",
      "excerpt": "...",
      "verified_reachable": true,
      "excerpt_match": true,
      "status_code": 200,
      "error": null
    },
    ...
  ]
}
```

If Anthropic returns malformed JSON, retry once. After two failures return `candidates: []` with an `error` field at the top level.

### Step 4 — `fact-bank-generate-distractors` Edge Function

Create `supabase/functions/fact-bank-generate-distractors/index.ts`. Auth and admin gate identical to Steps 2 and 3. Service-role client for the fact lookup.

Accept POST body:

```
{
  "fact_id": "<uuid>"
}
```

Steps:
1. Look up the fact. 404 if missing. Reject with 400 if `is_high_value = true` (long-tail only).
2. Generation call: Haiku, prompt asking for 3 plausible-but-wrong answers given the fact and correct answer. Require JSON, shape `{ "distractors": ["...", "...", "..."] }`. Reject if not exactly 3.
3. Validation call: a second Haiku request providing the fact, correct answer, and the 3 candidate distractors, asking "are any of these arguably also correct? rate ambiguity 1-5 per distractor." Require JSON, shape `{ "scores": [n, n, n] }`.
4. If any score ≥3, regenerate from step 2 (max 2 retries). After 2 retries, return `{ "ok": false, "reason": "validation_failed", "scores": [...] }` and let the admin handle.
5. On success, return:
   ```
   {
     "ok": true,
     "fact_id": "<uuid>",
     "distractors": ["...", "...", "..."],
     "scores": [n, n, n]
   }
   ```

Do NOT insert into `distractors`. Admin UI inserts on Approve.

### Step 5 — Wire up `/admin/facts/import`

Replace the Phase 2.6.1 placeholder with a functional page. Reuse existing theme tokens and component patterns from the other admin pages.

Required UI:
- Multiline textarea for pasting OpenTrivia DB JSON (the full `{ results: [...] }` blob)
- "Import" button that POSTs the parsed JSON to `fact-bank-import`
- Loading state while the request is in flight
- Result summary on success: counts of imported / skipped / failed, plus error list if any
- Error display for malformed JSON (parse client-side and show before sending)
- Link back to `/admin/facts/queue` after a successful import

Call the function via the existing `supabase.functions.invoke('fact-bank-import', { body: ... })` pattern that the rest of the app uses.

### Step 6 — Wire up `/admin/sources/cite`

Replace the placeholder. Required UI:

- On mount, fetch the next eligible fact: `verification_status = 'pending'` AND has fewer than 2 `human_confirmed = true` rows in `fact_sources`. Load 1 at a time. If none, show empty state.
- Display the fact text, correct answer, current confirmed source count.
- Button: "Get AI source proposals" — calls `fact-bank-validate-source` with the fact_id, shows a loading state.
- Renders the returned candidates as cards. Each card shows: URL (clickable to open in new tab), source type, excerpt, two pills (`verified_reachable: yes/no`, `excerpt_match: yes/no`), and an Approve button. Approve is disabled if `verified_reachable = false` OR `excerpt_match = false`.
- On Approve, insert a `fact_sources` row with `url`, `citation` = same as URL by default (admin can edit later), `excerpt`, `source_type`, `verified_reachable = true` (the mechanical check passed), `human_confirmed = true`, `verified_at = now()`, `added_by_ai = true`. After insert, refetch the fact's source count. If it just hit ≥2 (cross-referenced), show a toast/banner reminding the admin to flip the fact to `verified` via the fact detail page (or include an inline "Mark verified" button).
- "Skip this fact" button to advance the queue without acting on it.

### Step 7 — Wire up `/admin/distractors/generate`

Replace the placeholder. Required UI:

- On mount, fetch the next eligible fact: `is_high_value = false` AND fewer than 3 `is_active = true` rows in `distractors`. Load 1 at a time. If none, show empty state.
- Display the fact text and correct answer.
- Button: "Generate AI distractors" — calls `fact-bank-generate-distractors`.
- On success: render the 3 distractors with their per-distractor ambiguity scores. Approve-all and individual Reject-and-regenerate buttons.
- On Approve-all: insert all 3 as `distractors` rows with `authored_by = 'ai-cached'`, `is_active = true`, `quality_score` set from the AI's score (inverted to a 1-5 quality scale, e.g. ambiguity 1 → quality 5, ambiguity 5 → quality 1).
- On `ok: false` from the function: show the reason and scores; offer a "Try again" button.
- "Skip this fact" button.

### Step 8 — Wire up Approve / Reject on `/admin/facts/[id]`

The Phase 2.6.1 fact detail page has disabled Approve and Reject buttons. Enable them.

- Approve: update the fact's `verification_status` to `'verified'` and `verified_by = user.id`. The Phase 2.6.1 trigger enforces the source-count requirement; on failure (insufficient confirmed sources), surface the Postgres error message in a toast/banner. Do not pre-check the count client-side — let the trigger be the gate.
- Reject: update `verification_status = 'rejected'`. Always succeeds.
- After either action, refresh the fact detail. If verified, show a success state; if rejected, navigate back to the queue.
- Both buttons are admin-only (the route is already gated by the admin layout — no extra check needed).

### Step 9 — Run the Maestro suite

Schema is unchanged from Phase 2.6.1, but new Edge Functions are deployed and admin pages now do real work. Confirm no regression on the regular user flows.

```
cd /Users/mizzy/Developer/Trivolta
supabase db reset
```

Separate terminal:
```
supabase functions serve --no-verify-jwt --env-file supabase/.env.local
```

Original terminal:
```
cd mobile && ./run_tests.sh
```

All 25 must pass. If any fail, the new Edge Functions or admin UI changes broke an existing flow — fix before proceeding. Re-grant admin to `trivoltaapp@outlook.com` after the reset.

### Step 10 — Manual verification of the seeding pipeline

This is a smoke test of the full pipeline. Mike will run it post-merge but Claude Code can validate end-to-end during the build:

1. Sign into Expo Web admin as `trivoltaapp@outlook.com`
2. Pull a small OpenTrivia DB sample by hitting `https://opentdb.com/api.php?amount=10&type=multiple` in a browser, copy the response JSON
3. Open `/admin/facts/import`, paste, click Import. Confirm 10 facts imported (or whatever count the API returned), 0 failed
4. Navigate to `/admin/facts/queue`. Confirm 10 pending facts visible with their distractors
5. Open one fact in `/admin/facts/[id]`. Confirm Approve fails with the trigger error (no confirmed sources yet)
6. Navigate to `/admin/sources/cite`. Confirm the next pending fact loads. Click "Get AI source proposals". Confirm 2 candidates render with their mechanical-check flags
7. Approve at least one candidate where both flags are green
8. Repeat to get a second confirmed source for the same fact
9. Return to the fact detail page. Click Approve. Confirm the fact flips to `verified`
10. Navigate to `/admin/coverage`. Confirm the count for that fact's category went up by 1

If any step fails, the pipeline isn't ready. Fix before reporting done.

### Step 11 — Update tracker

Edit `TRIVOLTA_TRACKER.md`:
- Flip Phase 2.6.2 from ⬜ to ✅
- Under "INSTRUCTIONS Files Written", flip `INSTRUCTIONS_PHASE_2.6.2_IMPORT_AND_SOURCING.md` from ⬜ to ✅

### Step 12 — Commit

```
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > /tmp/trivolta_diff.txt
```

Stop and hand to Mac Claude for review. After approval, commit with message: `feat: Phase 2.6.2 — fact import + AI source citation + distractor generation (Layer 1 wired)`.

Commit list:
- `INSTRUCTIONS_PHASE_2.6.2_IMPORT_AND_SOURCING.md` (this file)
- `TRIVOLTA_TRACKER.md`
- `supabase/functions/_shared/opentdb-category-map.ts` (or wherever the lookup module lands)
- `supabase/functions/fact-bank-import/index.ts`
- `supabase/functions/fact-bank-validate-source/index.ts`
- `supabase/functions/fact-bank-generate-distractors/index.ts`
- `mobile/app/admin/facts/import.tsx`
- `mobile/app/admin/facts/[id].tsx`
- `mobile/app/admin/sources/cite.tsx`
- `mobile/app/admin/distractors/generate.tsx`
- Any small shared utility files created (e.g. a category-map reader on the mobile side, if the Deno path doesn't resolve)

Verify nothing secret is staged: `git status --porcelain | grep -E '\.env\.local|signing_keys\.json'` returns no output.

## Verification

Every command below must succeed before reporting done.

```bash
# 1. Three new Edge Functions exist
ls /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-import/index.ts
ls /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-validate-source/index.ts
ls /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-generate-distractors/index.ts

# 2. Functions use Haiku (not Sonnet) for source citation and distractor generation
grep -l "claude-haiku-4-5-20251001" /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-validate-source/index.ts
grep -l "claude-haiku-4-5-20251001" /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-generate-distractors/index.ts

# 3. fact-bank-import does NOT call Anthropic
grep -L "anthropic" /Users/mizzy/Developer/Trivolta/supabase/functions/fact-bank-import/index.ts || echo "Import function correctly does not call Anthropic"

# 4. All three new functions check admin role
for fn in fact-bank-import fact-bank-validate-source fact-bank-generate-distractors; do
  grep -c "app_metadata" /Users/mizzy/Developer/Trivolta/supabase/functions/$fn/index.ts
done
# expect: at least 1 for each function

# 5. apikey-header pattern used in all three
for fn in fact-bank-import fact-bank-validate-source fact-bank-generate-distractors; do
  grep -c "req.headers.get('apikey')" /Users/mizzy/Developer/Trivolta/supabase/functions/$fn/index.ts
done
# expect: at least 1 for each function

# 6. OpenTrivia category map exists with at least the 10 categories listed in Step 1
grep -c "general\|literature\|film\|music\|science\|history\|sports\|geography\|art\|pop-culture" \
  /Users/mizzy/Developer/Trivolta/supabase/functions/_shared/opentdb-category-map.ts
# expect: 10 (or more, if duplicated by mappings)

# 7. Admin UI no longer shows "Coming in Phase 2.6.2" placeholders on import / cite / generate routes
for f in facts/import sources/cite distractors/generate; do
  grep -c "Coming in Phase 2.6.2" /Users/mizzy/Developer/Trivolta/mobile/app/admin/$f.tsx
done
# expect: 0 for each

# 8. Maestro suite green
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh 2>&1 | tail -10
# expect: 25 passed, 0 failed

# 9. Manual smoke test (Step 10) completed end-to-end with at least one fact reaching 'verified'
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from public.facts where verification_status = 'verified' and source_origin = 'opentdb_import';
"
# expect: at least 1 (post Step 10)

# 10. Tracker updated
grep "Phase 2.6.2" /Users/mizzy/Developer/Trivolta/TRIVOLTA_TRACKER.md | grep "✅"
# expect: a match

# 11. No secrets staged
cd /Users/mizzy/Developer/Trivolta
git status --porcelain | grep -E '\.env\.local|signing_keys\.json'
# expect: no output
```

If any check fails, do not commit. Report to Mac Claude with the failing command output.
