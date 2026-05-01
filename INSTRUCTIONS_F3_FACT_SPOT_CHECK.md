# INSTRUCTIONS — F3: Manual fact spot-check (admin tool + tracking)

## Task

Before any external tester sees the app, Mike needs to manually verify a sample of imported facts to catch obvious correctness errors that slipped through the Trivia API import. F3 ships the **tooling** to make that practical: a `/admin/facts/spot-check` screen that pulls random unreviewed facts one at a time, displays the question + correct answer + active distractors, and offers two actions per fact: *Looks correct* or *Report incorrect* (with optional note). Each decision writes a `spot_check_results` row, so we have a defensible audit trail of which facts were checked, by whom, when, and what was reported.

Also create the `spot_check_results` table and an Edge Function `submit-spot-check` that performs the write — same single-insert-path posture as F2's feedback channel.

The actual 50-fact spot-check session is **Mike's manual work after F3 ships** — not part of this INSTRUCTIONS file. Claude Code is shipping the tool, not running the review.

This is **local-only work**. Production deploy lands with the Tranche 8 production-Supabase work. The migration must apply cleanly later.

The reason for shipping this as a tool rather than a SQL runbook: stratified random sampling across all 10 categories, no-repeat tracking, and a clean record of "Mike spot-checked these 50 facts on this date" all become trivial. A SQL runbook would lose all three.

## Verifiable objective

### Schema
- [ ] New migration file `supabase/migrations/20240109000000_spot_check_results.sql` exists.
- [ ] Migration creates table `public.spot_check_results` with columns:
  - `id uuid primary key default gen_random_uuid()`
  - `fact_id uuid not null references public.facts(id) on delete cascade`
  - `reviewer_id uuid references auth.users(id) on delete set null`
  - `verdict text not null check (verdict in ('correct', 'incorrect'))`
  - `note text check (note is null or (length(trim(note)) between 1 and 2000))`
  - `category_slug text not null` (denormalized at write time so the audit log is independent of category renames)
  - `reviewed_at timestamptz default now() not null`
- [ ] Unique constraint `unique (fact_id, reviewer_id)` so the same admin can't double-check the same fact (no-repeat tracking).
- [ ] Index `idx_spot_check_results_reviewed_at` on `reviewed_at desc`.
- [ ] Index `idx_spot_check_results_verdict` on `verdict`.
- [ ] RLS enabled. Policies:
  - `spot_check_admin_read` — admins (`public.is_admin()`) SELECT all rows.
  - `spot_check_reviewer_read_own` — reviewers SELECT their own (`auth.uid() = reviewer_id`).
  - **No INSERT/UPDATE/DELETE policies.** Writes go through `submit-spot-check` Edge Function via service-role.
- [ ] When `verdict = 'incorrect'`, the Edge Function ALSO inserts a `fact_reports` row (reason = `'incorrect'`, detail = the note if present, reported_by = reviewer_id, status = `'open'`). This is the F3 → existing-tech-debt-recovery handoff: every "Report incorrect" verdict shows up in the existing `/admin/reports` queue automatically, no separate flow.

### Edge Function
- [ ] New Edge Function at `supabase/functions/submit-spot-check/index.ts`.
- [ ] Standard auth preamble (CORS, Authorization header check → 401, user-scoped client with apikey-header-with-env-fallback, `auth.getUser()` → 401, `is_admin` claim check → 403). Spot-checks are an admin-only action.
- [ ] Request body shape:
  ```json
  {
    "fact_id": "uuid (required)",
    "verdict": "correct | incorrect (required)",
    "note": "string (optional, 1..2000 chars trimmed)"
  }
  ```
- [ ] Validates each field. On any validation failure: 400 `{ ok: false, reason: 'validation_failed', error: '<field>' }`.
- [ ] Loads the fact with its category slug (join `facts` → `categories`). If fact not found: 404 `{ ok: false, reason: 'fact_not_found' }`.
- [ ] Inserts `spot_check_results` row using service-role client. `reviewer_id = user.id`. On unique-violation (already reviewed by this admin): 409 `{ ok: false, reason: 'already_reviewed' }`.
- [ ] If `verdict === 'incorrect'`: also inserts a `fact_reports` row. If that secondary insert fails, do NOT roll back the `spot_check_results` insert — return 200 with `{ ok: true, id, fact_report_id: null, fact_report_error: '<msg>' }`. The audit row is the source of truth.
- [ ] On full success: 200 `{ ok: true, id, fact_report_id }` (`fact_report_id` is null when verdict is `'correct'`).
- [ ] Function deploys with `--no-verify-jwt`.

