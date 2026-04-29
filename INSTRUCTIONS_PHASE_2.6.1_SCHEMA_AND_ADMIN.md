# INSTRUCTIONS_PHASE_2.6.1_SCHEMA_AND_ADMIN.md

## Task

Build the Layer 1 fact-bank schema and the admin tooling shell that Mike will use during Phase 2.6.3 seeding. After this task, Mike can navigate to `localhost:8081/admin` in a browser, authenticate as an admin, and see empty admin pages with working navigation. The schema is ready for Phase 2.6.2 (import + AI source citation) to populate. No write actions are wired up in this phase — buttons render as disabled placeholders for the next sub-phase.

This is the first sub-phase of Phase 2.6. See `PHASE_2.6_ARCHITECTURE.md` for the full design — that document is authoritative for schema details, RLS rules, route structure, and the verification trigger logic.

## Prerequisite

`INSTRUCTIONS_LOCAL_NEW_KEYS.md` is complete. Local Supabase runs on new sb_publishable / sb_secret keys, all 5 existing Edge Functions are hardened with the apikey-header pattern, and the Maestro suite is green.

## Verifiable objective

- [ ] New migration file `supabase/migrations/20240106000000_fact_bank_schema.sql` exists, applies cleanly via `supabase db reset`, and creates exactly the 7 tables specified in `PHASE_2.6_ARCHITECTURE.md`: `categories`, `facts`, `fact_sources`, `distractors`, `fact_reports`, `fact_exposures`, `question_renderings`
- [ ] Verification trigger `check_fact_verification` exists on `public.facts` and enforces the rules in `PHASE_2.6_ARCHITECTURE.md` — specifically: a fact's `verification_status` cannot transition to `'verified'` unless the category's `verification_standard` is satisfied by confirmed `fact_sources` rows
- [ ] Helper function `public.is_admin()` exists, is `security definer`, and returns true when the calling user's JWT has `app_metadata.role = 'admin'`
- [ ] RLS is enabled on all 7 new tables with policies matching the architecture doc: anyone authenticated can read public-facing data (verified facts, their sources, their active distractors), only admins can write, users own their own `fact_exposures` rows, users can insert reports for themselves
- [ ] All 10 categories from `PHASE_2.6_ARCHITECTURE.md` Step 5 table are seeded with `verification_standard = 'cross-referenced'`: `science`, `history`, `geography`, `film`, `music`, `sports`, `literature`, `art`, `pop-culture`, `general`
- [ ] `mobile/lib/auth.tsx` exposes an `isAdmin: boolean` from `useAuth()`, derived from `session.user.app_metadata.role === 'admin'`
- [ ] `mobile/app/admin/_layout.tsx` exists, gates all admin routes: redirects unauthenticated users to `/auth`, redirects non-admin authenticated users to `/(tabs)`
- [ ] All 9 admin route files exist and render without crashing: `admin/index.tsx`, `admin/facts/index.tsx`, `admin/facts/queue.tsx`, `admin/facts/[id].tsx`, `admin/facts/import.tsx`, `admin/sources/cite.tsx`, `admin/distractors/generate.tsx`, `admin/reports/index.tsx`, `admin/coverage/index.tsx`
- [ ] Routes that display data (`admin/index`, `admin/facts/index`, `admin/facts/queue`, `admin/facts/[id]`, `admin/reports/index`, `admin/coverage/index`) read from Supabase and render appropriate empty states when no data exists
- [ ] Routes that will host write actions in Phase 2.6.2 (`admin/facts/import`, `admin/sources/cite`, `admin/distractors/generate`) are placeholder pages with a "Coming in Phase 2.6.2" message
- [ ] `mobile/app.json` is configured for Expo Web (Metro bundler, single output) so `npx expo start --web` opens the app at `localhost:8081`
- [ ] `trivoltaapp@outlook.com` has `app_metadata.role = 'admin'` set on the local DB (after the user has signed up)
- [ ] CLAUDE.md has a new "Admin Role Setup" section documenting how to grant admin role (generic instructions, no specific email baked in) and noting that the user must sign out / back in for the new JWT to take effect
- [ ] `TRIVOLTA_TRACKER.md` shows Phase 2.6 with all 8 sub-phases and Phase 2.6.1 marked complete after this task ships
- [ ] All 25 active Maestro tests still pass against the new schema and RLS policies — no regression

