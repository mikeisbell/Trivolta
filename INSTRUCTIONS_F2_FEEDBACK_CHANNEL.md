# INSTRUCTIONS — F2: In-app feedback channel

## Task

Ship a persistent in-app feedback channel so every screen Trivolta builds from this point forward gets free user feedback capture. The channel has three pieces:

1. **`feedback_reports` table** — captures who, where, what state the app was in, and what the user typed. Append-only from clients; read by admins only.
2. **`submit-feedback` Edge Function** — auth-checked, validated insert. The mobile app does NOT write to `feedback_reports` directly — the Edge Function is the single insert path so future server-side validation, throttling, or PII scrubbing can be added without touching the client.
3. **Persistent in-app feedback button** — a small floating action button anchored bottom-right on every authenticated screen (tabs + solo question + lobby + custom-category + admin). Tap opens a modal: free-text textarea, optional "include screen state" toggle (default on), Cancel / Send buttons. On send, posts to `submit-feedback`. On success, modal closes and shows a toast/banner "Thanks — feedback received." On failure, the modal stays open with an inline error.

This is **infrastructure work**, not a feature surface. F2 enables every later tranche to absorb feedback without re-shipping a button each time. Match the WORKFLOW.md two-Claude split: this INSTRUCTIONS file is the spec, Claude Code implements it.

This is **local-only work** for now (same posture as F1, dev-reset, seed-trivia-api). Production deploy happens when the Tranche 8 production-Supabase work lands. The migration must apply cleanly on production later — no localhost-only branches in SQL.

## Verifiable objective