### Mobile — admin spot-check screen
- [ ] New screen `mobile/app/admin/facts/spot-check.tsx`.
- [ ] Wired into `mobile/app/admin/_layout.tsx` Stack.Screen list (`name="facts/spot-check"`, `title="Spot Check"`) and into the `NAV_LINKS` array on `mobile/app/admin/index.tsx` (label `"Spot check"`, description `"Review random facts for correctness"`).
- [ ] On mount: queries one random fact via the new RPC `get_next_spot_check_fact()` (see RPC section below). Falls back to "all 50 done" empty state if RPC returns null.
- [ ] Renders, in order:
  - **Progress chip** — "Reviewed N of 50 today" where N = count of `spot_check_results` rows by current admin in the last 24h. Updates after each verdict.
  - **Category badge** — the category slug + display name.
  - **Fact text** (large, readable — same typography weight as the QuestionScreen question).
  - **Correct answer** — prefixed `Correct: ` in green (theme `colors.success`).
  - **Active distractors** — bulleted list of all `is_active = true` distractor texts.
  - **Buttons:** `Looks correct` (green) and `Report incorrect` (red), full width, side by side.
  - When `Report incorrect` tapped: an inline `TextInput` (multiline, 2000 char max) appears with placeholder `"What's wrong? (optional)"`, plus `Submit report` and `Cancel` buttons.
  - **Skip** link below buttons — does NOT write a row, just fetches the next fact.
- [ ] testIDs: `spot-check-progress`, `spot-check-fact-text`, `spot-check-correct`, `spot-check-distractor-<index>`, `spot-check-correct-btn`, `spot-check-incorrect-btn`, `spot-check-note-input`, `spot-check-submit-incorrect`, `spot-check-cancel-incorrect`, `spot-check-skip`, `spot-check-empty-state`.
- [ ] After submit (correct or incorrect): show a 1.5s inline confirmation banner ("Recorded as correct" or "Reported"), then auto-fetch the next fact.
- [ ] On submit error: keep the current fact loaded, show inline error "Couldn't save. Try again." Errors do NOT advance the queue.
- [ ] Style with theme tokens only. No inline colors. Match the visual density of `mobile/app/admin/facts/needs-review.tsx`.
- [ ] No pagination, no search, no filters. F3 is a focused linear queue.

### Postgres RPC for fact selection
- [ ] In the same migration `20240109000000_spot_check_results.sql`, add a SECURITY DEFINER function `public.get_next_spot_check_fact()`:
  - Returns one row: `(id uuid, fact_text text, correct_answer text, difficulty int, category_slug text, category_display_name text, distractors text[])`.
  - Selects a random fact where:
    - `verification_status` IN (`'pending'`, `'verified'`) (skip `rejected` and `flagged`)
    - The fact is NOT already in `spot_check_results` for the calling user (`auth.uid()`)
    - The fact has at least 3 active distractors (so the screen always has a complete picture)
  - **Stratification:** weight selection so categories with fewer existing spot-checks come up more often. Implementation: pick the category slug with the smallest count of `spot_check_results` for the current user (ties broken randomly), then pick a random qualifying fact from that category.
  - Returns no rows if the user has spot-checked all eligible facts.
  - GRANT EXECUTE to authenticated. The function checks `is_admin()` internally and raises if not admin.
  - The function reads `auth.uid()` directly; the client never passes user id.
- [ ] The RPC is invoked from the screen via `supabase.rpc('get_next_spot_check_fact')`.

### Mobile — API wiring
- [ ] New function `submitSpotCheck({ fact_id, verdict, note? })` in `mobile/lib/api.ts`. Uses the existing `callFunction` helper. Returns the response JSON. Throws on non-200 except 409 (`already_reviewed`) which the screen handles by skipping to the next fact silently.

### Tests
- [ ] All 27 existing Maestro tests still pass.
- [ ] One new Maestro flow `mobile/maestro/test_28_spot_check.yaml`:
  - Signs in as `testuser_maestro_02`.
  - Grants admin via the existing helper script (or skip-if-already-admin — match the pattern used by other admin tests if any exist; if none, use a `runScript` step that runs the existing `docker exec ... psql` admin grant against the test user). If no admin grant helper exists, this test calls a new minimal helper script `mobile/maestro/scripts/grant_admin_test_user_02.js` which uses the Supabase admin API to set `app_metadata.role = 'admin'`. Pattern this on `ensure_test_user_02.js`.
  - Navigates to `/admin/facts/spot-check`.
  - Asserts `spot-check-fact-text` visible.
  - Taps `spot-check-correct-btn`.
  - Asserts the next fact loads (text changes — use `extendedWaitUntil` with `notVisible` against the previous fact-text via stored variable, OR simply assert the progress chip increments to "Reviewed 1 of 50 today"). Pick whichever is reliable in Maestro 2.5.0.
  - Taps `spot-check-incorrect-btn`.
  - Types into `spot-check-note-input`: "Maestro test report".
  - Taps `spot-check-submit-incorrect`.
  - Asserts progress chip says "Reviewed 2 of 50 today".