## Constraints

- Do NOT modify any existing migration file. Add a new one with timestamp `20240106000000`.
- Do NOT modify any existing Edge Function source. The 5 existing functions stay exactly as they are after `INSTRUCTIONS_LOCAL_NEW_KEYS.md`.
- Do NOT modify `mobile/lib/supabase.ts`, `mobile/lib/api.ts`, `mobile/lib/types.ts`, `mobile/lib/theme.ts`, or any existing screen file under `mobile/app/(tabs)/`, `mobile/app/lobby/`, or top-level `mobile/app/*.tsx`. Admin routes are additive and live under `mobile/app/admin/` only.
- Do NOT install any new mobile dependency in this sub-phase. MMKV is Phase 2.6.6. React Query / SWR is not in scope. Use existing patterns (presumably `useState` / `useEffect` with the Supabase client) — match whatever data-fetching pattern already exists in the codebase.
- Do NOT add admin write functionality in this sub-phase. Read-only displays only. If a write action is shown in the UI for visual completeness (e.g. an Approve button on the fact detail page), it must be disabled with a "Coming in Phase 2.6.2" or similar marker.
- Do NOT enable any Supabase feature beyond what is already enabled in `config.toml` (no Storage, no Realtime additions, no Auth provider changes).
- Do NOT change the existing Maestro tests. Schema and RLS additions must be backwards-compatible with all existing flows.
- Do NOT commit Mike's admin user UUID, email, or any user-identifying value into the migration. Admin role assignment happens at runtime via SQL, not via schema.
- Do NOT use a separate Next.js app for admin tooling. All admin routes go into the existing Expo app under `mobile/app/admin/`.
- Do NOT rely on Postgres extensions beyond what's already enabled in earlier migrations (`pgcrypto` for `gen_random_uuid()` is fine).
- Do NOT introduce a new theme, color palette, or design system for admin pages. Reuse the existing theme tokens from `mobile/lib/theme.ts` where styling is needed. Admin tooling can be visually utilitarian — but it must not invent new colors or typography that conflict with the rest of the app.
- Do NOT auto-seed any test admin user via the migration. Admin role is granted at runtime per the procedure documented in CLAUDE.md.

## Steps

### Step 1 — Create the schema migration

Create `supabase/migrations/20240106000000_fact_bank_schema.sql`. The migration must implement everything specified under "Layer 1 — Fact Bank schema" in `PHASE_2.6_ARCHITECTURE.md`, including:

- All 7 tables with the exact column names, types, constraints, and check clauses listed in the architecture doc
- All indexes listed in the architecture doc
- The `check_fact_verification` trigger function and its `before update` trigger on `public.facts`
- The `public.is_admin()` helper function
- RLS enabled on all 7 tables with the policies listed in the architecture doc
- The 10 seed category rows with `verification_standard = 'cross-referenced'`

Read the architecture doc carefully before writing. Cross-check column names and check constraints against the doc — the trigger logic depends on exact spelling (e.g., `verification_status`, `verified_reachable`, `human_confirmed`).

### Step 2 — Verify the migration applies

Run `supabase db reset`. Confirm clean apply.