### Schema
- [ ] New migration file `supabase/migrations/20240108000000_feedback_reports.sql` exists.
- [ ] Migration creates table `public.feedback_reports` with columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid references auth.users(id) on delete set null` (nullable so a deleted user's feedback is preserved for triage)
  - `screen text not null` (e.g. `home`, `question`, `lobby/waiting`, `admin/facts`)
  - `route_path text` (the actual expo-router path captured at submit time, nullable)
  - `app_version text` (from `expo-constants` `Constants.expoConfig.version`, nullable)
  - `platform text not null check (platform in ('ios','android','web'))`
  - `state_snapshot jsonb` (nullable — null when user opted out of including state)
  - `body text not null check (length(trim(body)) between 1 and 4000)`
  - `created_at timestamptz default now() not null`
- [ ] Index `idx_feedback_reports_created_at` on `created_at desc`.
- [ ] Index `idx_feedback_reports_screen` on `screen`.
- [ ] RLS enabled. Policies:
  - `feedback_reports_admin_read` — admins (via existing `public.is_admin()`) can SELECT all rows.
  - `feedback_reports_user_read_own` — users can SELECT their own rows (`auth.uid() = user_id`).
  - **No insert policy is created** — inserts go through the Edge Function using the service-role client, which bypasses RLS. This is the single insert path.
  - No update policy. No delete policy. Append-only table.
- [ ] Migration is idempotent in the sense Supabase migrations are: re-running `supabase db reset` applies it cleanly with no errors on a fresh DB.

### Edge Function
- [ ] New Edge Function at `supabase/functions/submit-feedback/index.ts` exists.
- [ ] Function follows the standard auth preamble used by every other Trivolta Edge Function (CORS preflight, `Authorization` header check returning 401 on missing/invalid, user-scoped client built with the apikey-header-with-env-fallback pattern documented in CLAUDE.md, `auth.getUser()` returning 401 on failure).
- [ ] Request body shape:
  ```json
  {
    "screen": "string (required, 1..120 chars)",
    "route_path": "string (optional, 0..500 chars)",
    "platform": "ios | android | web (required)",
    "app_version": "string (optional, 0..40 chars)",
    "state_snapshot": "object (optional, must JSON-stringify to <= 16384 chars)",
    "body": "string (required, trimmed length 1..4000)"
  }
  ```
- [ ] Validates each field. On any validation failure: 400 with `{ ok: false, reason: 'validation_failed', error: '<which field>' }`.
- [ ] On valid input: inserts one row using a service-role client, with `user_id = user.id` from the verified JWT (the client cannot spoof user_id — the field is server-set).
- [ ] On insert success: 200 with `{ ok: true, id: '<row id>' }`.
- [ ] On insert failure: 500 with `{ ok: false, reason: 'insert_failed', error: <message> }`.
- [ ] Function is registered to deploy with `--no-verify-jwt` (matches Trivolta's existing pattern).

### Mobile — feedback button + modal
- [ ] New component `mobile/components/FeedbackFAB.tsx`. Default-export React component with no required props. Renders a small circular floating button anchored bottom-right with safe-area-aware insets. Uses theme tokens from `mobile/lib/theme.ts` (no inline colors).
- [ ] FAB has `testID="feedback-fab"`.
- [ ] FAB hidden when `useAuth().session` is null. Always hidden on `/auth`.
- [ ] FAB hidden during the Maestro environment when `process.env.EXPO_PUBLIC_HIDE_FEEDBACK_FAB === '1'`. (This env-var gate exists so the FAB doesn't sit on top of testIDs Maestro is trying to tap. Set the var in `mobile/.env.local` for now with a comment explaining its purpose; Maestro's run_tests.sh sets it via env passthrough.)
- [ ] Tapping FAB opens a modal. Modal contents:
  - Title "Send feedback"
  - Multiline `TextInput` with `testID="feedback-body-input"`, `placeholder="What's on your mind?"`, max 4000 chars.
  - `Switch` with `testID="feedback-include-state"`, label "Include screen state", default ON.
  - Cancel button `testID="feedback-cancel"` — closes the modal, discards input.
  - Send button `testID="feedback-send"` — disabled while body is empty or while submitting.
- [ ] Modal has an inline error region with `testID="feedback-error"` (rendered only when an error is present).
- [ ] Modal also renders a tiny helper line under the textarea: "Visible to the Trivolta team only." No legal copy beyond that for F2 — privacy policy work is a separate Tranche 8 item.
- [ ] On Send: build payload using:
  - `screen` = a stable identifier derived from the current route — see Steps below for the derivation rule.
  - `route_path` = `usePathname()` from expo-router.
  - `platform` = `Platform.OS` mapped to `'ios' | 'android' | 'web'` (anything else → `'web'`).
  - `app_version` = `Constants.expoConfig?.version ?? null`.
  - `state_snapshot` = if "Include screen state" is on, an object containing `{ user_id, route_params, timestamp_iso, locale, last_route_visited_before_open }`. If off, omitted entirely (do not send `state_snapshot: null` — omit the field).
  - `body` = trimmed textarea content.
- [ ] On 200: close modal, show a top-anchored toast/banner "Thanks — feedback received." for 2.5s. The toast is a simple in-app component, not a native Toast or third-party lib. `testID="feedback-toast"`.
- [ ] On non-200: keep modal open, show inline error "Couldn't send. Try again." (no error details surfaced to the user — keep it generic).
- [ ] FAB and modal mount via a single `<FeedbackProvider>` wrapper inserted in `mobile/app/_layout.tsx` immediately inside the `AuthProvider`. This way it appears on every authenticated screen (tabs + question + results + custom-category + lobby + admin) without per-screen wiring.
- [ ] `FeedbackProvider` exports a context with `openFeedback(seedBody?: string)` so future screens can also trigger the modal programmatically (e.g. an "issue with this question?" link on QuestionScreen later). Do not wire any programmatic triggers in F2 — just expose the context API.

### Mobile — API wiring
- [ ] New function `submitFeedback(payload)` in `mobile/lib/api.ts` that calls `submit-feedback` via the existing `callFunction` helper. Returns `{ ok: true, id }` on success, throws on non-200.
- [ ] No new third-party deps. No `expo-haptics`, no toast libraries, no form libraries. Vanilla React Native only.

### Admin — minimal triage screen
- [ ] New screen `mobile/app/admin/feedback/index.tsx`. Lists feedback newest-first, paged by 50. Each row shows: relative timestamp, screen, body (truncated to 200 chars with "…" if longer), and a small "expand" affordance that toggles full body + state_snapshot JSON inline.
- [ ] Add nav entry to `mobile/app/admin/_layout.tsx` Stack.Screen list and the `NAV_LINKS` array on `mobile/app/admin/index.tsx`. Label "Feedback", description "User-submitted feedback from in-app FAB".
- [ ] No assignment, no status, no resolution UI in F2. Triage is read-only. Future tranches can extend.

### TypeScript
- [ ] `cd mobile && npx tsc --noEmit` exits 0.

### Tests
- [ ] All 25 existing Maestro tests still pass (the env-var gate keeps the FAB out of their way).
- [ ] One new Maestro flow `mobile/maestro/test_27_feedback_submit.yaml`:
  - Signs in as `testuser_maestro_02` via existing helper script.
  - Runs with `EXPO_PUBLIC_HIDE_FEEDBACK_FAB` unset/0 so the FAB is visible (see Steps for the exact mechanism).
  - Taps `feedback-fab` from HomeScreen.
  - Types "Maestro test feedback {{timestamp}}" into `feedback-body-input`.
  - Taps `feedback-send`.
  - Asserts `feedback-toast` appears within 5s.
  - Asserts the modal closed (the body input is no longer visible).
- [ ] Update `TRIVOLTA_TRACKER.md` Maestro section to add `✅ test_27 — feedback submit (FAB → modal → submit → toast)`. Move test_27 OUT of the "Test Backlog (Tier 3)" section if present, otherwise just add it.
- [ ] Add the FAB-hiding env-var note to `mobile/.env.example` and to `mobile/run_tests.sh` so future Maestro runs hide the FAB by default and `test_27` re-enables it for itself only.

### Verification commands (Mike runs after Claude Code reports done)
- [ ] `supabase db reset` succeeds with the new migration applied.
- [ ] `supabase functions serve --no-verify-jwt --env-file supabase/.env.local` serves `submit-feedback` alongside existing functions.
- [ ] Run mobile (`npx expo start`, press `i`), sign in, tap the FAB, send "hello world feedback". Toast appears. Open `/admin/feedback`, confirm the row is there.
- [ ] Confirm a non-admin user cannot see other users' feedback (sign in as a second user, hit `/admin/feedback` — they're already redirected away by `admin/_layout.tsx`; spot-check that the RLS policy blocks reading other users' rows via direct query).
- [ ] `cd mobile && ./run_tests.sh` reports 26/26 passing.

## Constraints

- **Do not** allow inserts directly from the mobile client. Inserts go through the Edge Function. This is the single insert path.
- **Do not** add an INSERT policy to `feedback_reports`. The service-role client bypasses RLS; that's the intended write path.
- **Do not** spoof or trust `user_id` from the client. The Edge Function reads it from the verified JWT.
- **Do not** add new dependencies (no `react-native-toast-message`, `formik`, `react-hook-form`, etc).
- **Do not** add unnecessary form state libraries. Vanilla `useState` only.
- **Do not** show the FAB on the auth screen or while `loading`. It's only for authenticated states.
- **Do not** auto-include any sensitive auth tokens, supabase keys, environment values, or full Redux/Zustand stores in `state_snapshot`. Only the explicit allowed fields listed above.
- **Do not** truncate `body` server-side without an error — the 4000-char cap is enforced via DB CHECK and Edge Function validation. Client `TextInput` should also enforce `maxLength={4000}`.
- **Do not** modify `solo-question`, `generate-questions`, `create-lobby`, `join-lobby`, or `daily-challenge`. F2 is purely additive.
- **Do not** modify the existing fact-bank Edge Functions (`fact-bank-import`, `fact-bank-validate-source`, `fact-bank-generate-distractors`, `fact-bank-auto-seed`, `fact-bank-batch-seed`).
- **Do not** modify any of the 26 existing Maestro test YAML files except for adding the env-var passthrough in `run_tests.sh`. New behavior goes in `test_27_feedback_submit.yaml`.
- **Do not** add a feedback CTA inside game flows (mid-question, mid-lobby) in F2. The persistent FAB is the only entry point. Programmatic triggers via the context API are exposed but unused.
- **Do not** write to `TRIVOLTA_DIFFERENTIATION.md`, `TRIVOLTA_HALLUCINATION_STRATEGY.md`, or `TRIVOLTA_ARCHITECTURE.md`. Mac Claude updates the architecture doc after F2 lands. Tracker entry for F2 ✅ is the only doc edit Claude Code makes.
- **Do not** ship the FAB in production builds gated by `__DEV__` or similar. F2 is a real feature; it ships in beta.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files (no edits)
1. `supabase/migrations/20240106000000_fact_bank_schema.sql` — reference for `is_admin()` helper, RLS policy patterns, table-creation conventions.
2. `supabase/migrations/20240107000000_auto_seed.sql` — most recent migration, for migration-numbering convention.
3. `supabase/functions/fact-bank-generate-distractors/index.ts` — reference for the standard Edge Function structure (CORS, auth preamble, service-role client construction, response shapes).
4. `supabase/functions/_shared/` — confirm there is no existing shared auth helper to reuse; if there is, use it; if not, inline the auth preamble like the other functions do.
5. `mobile/lib/api.ts` — reference for `callFunction` helper.
6. `mobile/lib/auth.tsx` — for `useAuth()` shape.
7. `mobile/app/_layout.tsx` — current AuthProvider mount point.
8. `mobile/app/admin/_layout.tsx` and `mobile/app/admin/index.tsx` — for the nav-entry pattern.
9. `mobile/app/admin/reports/index.tsx` — for the simple admin-list pattern to mirror.
10. `mobile/maestro/test_03_sign_in.yaml` and `mobile/maestro/scripts/ensure_test_user_02.js` — for the new Maestro test scaffold.
11. `mobile/run_tests.sh` — to understand current env passthrough and add the FAB env var.

### 2. Create the migration
Create `supabase/migrations/20240108000000_feedback_reports.sql` containing the table, indexes, RLS enable, and the two SELECT policies. No INSERT/UPDATE/DELETE policies. Use lowercase SQL conventions matching the existing migrations.

### 3. Create the Edge Function
Create `supabase/functions/submit-feedback/index.ts`. Mirror the auth preamble used by `fact-bank-generate-distractors`. Validate the body shape per the verifiable-objective list. On insert, use the service-role client; user_id comes from the verified JWT, never from the request body. Return shapes match the verifiable-objective list exactly.

### 4. Create the mobile FeedbackProvider + FAB + Modal
- New file `mobile/components/FeedbackFAB.tsx` exporting:
  - `FeedbackProvider` (default child wrapping with the FAB + modal mounted at the root)
  - `useFeedback()` returning `{ openFeedback(seedBody?: string) }`
- Mount `FeedbackProvider` immediately inside `AuthProvider` in `mobile/app/_layout.tsx`.
- The FAB itself should NOT render on `/auth` or while `useAuth().loading` is true.
- The FAB visibility is also gated by the env var `EXPO_PUBLIC_HIDE_FEEDBACK_FAB === '1'` (hidden when set).
- For the `screen` field in the payload, derive a stable identifier from `usePathname()`:
  - Strip leading `/`.
  - Replace empty string with `home`.
  - Strip query strings and route params (`/lobby/[code]/game` → `lobby/game`).
  - Lowercase.
  - Cap at 120 chars.
- Modal uses React Native's built-in `Modal` component. No portals, no third-party.
- The toast/banner is implemented in the same FeedbackFAB module — a simple absolutely-positioned `View` that auto-hides after 2.5s using `setTimeout` cleared on unmount.

### 5. Wire the API call
Add `submitFeedback` to `mobile/lib/api.ts`. Use the existing `callFunction` helper to ensure the auth header and apikey logic are consistent.

### 6. Build the admin triage screen
- Create `mobile/app/admin/feedback/index.tsx` mirroring the structure and styling of `mobile/app/admin/reports/index.tsx`.
- Query: `supabase.from('feedback_reports').select('id, user_id, screen, route_path, body, state_snapshot, app_version, platform, created_at').order('created_at', { ascending: false }).limit(50)`.
- Render a simple FlatList. Each row: relative time + screen on top, body preview, "▸ Expand" button reveals full body and a code-block-styled `state_snapshot` JSON.
- No pagination beyond `limit(50)` in F2. Future tranches can add load-more.
- Wire it into `mobile/app/admin/_layout.tsx` (`<Stack.Screen name="feedback/index" options={{ title: 'Feedback' }} />`) and add the entry to the `NAV_LINKS` array on `mobile/app/admin/index.tsx`.

### 7. Maestro
- Add `EXPO_PUBLIC_HIDE_FEEDBACK_FAB=1` to `mobile/.env.example` and `mobile/.env.local` (with a comment: "Hides the feedback FAB during Maestro runs so it doesn't overlap testIDs. Unset for manual testing.").
- Edit `mobile/run_tests.sh` so the env var is passed to the app under test by default. The mechanism depends on how `run_tests.sh` already handles env — match its existing pattern. Add a one-line comment explaining why.
- Create `mobile/maestro/test_27_feedback_submit.yaml`. Use the same `appId` and `runScript` ensure-user pattern as `test_03_sign_in.yaml`. Within the YAML's `env` block, override the FAB-hiding flag so the FAB is visible for this flow only. If Maestro doesn't support per-flow env override at runtime, document the alternative in the YAML header comment: temporarily unset the var before running test_27 OR launch the app with explicit env via Maestro's `--env` flag in `run_tests.sh`. Pick the simplest approach that works in current Maestro 2.5.0 and keeps the rest of the suite untouched.
- After signing in, tap the FAB, type a body, tap send, assert the toast.

### 8. Tracker update
Edit `TRIVOLTA_TRACKER.md`:
- Mark F2 ✅ in Phase 2.9 Tranche 1, with a one-line outcome (table + Edge Function + FAB + admin screen + 1 Maestro test).
- Add `✅ test_27 — feedback submit (FAB → modal → submit → toast)` to the Maestro test list.
- Mark `✅ INSTRUCTIONS_F2_FEEDBACK_CHANNEL.md` in the INSTRUCTIONS Files Written section.

### 9. Verification (Claude Code runs all of these)
1. `cd mobile && npx tsc --noEmit` → exit 0.
2. `supabase db reset` → succeeds, all migrations apply.
3. `supabase functions serve --no-verify-jwt --env-file supabase/.env.local` → starts cleanly with `submit-feedback` listed.
4. `curl` smoke test against `submit-feedback`:
   - With no Authorization header → 401.
   - With a fresh user JWT and a valid body → 200 with `{ ok: true, id: ... }`.
   - With a body of empty string → 400 `validation_failed`.
   - With a body of 5000 chars → 400 `validation_failed`.
   - Verify the inserted row's `user_id` matches the JWT's user, NOT any user_id sent in the request body (try sending a different user_id in the body — it must be ignored).
5. `cd mobile && ./run_tests.sh` → 26/26 passing.
6. `git diff HEAD > ~/trivolta_diff.txt` and stop. Mac Claude reviews against the four criteria before commit.

## Verification

Final report Claude Code returns:
- TypeScript pass/fail.
- `supabase db reset` outcome.
- The four curl results listed in Step 9.4.
- Maestro count (26/26 expected).
- Confirmation that `/admin/feedback` renders the test row inserted during the curl smoke test.
- Path to `~/trivolta_diff.txt`.

After Mac Claude approves the diff, this phase is done. F2 ✅ is recorded in Step 8 above; confirm it persisted through any rebases.

---

Read INSTRUCTIONS_F2_FEEDBACK_CHANNEL.md and execute all steps exactly as written.