- [ ] If granting admin to test_02 has knock-on effects on tests 03–27 (i.e. the user persists between tests), instead create a separate test user (`testuser_maestro_admin@trivolta-test.com`) for test_28 only, with its own ensure script. Pick whichever keeps the existing 27 tests green.

### Tracker
- [ ] `TRIVOLTA_TRACKER.md`:
  - Mark F3 ✅ in Phase 2.9 Tranche 1 with one-line outcome (table + Edge Function + admin screen + RPC + Maestro test_28).
  - Add `✅ test_28 — admin fact spot-check (correct + incorrect verdicts)` to the active Maestro list. Renumber the deferred backlog entries (test_28 → test_29, etc.) so there's no collision.
  - Mark `✅ INSTRUCTIONS_F3_FACT_SPOT_CHECK.md` in the INSTRUCTIONS Files Written section.
- [ ] Add a new sub-section under Tranche 1 titled `### F3 — Mike's spot-check session (manual work, post-merge)` listing the four manual steps:
  1. Open `/admin/facts/spot-check` after F3 merges.
  2. Review until progress chip reads "Reviewed 50 of 50 today" — usually 1–2 sittings.
  3. After the session, run a SQL query to summarize: total reviewed, count by category, count incorrect, and confirm the matching `fact_reports` rows exist. The exact SQL is included as a code block.
  4. If incorrect rate >10%, pause and re-evaluate beta-readiness; if ≤10%, proceed to Tranche 2 work.

### TypeScript
- [ ] `cd mobile && npx tsc --noEmit` exits 0.

### Verification commands (Claude Code runs all of these)
- [ ] `supabase db reset` succeeds with the new migration applied; the new RPC is callable.
- [ ] `supabase functions serve --no-verify-jwt --env-file supabase/.env.local` lists `submit-spot-check`.
- [ ] `curl` smoke tests against `submit-spot-check`:
  - No Authorization header → 401.
  - Valid non-admin JWT → 403.
  - Valid admin JWT + valid `correct` body → 200 with `id`, `fact_report_id: null`. No `fact_reports` row inserted.
  - Valid admin JWT + valid `incorrect` body with note → 200 with `id`, non-null `fact_report_id`. A `fact_reports` row exists with reason `'incorrect'`, detail = the note, status `'open'`.
  - Same admin re-submitting same fact → 409 `already_reviewed`.
  - Spoofed `reviewer_id` in body → ignored; the inserted row's `reviewer_id` matches the JWT.
  - Invalid `verdict` (`"maybe"`) → 400 `validation_failed`.
- [ ] `supabase.rpc('get_next_spot_check_fact')` from a non-admin user raises (or returns no rows with an admin-only error). From an admin, returns one fact with `distractors` array length ≥ 3.
- [ ] `cd mobile && ./run_tests.sh` reports 28/28 passing.

## Constraints