Verify each piece exists via `psql` against the local DB at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`:

- All 7 tables present in `public` schema
- `fact_verification_check` trigger present on `public.facts`
- `is_admin` function present in `public` schema
- 10 categories seeded, all with `verification_standard = 'cross-referenced'`
- RLS enabled on all 7 tables (`select relname, relrowsecurity from pg_class where relname in (...)`)

Then verify the trigger fires correctly: insert a test fact with no sources, attempt to update it to `verification_status = 'verified'`, confirm the trigger raises an error mentioning the source-count requirement. Delete the test fact afterward.

### Step 3 — Document admin role setup in CLAUDE.md

Add a new section to `CLAUDE.md` titled "Admin Role Setup" that documents:

- The fact that Trivolta uses `auth.users.app_metadata.role = 'admin'` to gate admin access
- The exact `psql` command to grant admin to a user by email (use `<email>` as a placeholder — no specific user baked in)
- The requirement that the user must sign out and back in for the new JWT to include the updated `app_metadata`
- The production equivalent: Supabase Dashboard → Authentication → Users → User Metadata → set `role: admin` under app_metadata
- Where the role is checked: Postgres RLS via `is_admin()`, future Edge Functions (`auth.user.app_metadata.role`), mobile admin layout via `useAuth().isAdmin`
- The reason `app_metadata` is used instead of `user_metadata`: `app_metadata` is service-role-only and not user-editable; `user_metadata` is user-editable and forgeable

Place the section logically in CLAUDE.md — likely near other auth-related sections.

### Step 4 — Grant admin to the local admin user

The local admin user is `trivoltaapp@outlook.com`. If this user already exists in `auth.users` (signed up via the existing app flow), grant the admin role via `psql` per the procedure in the CLAUDE.md section just added.

If the user does not yet exist, document this in the handoff back to Mac Claude — Mike will need to sign up via the iOS Simulator first, then re-run the admin grant.

After granting, verify the role is set by querying `auth.users` for that email and reading the `raw_app_meta_data ->> 'role'` value.

### Step 5 — Add `isAdmin` to the auth context

Modify `mobile/lib/auth.tsx` to expose an `isAdmin: boolean` value from the `useAuth()` hook, derived from `session?.user?.app_metadata?.role === 'admin'`. Update the context type to include the new field.

Do not restructure the file. Make the smallest possible diff that adds the field to both the context value and the exposed type. Match the existing code style in that file.

### Step 6 — Create admin layout and route stubs

Create the admin route tree under `mobile/app/admin/`:

```
admin/
  _layout.tsx
  index.tsx
  facts/
    index.tsx
    queue.tsx
    [id].tsx
    import.tsx
  sources/
    cite.tsx
  distractors/
    generate.tsx
  reports/
    index.tsx
  coverage/
    index.tsx
```

**`_layout.tsx`** must:
- Use `useAuth()` to read `session`, `isAdmin`, `loading`
- Show a loading spinner while `loading` is true
- Redirect to `/auth` if no session
- Redirect to `/(tabs)` if session exists but `isAdmin` is false
- Render an Expo Router `Stack` for all admin children, with a header titled "Admin"

**`admin/index.tsx`** (admin home dashboard) must:
- Display three counts read from Supabase: verified facts (`facts.verification_status = 'verified'`), pending facts (`'pending'`), open reports (`fact_reports.status = 'open'`)
- Render a vertical list of navigation links to: facts, queue, import, sources/cite, distractors/generate, reports, coverage
- Use the existing app's theme tokens for colors and spacing — match what's already in use elsewhere

**`admin/facts/index.tsx`** must:
- Fetch up to 100 most recent facts from Supabase, ordered by `created_at` descending
- Render each as a tappable row showing: fact text, correct answer, difficulty, verification status
- Tapping a row navigates to `/admin/facts/[id]` for that fact
- Show a friendly empty state when no facts exist (point to `/admin/facts/import`)

**`admin/facts/queue.tsx`** must:
- Same pattern as `admin/facts/index.tsx` but filtered to `verification_status = 'pending'` only
- Empty state messaging reflects an empty review queue

**`admin/facts/[id].tsx`** must:
- Read the fact `id` from `useLocalSearchParams`
- Fetch and display: the fact (text, correct answer, difficulty, status), all `fact_sources` rows for that fact, all `distractors` rows for that fact (active and inactive)
- Render Approve and Reject buttons that are disabled, with a label or marker indicating they activate in Phase 2.6.2

**`admin/facts/import.tsx`**, **`admin/sources/cite.tsx`**, **`admin/distractors/generate.tsx`** must:
- Each render a placeholder page with the route's title and a "Coming in Phase 2.6.2" message
- No data fetching, no actions

**`admin/reports/index.tsx`** must:
- Fetch all rows from `fact_reports`, ordered by `created_at` descending
- Render each as a row showing reason, status, and detail (or em-dash if null)
- Show empty state when no reports exist

**`admin/coverage/index.tsx`** must:
- Fetch all active categories
- For each, count facts in `verification_status = 'verified'` and compare against a target of 150 facts per category (1500 total / 10 categories)
- Render each category with display name, current count, target, percentage, and a progress bar
- Calibrate the progress bar visually so 100% looks "full"

For all admin pages: use the existing app's theme tokens and component patterns. Do not introduce new design tokens. The pages can be visually plain but must respect the existing color and spacing conventions.

### Step 7 — Configure Expo for web

Open `mobile/app.json`. Add a `web` configuration block under the `expo` key if one doesn't already exist:
- `bundler: 'metro'`
- `output: 'single'`
- `favicon`: point to an existing asset under `mobile/assets/` if one exists; otherwise omit the favicon field

Do not change any other field in `app.json`.

### Step 8 — Verify Expo Web works

Run `npx expo start --web` from `mobile/`. Open `http://localhost:8081` in a browser.

