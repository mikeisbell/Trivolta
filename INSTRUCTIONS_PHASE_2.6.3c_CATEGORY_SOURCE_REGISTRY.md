# INSTRUCTIONS_PHASE_2.6.3c_CATEGORY_SOURCE_REGISTRY.md

## Task

Build a category → preferred source domains registry that lives in the database, and update the Phase 2.6.3a auto-seed pipeline's citation prompt to steer Haiku toward those domains. Goal: raise the auto-verify rate by getting the AI to propose URLs from flat-HTML primary sources (CIA Factbook, Britannica, .gov pages) instead of dynamically-rendered pages (Wikipedia, JS-heavy sites) where excerpt-substring matching consistently fails.

This is a NEW sub-phase inserted between Phase 2.6.3a (automated seeding) and Phase 2.6.3b (Mike's calibration). It does NOT modify the verification standard, the cross-check logic, or the mechanical-check logic. It only changes (a) what URLs the AI proposes in the citation pass and (b) what the telemetry surfaces about source-domain quality.

## Prerequisite

- Phase 2.6.1 ✅ (schema, admin role, RLS, verification trigger, `is_admin()` helper)
- Phase 2.6.2 ✅ (import + AI source citation Edge Functions)
- Phase 2.6.3a ✅ (automated seeding pipeline, telemetry tables, cost helper)
- `trivoltaapp@outlook.com` has admin role granted locally
- Maestro suite green (25/25)

## Verifiable objective

- [ ] New table `category_source_preferences` exists, RLS-protected, populated with seed data covering all 10 active categories
- [ ] New SQL helper `public.get_preferred_domains(category_slug text)` returns the preferred domains for a category as an ordered text[] (lowest priority first)
- [ ] `auto_seed_pipeline.ts` reads preferred domains for the fact's category and injects them into the Haiku citation prompt as a soft preference (not a strict filter)
- [ ] `fact_auto_seed_sources` table gets a new column `from_preferred_domain boolean not null default false`
- [ ] The shared pipeline computes `from_preferred_domain` for each proposed source by checking whether the URL's host matches any preferred domain for the fact's category
- [ ] `/admin/telemetry` dashboard adds two new widgets: "Preferred-domain adherence rate" (% of cited sources from preferred domains) and "Top preferred-domain misses" (preferred domains the AI most often ignores per category)
- [ ] New admin route `/admin/source-preferences` lists current preferences, allows adding/editing/removing rows. Admin-only.
- [ ] All 25 active Maestro tests still pass
- [ ] `TRIVOLTA_TRACKER.md` shows Phase 2.6.3c as ✅ when this task ships, slotted between 2.6.3a and 2.6.3b

## Constraints

- Do NOT make the preference strict. The AI may still propose non-preferred sources; the system tracks adherence but does not reject. Strict filtering is reversible later if data shows it's needed; starting strict gives no fallback when preferred domains don't have the fact.
- Do NOT modify the cross-check pass, the mechanical-check logic, the trigger, or any Phase 2.6.1 schema beyond adding the new column to `fact_auto_seed_sources` and adding the new `category_source_preferences` table.
- Do NOT bake the registry into TypeScript code. The registry lives in the database so it can be edited without redeploying Edge Functions.
- Do NOT use `Alert.alert` on the new admin route. Use `window.confirm()` or custom modals — Phase 2.6.7 will fix the cross-platform issue, new code must avoid the trap.
- Do NOT modify any non-admin mobile route, `mobile/lib/supabase.ts`, `mobile/lib/api.ts`, `mobile/lib/types.ts`, or `mobile/lib/theme.ts`.
- Do NOT add new third-party dependencies.
- Do NOT remove the existing categorization of sources (`source_type` enum: wikipedia, imdb, official_record, reference_book, other). The new registry is additive — it tells the AI which domains to prefer; the source_type tag remains how each source self-describes.
- Do NOT re-run auto-seed on facts that have already been auto-verified. The preference registry only affects new auto-seed runs.

## Steps

### Step 1 — Migration: add `category_source_preferences` table and `from_preferred_domain` column

Create `supabase/migrations/20240108000000_category_source_registry.sql`. The migration must:

1. Create `public.category_source_preferences`:
   - `id` uuid primary key default `gen_random_uuid()`
   - `category_slug` text not null (no FK — slug-based for resilience to category id changes; uniqueness of categories.slug is enforced elsewhere)
   - `domain` text not null — bare domain, no scheme, no path. e.g., `cia.gov` not `https://cia.gov/factbook/`. Lowercase, no trailing slash. Add a check constraint enforcing this shape.
   - `priority` integer not null check (priority between 1 and 100) — lower means more preferred. Default 50.
   - `notes` text — optional human description (e.g., "use for country-level facts", "best for ancient history")
   - `is_active` boolean not null default true
   - `created_at` timestamptz not null default now()
   - Unique constraint on (`category_slug`, `domain`)
   - Index on `(category_slug, priority)` where `is_active = true`

2. Add column `from_preferred_domain boolean not null default false` to `fact_auto_seed_sources`. (Older rows default to false, which is fine — they were captured before the registry existed.)

3. Create SQL helper `public.get_preferred_domains(p_category_slug text) returns text[]`:
   - Returns the `domain` values for that slug where `is_active = true`, ordered by `priority asc, domain asc`
   - Returns an empty array if no preferences exist
   - `STABLE` (reads tables, doesn't modify), security definer not required

4. Create SQL helper `public.url_host(p_url text) returns text`:
   - Extracts the host from a URL: `https://www.cia.gov/the-world-factbook/countries/france/` → `www.cia.gov`
   - Strips `www.` prefix so `www.cia.gov` and `cia.gov` are treated the same
   - Returns null on malformed input
   - `IMMUTABLE`, language SQL or plpgsql

5. RLS on `category_source_preferences`:
   - Anyone authenticated can SELECT (admin UI reads it; pipeline reads it via service role anyway)
   - Only admin can INSERT / UPDATE / DELETE (use `is_admin()` from Phase 2.6.1)

6. Seed `category_source_preferences` with the data below. Insert in priority order so lower-priority numbers (more preferred) come first within each category. Source list captured 2026-04-29; expand or edit via the admin UI.

   **geography** (cross-referenced):
   - priority 10: cia.gov ("CIA World Factbook — flat HTML, primary source for country-level facts")
   - priority 20: britannica.com ("Britannica country profiles — flat HTML, encyclopedic")
   - priority 30: geonames.org ("Place name database, structured data")
   - priority 40: nationalgeographic.com ("Geographic features, ecosystems")
   - priority 80: en.wikipedia.org ("Wikipedia — accept only if other sources fail; HTML rendering breaks excerpt match")

   **history** (cross-referenced):
   - priority 10: britannica.com ("Britannica history articles — flat HTML")
   - priority 20: history.com ("History.com timelines and feature articles")
   - priority 30: loc.gov ("Library of Congress — primary source for US history")
   - priority 30: archives.gov ("US National Archives")
   - priority 40: nationalarchives.gov.uk ("UK National Archives")
   - priority 50: smithsonianmag.com
   - priority 80: en.wikipedia.org

   **science** (cross-referenced):
   - priority 10: nasa.gov ("Space, planetary science, astronomy")
   - priority 10: nih.gov ("Biology, medicine, health")
   - priority 10: nist.gov ("Physics, measurement, standards")
   - priority 10: noaa.gov ("Earth science, oceans, atmosphere")
   - priority 20: britannica.com ("Britannica science articles")
   - priority 30: nature.com ("Nature journal articles — flat HTML for many pages")
   - priority 30: scientificamerican.com
   - priority 80: en.wikipedia.org

   **literature** (cross-referenced):
   - priority 10: britannica.com
   - priority 20: poetryfoundation.org ("Poetry — primary source")
   - priority 20: gutenberg.org ("Project Gutenberg — primary text source")
   - priority 30: loc.gov
   - priority 80: en.wikipedia.org

   **film** (cross-referenced):
   - priority 10: imdb.com ("IMDB structured pages — generally flat enough for excerpt match")
   - priority 20: britannica.com
   - priority 30: afi.com ("American Film Institute")
   - priority 80: en.wikipedia.org

   **music** (cross-referenced):
   - priority 10: allmusic.com ("AllMusic structured artist/album pages")
   - priority 20: britannica.com
   - priority 30: billboard.com ("Charts and music news")
   - priority 30: grammy.com ("Grammy Awards primary source")
   - priority 80: en.wikipedia.org

   **sports** (cross-referenced):
   - priority 10: olympics.com ("Olympic results — primary source")
   - priority 10: fifa.com ("Soccer — primary source")
   - priority 10: nba.com
   - priority 10: mlb.com
   - priority 10: nfl.com
   - priority 10: nhl.com
   - priority 20: espn.com
   - priority 30: britannica.com
   - priority 80: en.wikipedia.org

   **art** (cross-referenced):
   - priority 10: metmuseum.org ("Metropolitan Museum of Art — primary source")
   - priority 10: nga.gov ("National Gallery of Art — primary source")
   - priority 10: tate.org.uk ("Tate — primary source")
   - priority 10: moma.org
   - priority 20: britannica.com
   - priority 80: en.wikipedia.org

   **pop-culture** (cross-referenced):
   - priority 10: imdb.com ("Film/TV/celebs")
   - priority 10: billboard.com
   - priority 20: allmusic.com
   - priority 20: britannica.com
   - priority 30: rollingstone.com
   - priority 80: en.wikipedia.org

   **general** (cross-referenced):
   - priority 10: britannica.com ("Default broad-coverage encyclopedia")
   - priority 20: cia.gov
   - priority 80: en.wikipedia.org

Verify the migration applies cleanly via `supabase db reset` and the existing 25 Maestro tests still pass before proceeding.

### Step 2 — Update the citation prompt in `auto_seed_pipeline.ts`

Modify `supabase/functions/_shared/auto_seed_pipeline.ts`. Specifically the citation pass (currently in the `runAutoSeed` function around the `citePrompt` declaration):

1. After loading the fact, look up the category's slug. The fact already has `category_id`; either join in the original load query or do a second `select slug from categories where id = ?`. Cache it on the fact object.

2. Call `service.rpc('get_preferred_domains', { p_category_slug: slug })` to fetch the preferred-domain list for that category. Tolerate empty results (a fact in a category with no preferences should still work — the prompt just gets the generic version).

3. Update `citePrompt` to inject the preferred-domain list as a soft preference. New shape:

```
You will propose 2 source URLs that confirm this trivia fact.
Fact: ${fact.fact_text}
Correct answer: ${fact.correct_answer}

Prefer URLs from these domains, in this order: ${preferredDomains.join(', ')}.
These domains tend to have flat HTML pages where short verbatim excerpts can be found via substring search. If the fact cannot be verified on any of these domains, use other authoritative sources, but PREFER the listed ones when they cover the topic.

For each source, return:
- url: a public URL where the fact can be verified
- source_type: one of "wikipedia", "imdb", "official_record", "reference_book", "other"
- excerpt: a short verbatim quote (no more than 30 words) that should appear on the fetched page

Return ONLY JSON. No markdown. Shape:
{"sources":[{"url":"...","source_type":"wikipedia","excerpt":"..."},{"url":"...","source_type":"...","excerpt":"..."}]}
```

If `preferredDomains` is empty, omit the "Prefer URLs from these domains..." sentence entirely; otherwise the empty list reads weirdly.

4. After the citation pass returns proposals, compute `from_preferred_domain` for each proposed source:
   - Extract the host of `proposal.url` using a small inline helper (parse with `new URL(p.url)`, lowercase, strip leading `www.`)
   - Test whether the extracted host matches any string in `preferredDomains` (exact or suffix match — e.g., `pages.britannica.com` should match the preference `britannica.com`; `cia.gov` should match `cia.gov`; do this with a simple `domain === host || host.endsWith('.' + domain)` check)
   - Set `from_preferred_domain` accordingly on each `ProposedSource`

5. The telemetry write in `writeTelemetry` must include `from_preferred_domain` in each `fact_auto_seed_sources` insert row.

6. Type updates: add `from_preferred_domain: boolean` to the `ProposedSource` type.

Do NOT change cross-check, mechanical-check, distractor generation, or any other pipeline stage. Only the citation prompt and the per-source telemetry annotation.

### Step 3 — Update `/admin/telemetry`

Modify `mobile/app/admin/telemetry.tsx`. Add two new widgets:

1. **"Preferred-domain adherence rate"** — single card showing percentage of `fact_auto_seed_sources` rows from the last 7 days where `from_preferred_domain = true`. Computed as: `count(*) filter (where from_preferred_domain) * 100 / count(*)`. Higher is better.

2. **"Top preferred-domain misses"** — table grouping by category and host (using `url_host(url)`) where `from_preferred_domain = false`. Top 10 misses overall. Helps spot patterns ("AI keeps citing wikipedia.org for geography facts despite cia.gov being preferred"). Each row: category slug, host, miss count.

Both widgets read directly via PostgREST + the user-scoped Supabase client. No new Edge Functions needed.

### Step 4 — New admin route `/admin/source-preferences`

Add `mobile/app/admin/source-preferences.tsx`. Functional CRUD for the registry:

- On mount, query all active `category_source_preferences` rows ordered by `category_slug, priority`.
- Display grouped by category. For each row: domain, priority, notes, an Edit button, a Deactivate button.
- "Add preference" form at the bottom: category slug dropdown (populated from `categories`), domain text input (validate shape: lowercase, no scheme, no path, no trailing slash), priority number input (1-100), notes textarea. Save inserts a new row.
- "Edit" inline-edits priority and notes (domain and category are fixed once created — to "rename" delete and re-add).
- "Deactivate" sets `is_active = false` rather than DELETE — preserves history. Show a separate "Show inactive" toggle to surface deactivated rows.
- All write operations go through the user-scoped Supabase client; RLS enforces admin-only.
- Use `window.confirm()` for deactivate (NOT `Alert.alert`).

Register the new screen in `mobile/app/admin/_layout.tsx`. Add a navigation link from `mobile/app/admin/index.tsx` ("Source preferences").

### Step 5 — Verification SQL

Add a quick-check helper to `supabase/migrations/20240108000000_category_source_registry.sql` (or as inline tests; either works):

```sql
-- Smoke: confirm seed data populated all 10 active categories
do $$
declare
  missing text;
begin
  select string_agg(slug, ', ') into missing
  from public.categories c
  where c.is_active = true
    and not exists (
      select 1 from public.category_source_preferences p
      where p.category_slug = c.slug and p.is_active = true
    );
  if missing is not null then
    raise warning 'Categories missing source preferences: %', missing;
  end if;
end$$;
```

Not a hard fail — just a warning during migration so Mike sees if the seed missed anything.

### Step 6 — Run the Maestro suite

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

All 25 must pass against an actually-booted iOS Simulator. The `run_tests.sh` exit-code masking issue is known (Phase 2.6.7); confirm visually that the suite ran.

### Step 7 — Re-run the Phase 2.6.3b smoke test

```
./mobile/smoke-test-cross-check.sh
```

Expected difference vs. the pre-2.6.3c run: Haiku should now propose `cia.gov` and/or `britannica.com` URLs instead of (or in addition to) Wikipedia for the Paris/Berlin facts. The mechanical check will pass on the flat-HTML sources, the cross-check will fire, and the smoke test should reach a true PASS — TRUE auto-verifies, WRONG lands in `needs_review` with low confidence.

If the smoke test still bails at `mechanical_check` for the TRUE fact, capture the proposed URLs from `fact_auto_seed_sources` and report back; the prompt may need a stronger steering wording.

### Step 8 — Update tracker

Edit `TRIVOLTA_TRACKER.md`:
- Insert a `Phase 2.6.3c — Category source registry — INSTRUCTIONS_PHASE_2.6.3c_CATEGORY_SOURCE_REGISTRY.md` row between 2.6.3a and 2.6.3b. Mark ✅ when this task ships.
- Add `INSTRUCTIONS_PHASE_2.6.3c_CATEGORY_SOURCE_REGISTRY.md` ✅ to the INSTRUCTIONS Files Written section.

### Step 9 — Commit

```
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > /tmp/trivolta_diff.txt
```

Stop and hand to Mac Claude for review. After approval, commit with message: `feat: Phase 2.6.3c — category source preference registry (steers AI toward flat-HTML primary sources)`.

Commit list:
- `INSTRUCTIONS_PHASE_2.6.3c_CATEGORY_SOURCE_REGISTRY.md` (this file)
- `TRIVOLTA_TRACKER.md`
- `supabase/migrations/20240108000000_category_source_registry.sql`
- `supabase/functions/_shared/auto_seed_pipeline.ts` (modified)
- `mobile/app/admin/telemetry.tsx` (modified)
- `mobile/app/admin/source-preferences.tsx` (new)
- `mobile/app/admin/_layout.tsx` (modified — register new screen)
- `mobile/app/admin/index.tsx` (modified — add nav link)

Verify nothing secret is staged: `git status --porcelain | grep -E '\.env\.local|signing_keys\.json'` returns no output.

## Verification

```bash
# 1. Migration applies cleanly
cd /Users/mizzy/Developer/Trivolta && supabase db reset 2>&1 | tail -3
# expect: Finished supabase db reset

# 2. Table exists with RLS
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from information_schema.tables where table_name = 'category_source_preferences';
"
# expect: 1
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select relrowsecurity from pg_class where relname = 'category_source_preferences';
"
# expect: t

# 3. New column on fact_auto_seed_sources
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(*) from information_schema.columns
where table_name = 'fact_auto_seed_sources' and column_name = 'from_preferred_domain';
"
# expect: 1

# 4. Helper functions exist
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select array_to_string(public.get_preferred_domains('geography'), ',');
"
# expect: cia.gov,britannica.com,geonames.org,...
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select public.url_host('https://www.cia.gov/the-world-factbook/countries/france/');
"
# expect: cia.gov   (www. stripped)

# 5. All 10 categories have at least one preference
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select count(distinct category_slug) from public.category_source_preferences where is_active;
"
# expect: 10

# 6. Pipeline references the new RPC
grep -c "get_preferred_domains" /Users/mizzy/Developer/Trivolta/supabase/functions/_shared/auto_seed_pipeline.ts
# expect: at least 1

# 7. Pipeline writes from_preferred_domain
grep -c "from_preferred_domain" /Users/mizzy/Developer/Trivolta/supabase/functions/_shared/auto_seed_pipeline.ts
# expect: at least 2 (type field + insert column)

# 8. Admin route exists, no Alert.alert
ls /Users/mizzy/Developer/Trivolta/mobile/app/admin/source-preferences.tsx
grep -L "Alert.alert" /Users/mizzy/Developer/Trivolta/mobile/app/admin/source-preferences.tsx \
  || echo "OK: no Alert.alert"
# expect: OK: no Alert.alert

# 9. Maestro suite green (against booted simulator)
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh 2>&1 | tail -10
# expect: 25 passed, 0 failed

# 10. Smoke test: re-run Paris/Berlin and confirm preferred-domain steering took effect
./mobile/smoke-test-cross-check.sh
# expect: TRUE auto-verifies (or at minimum, mechanical check passes via cia.gov/britannica.com)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "
select bool_or(from_preferred_domain) from public.fact_auto_seed_sources
where fact_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
"
# expect: t   (at least one cited source from a preferred domain)

# 11. Tracker updated
grep -c "Phase 2.6.3c" /Users/mizzy/Developer/Trivolta/TRIVOLTA_TRACKER.md
# expect: at least 1

# 12. No secrets staged
cd /Users/mizzy/Developer/Trivolta
git status --porcelain | grep -E '\.env\.local|signing_keys\.json'
# expect: no output
```

If any check fails, do not commit. Report to Mac Claude with the failing command output.