- **Do not** allow client-side inserts to `spot_check_results` or `fact_reports` from the spot-check flow. The Edge Function is the single insert path.
- **Do not** trust `reviewer_id` from the client. It comes from the verified JWT.
- **Do not** add an `UPDATE` or `DELETE` policy on `spot_check_results`. Append-only.
- **Do not** allow the same admin to double-review the same fact (the unique constraint enforces this; the screen also avoids it via the RPC's exclusion clause).
- **Do not** show facts to spot-check that have fewer than 3 active distractors. They render incompletely and skew the data.
- **Do not** modify any existing Edge Function, RLS policy, or table.
- **Do not** add new third-party dependencies. Vanilla React Native + existing libs only.
- **Do not** add the spot-check screen to non-admin navigation. It lives only under `/admin/*`.
- **Do not** ship a "Skip" action that writes a row. Skip is purely client-side — the next RPC call may return the same fact or a different one; that's fine.
- **Do not** modify any existing Maestro YAML files except the tracker reference; new behavior goes in `test_28_spot_check.yaml`.
- **Do not** ship a `bulk approve` or `bulk reject` button. F3 is one-fact-at-a-time by design.
- **Do not** alter `INSTRUCTIONS_F2_FEEDBACK_CHANNEL.md`, `WORKFLOW.md`, `TRIVOLTA_ARCHITECTURE.md`, `TRIVOLTA_DIFFERENTIATION.md`, or `TRIVOLTA_HALLUCINATION_STRATEGY.md`. Mac Claude updates the architecture doc later if needed.
- **Do not** commit until Mac Claude reviews the diff against the four criteria.

## Steps

### 1. Read existing files (no edits)
1. `supabase/migrations/20240106000000_fact_bank_schema.sql` — fact bank schema, `is_admin()` helper, RLS patterns, `fact_reports` columns.
2. `supabase/migrations/20240108000000_feedback_reports.sql` — F2's migration, structurally similar to what F3 needs.
3. `supabase/functions/submit-feedback/index.ts` — F2's Edge Function, the auth + service-role + validate pattern to mirror.
4. `mobile/app/admin/_layout.tsx`, `mobile/app/admin/index.tsx` — nav-entry pattern.
5. `mobile/app/admin/facts/needs-review.tsx` — closest existing admin screen by purpose (review queue). Match its structural style.
6. `mobile/app/admin/feedback/index.tsx` — F2's admin triage screen, also a good style reference.
7. `mobile/components/FeedbackFAB.tsx` — for the inline-confirmation banner pattern (`toast` style).
8. `mobile/lib/api.ts` — `callFunction` helper.
9. `mobile/maestro/test_27_feedback_submit.yaml` — Maestro flow style.
10. `mobile/maestro/scripts/ensure_test_user_02.js` — pattern for a new admin-grant helper script if needed.

### 2. Create the migration
Create `supabase/migrations/20240109000000_spot_check_results.sql` with the table, indexes, RLS enable, two SELECT policies, and the `get_next_spot_check_fact()` SECURITY DEFINER function. The RPC's `is_admin()` check uses `raise exception 'admin only'` so the call surface is honest.

### 3. Create the Edge Function
Create `supabase/functions/submit-spot-check/index.ts`. Mirror `submit-feedback` for structure. Add the `is_admin` claim check after `auth.getUser()`. Implement the dual-insert behavior for `verdict='incorrect'`. The unique-violation handler returns 409 `already_reviewed` rather than 500.

### 4. Create the admin screen
Create `mobile/app/admin/facts/spot-check.tsx`. Pattern on `needs-review.tsx` for layout / styles. Use `supabase.rpc('get_next_spot_check_fact')` for fact loading. Use a small in-component state machine: `loading` → `idle` → `submitting` → (success → load next | error → idle, error visible).

The progress chip query: `supabase.from('spot_check_results').select('id', { count: 'exact', head: true }).eq('reviewer_id', user.id).gte('reviewed_at', <24h ago ISO>)`. Refetch this count after every submit.

### 5. Wire admin nav
- Add Stack.Screen entry to `mobile/app/admin/_layout.tsx`.
- Add NAV_LINKS entry to `mobile/app/admin/index.tsx`.

### 6. API wrapper
Add `submitSpotCheck` to `mobile/lib/api.ts`.

### 7. Maestro
Create `mobile/maestro/test_28_spot_check.yaml`. If a fresh admin test user is needed (recommended to keep the existing 27 tests untouched), also create `mobile/maestro/scripts/ensure_admin_test_user.js` patterned on `ensure_test_user_02.js`. The admin user's email is `testuser_maestro_admin@trivolta-test.com`, password matches the existing test password convention.

### 8. Tracker update
Edit `TRIVOLTA_TRACKER.md` per the verifiable-objective list above. Be careful with the deferred-backlog renumber — there are already 4 deferred tests (test_28–31). After F3 lands, the active suite gets test_28 and the deferred ones become test_29–32.

### 9. Verification (Claude Code runs all of these)
1. `cd mobile && npx tsc --noEmit` → exit 0.
2. `supabase db reset` → succeeds, all 9 migrations apply.
3. `supabase functions serve --no-verify-jwt --env-file supabase/.env.local` → starts cleanly, lists `submit-spot-check`.
4. Run all curl smoke tests listed in the verifiable-objective section. Capture each result.
5. Test the RPC directly: `psql` (or `docker exec ... psql`) calling `select * from public.get_next_spot_check_fact()` after setting `auth.uid()` via a JWT context. Or just call it from the running Edge Functions via a minimal scratch curl invocation. Confirm a row comes back, distractors array length ≥ 3.
6. `cd mobile && ./run_tests.sh` → 28/28 passing.
7. `git diff HEAD > ~/trivolta_diff.txt` and stop. Mac Claude reviews against the four criteria before commit.

## Verification

Final report Claude Code returns:
- TypeScript pass/fail.
- `supabase db reset` outcome.
- All seven curl smoke results.
- RPC call result (admin: 1 row with ≥3 distractors; non-admin: error).
- Maestro count (28/28 expected).
- Confirmation that an `incorrect` verdict produced a corresponding `fact_reports` row visible at `/admin/reports`.
- Path to `~/trivolta_diff.txt`.

After Mac Claude approves the diff and the commit lands, F3 the *tool* is done. The 50-fact spot-check **session itself** is Mike's manual work, tracked in the new `### F3 — Mike's spot-check session` sub-section under Tranche 1.

---

Read INSTRUCTIONS_F3_FACT_SPOT_CHECK.md and execute all steps exactly as written.