Sign in as `trivoltaapp@outlook.com`. Navigate to `http://localhost:8081/admin`. Confirm:
- Admin dashboard renders with three count cards (likely all zeros at this stage) and 7 navigation links
- Each navigation link opens the corresponding stub page without console errors
- The fact detail link works (navigate to `/admin/facts/[id]` won't have data, but the route should resolve and show a "Loading…" state, not crash)

Sign out, sign in as a non-admin user (e.g., the Maestro `testuser02` if it exists locally). Navigate to `/admin` directly. Confirm the redirect to `/(tabs)` fires.

If the Expo Web dev server reports any compilation errors or unresolved imports, fix them before proceeding. The full admin tree must compile cleanly under both iOS and Web targets.

### Step 9 — Run the Maestro suite against the new schema

```
cd /Users/mizzy/Developer/Trivolta
supabase db reset
```

Note that `supabase db reset` wipes `auth.users`, so the admin role grant from Step 4 is lost. The Maestro suite does not need admin to pass — it tests regular user flows.

In a separate terminal:
```
supabase functions serve --no-verify-jwt --env-file supabase/.env.local
```

Back in the original terminal:
```
cd mobile && ./run_tests.sh
```

All 25 active tests must pass. If any fail, the schema or RLS policy change broke an existing flow. Fix before proceeding. Do not adjust the tests — the constraint is that the existing flows continue to work, not that the tests be modified to accommodate the new schema.

After the suite passes, re-grant admin to `trivoltaapp@outlook.com` per Step 4 so manual admin testing works again.

### Step 10 — Update the tracker

Edit `TRIVOLTA_TRACKER.md`:

- Insert a new "Phase 2.6 — Question Quality Architecture" section between Phase 2.5 and Phase 3
- Under it, list all 8 sub-phases (2.6.1 through 2.6.8) per `PHASE_2.6_ARCHITECTURE.md`'s rollout plan, with appropriate ⬜ / ✅ markers
- Update Phase 3 to indicate it is gated on Phase 2.6.8 complete; remove the "🔄 NEXT" marker from Phase 3
- Under "INSTRUCTIONS Files Written", add entries for all six Phase 2.6 INSTRUCTIONS files: `INSTRUCTIONS_PHASE_2.6.1_*` through `INSTRUCTIONS_PHASE_2.6.7_*`. Mark only `2.6.1` as ✅ when this task ships; the rest are ⬜.

### Step 11 — Commit

Generate the diff:
```
git diff HEAD > /tmp/trivolta_diff.txt
```

Stop and hand the diff to Mac Claude for review against the four criteria. Do not commit until Mac Claude approves.

After approval, commit with message: `feat: Phase 2.6.1 — fact bank schema + admin route stubs (Layer 1)`.

The commit should include:
- `INSTRUCTIONS_PHASE_2.6.1_SCHEMA_AND_ADMIN.md` (this file)
- `PHASE_2.6_ARCHITECTURE.md`
- `TRIVOLTA_TRACKER.md`
- `CLAUDE.md`
- `supabase/migrations/20240106000000_fact_bank_schema.sql`
- All 10 files under `mobile/app/admin/`
- `mobile/lib/auth.tsx`
- `mobile/app.json`

Verify nothing secret is staged: `git status --porcelain | grep -E '\.env\.local|signing_keys\.json'` must return no output.

## Verification

Every command below must succeed and produce expected output before reporting done.

```bash
# 1. Migration applies cleanly
cd /Users/mizzy/Developer/Trivolta && supabase db reset 2>&1 | tail -3
# expect: ends with "Finished supabase db reset"

# 2. All 7 fact-bank tables exist
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from information_schema.tables
where table_schema = 'public'
  and table_name in ('categories','facts','fact_sources','distractors','fact_reports','fact_exposures','question_renderings');
"
# expect: 7

# 3. Verification trigger exists
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from pg_trigger
where tgrelid = 'public.facts'::regclass and tgname = 'fact_verification_check';
"
# expect: 1

# 4. is_admin() function exists
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace;
"
# expect: 1

# 5. RLS enabled on all 7 tables
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('categories','facts','fact_sources','distractors','fact_reports','fact_exposures','question_renderings')
  and relrowsecurity = true;
"
# expect: 7

# 6. 10 categories seeded with cross-referenced
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from public.categories where verification_standard = 'cross-referenced';
"
# expect: 10

# 7. Verification trigger blocks unverified flips
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
insert into public.facts (category_id, fact_text, correct_answer, difficulty, source_origin)
values ((select id from public.categories where slug='science'), 'trigger test', 'x', 1, 'manual_authoring');
update public.facts set verification_status = 'verified' where fact_text = 'trigger test';
" 2>&1 | grep -ic "Cross-referenced verification requires"
# expect: at least 1

# Cleanup the test fact
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "delete from public.facts where fact_text = 'trigger test';"

# 8. All 10 admin route files exist
for f in _layout.tsx index.tsx facts/index.tsx facts/queue.tsx 'facts/[id].tsx' facts/import.tsx sources/cite.tsx distractors/generate.tsx reports/index.tsx coverage/index.tsx; do
  test -f "/Users/mizzy/Developer/Trivolta/mobile/app/admin/$f" && echo "OK: $f" || echo "MISSING: $f"
done
# expect: 10 OK lines, 0 MISSING

# 9. isAdmin exported from auth context
grep -c "isAdmin" /Users/mizzy/Developer/Trivolta/mobile/lib/auth.tsx
# expect: at least 2

# 10. Expo Web configuration present
grep -c '"bundler": "metro"' /Users/mizzy/Developer/Trivolta/mobile/app.json
# expect: at least 1

# 11. Maestro suite green
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh 2>&1 | tail -10
# expect: 25 passed, 0 failed

# 12. CLAUDE.md updated
grep -c "Admin Role Setup" /Users/mizzy/Developer/Trivolta/CLAUDE.md
# expect: at least 1

# 13. Tracker updated
grep -c "Phase 2.6" /Users/mizzy/Developer/Trivolta/TRIVOLTA_TRACKER.md
# expect: at least 8 (one per sub-phase + section header + INSTRUCTIONS list)

# 14. trivoltaapp@outlook.com has admin (only valid after the user has signed up)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select raw_app_meta_data ->> 'role' from auth.users where email = 'trivoltaapp@outlook.com';
"
# expect: 'admin' if user exists; empty if user has not signed up yet (acceptable — flag to Mac Claude in handoff)

# 15. No secrets staged
cd /Users/mizzy/Developer/Trivolta
git status --porcelain | grep -E '\.env\.local|signing_keys\.json'
# expect: no output

# 16. No unintended files modified
git diff HEAD --stat
# expect: only files in the Step 11 commit list, plus possibly auth.tsx and app.json
```

If any check fails, do not commit. Report to Mac Claude with the failing command output and proposed fix.
