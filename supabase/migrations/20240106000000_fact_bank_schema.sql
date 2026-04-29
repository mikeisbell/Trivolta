-- Phase 2.6.1 — Layer 1 Fact Bank schema + admin role helper
-- See PHASE_2.6_ARCHITECTURE.md for the authoritative design.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Categories define verification standards
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  display_name text not null,
  parent_id uuid references public.categories(id),
  verification_standard text not null
    check (verification_standard in ('cross-referenced', 'source-cited', 'self-asserted')),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- The atomic unit
create table public.facts (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) not null,

  fact_text text not null,
  correct_answer text not null,
  answer_aliases text[] default '{}',

  difficulty integer not null check (difficulty between 1 and 5),
  is_high_value boolean default false,

  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected', 'flagged')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id),

  created_by uuid references auth.users(id),
  source_origin text not null,
  created_at timestamptz default now()
);

create index idx_facts_category_verified on public.facts(category_id, verification_status)
  where verification_status = 'verified';
create index idx_facts_difficulty on public.facts(difficulty);

-- N sources per fact
create table public.fact_sources (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references public.facts(id) on delete cascade not null,
  url text,
  citation text,
  excerpt text,
  source_type text not null
    check (source_type in ('wikipedia', 'imdb', 'official_record', 'reference_book', 'other')),
  verified_reachable boolean default false,
  verified_at timestamptz,
  added_by_ai boolean default false,
  human_confirmed boolean default false
);

create index idx_fact_sources_fact on public.fact_sources(fact_id);

-- Distractors — human-authored or AI-cached
create table public.distractors (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references public.facts(id) on delete cascade not null,
  distractor_text text not null,
  authored_by text not null
    check (authored_by in ('human', 'ai-cached', 'imported')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  quality_score integer check (quality_score between 1 and 5),
  is_active boolean default true
);

create index idx_distractors_fact_active on public.distractors(fact_id) where is_active = true;

-- Player-reported issues
create table public.fact_reports (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references public.facts(id) on delete cascade not null,
  reported_by uuid references public.profiles(id),
  reason text not null
    check (reason in ('incorrect', 'ambiguous', 'outdated', 'offensive', 'other')),
  detail text,
  status text default 'open'
    check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Anti-repetition tracking
create table public.fact_exposures (
  player_id uuid references public.profiles(id) on delete cascade,
  fact_id uuid references public.facts(id) on delete cascade,
  last_seen_at timestamptz default now(),
  seen_count integer default 1,
  primary key (player_id, fact_id)
);

create index idx_exposures_player_recent on public.fact_exposures(player_id, last_seen_at);

-- Layer 2 question rendering cache
create table public.question_renderings (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references public.facts(id) on delete cascade not null,
  style text not null check (style in ('direct', 'indirect', 'contextual')),
  target_difficulty integer not null check (target_difficulty between 1 and 5),
  tone text not null default 'serious' check (tone in ('serious', 'playful')),

  question_text text not null,
  shuffled_answers jsonb not null,
  correct_index integer not null check (correct_index between 0 and 3),

  generated_by text not null check (generated_by in ('ai-rendered', 'human-authored')),
  validated boolean default false,
  validation_notes text,

  created_at timestamptz default now(),
  unique (fact_id, style, target_difficulty, tone)
);

create index idx_renderings_fact on public.question_renderings(fact_id);

-- ---------------------------------------------------------------------------
-- is_admin() helper
-- Reads the calling user's JWT claim app_metadata.role and returns true when
-- it equals 'admin'. app_metadata is service-role-only / not user-editable,
-- so it is the safe place to store role claims (vs. user_metadata).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- check_fact_verification trigger
-- A fact's verification_status only flips to 'verified' when its category's
-- standard is met by confirmed fact_sources rows.
-- ---------------------------------------------------------------------------
create or replace function public.check_fact_verification()
returns trigger
language plpgsql
as $$
declare
  std text;
  source_count int;
begin
  select verification_standard into std from public.categories where id = new.category_id;

  if new.verification_status = 'verified' then
    select count(*) into source_count
    from public.fact_sources
    where fact_id = new.id
      and verified_reachable = true
      and human_confirmed = true;

    if std = 'cross-referenced' and source_count < 2 then
      raise exception 'Cross-referenced verification requires >=2 confirmed sources';
    elsif std = 'source-cited' and source_count < 1 then
      raise exception 'Source-cited verification requires >=1 confirmed source';
    end if;
  end if;

  return new;
end;
$$;

create trigger fact_verification_check
before update on public.facts
for each row execute function public.check_fact_verification();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.facts enable row level security;
alter table public.fact_sources enable row level security;
alter table public.distractors enable row level security;
alter table public.fact_reports enable row level security;
alter table public.fact_exposures enable row level security;
alter table public.question_renderings enable row level security;

-- categories: anyone authenticated reads, admins write
create policy "categories_read" on public.categories
  for select using (auth.role() = 'authenticated');
create policy "categories_admin_write" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- facts: authenticated users read verified rows; admins read+write everything
create policy "facts_read_verified" on public.facts
  for select using (
    auth.role() = 'authenticated' and verification_status = 'verified'
  );
create policy "facts_admin_read_all" on public.facts
  for select using (public.is_admin());
create policy "facts_admin_write" on public.facts
  for all using (public.is_admin()) with check (public.is_admin());

-- fact_sources: authenticated users read sources tied to verified facts; admins full
create policy "fact_sources_read_verified" on public.fact_sources
  for select using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.facts f
      where f.id = fact_sources.fact_id and f.verification_status = 'verified'
    )
  );
create policy "fact_sources_admin_read_all" on public.fact_sources
  for select using (public.is_admin());
create policy "fact_sources_admin_write" on public.fact_sources
  for all using (public.is_admin()) with check (public.is_admin());

-- distractors: authenticated users read active distractors of verified facts; admins full
create policy "distractors_read_active_verified" on public.distractors
  for select using (
    auth.role() = 'authenticated'
    and is_active = true
    and exists (
      select 1 from public.facts f
      where f.id = distractors.fact_id and f.verification_status = 'verified'
    )
  );
create policy "distractors_admin_read_all" on public.distractors
  for select using (public.is_admin());
create policy "distractors_admin_write" on public.distractors
  for all using (public.is_admin()) with check (public.is_admin());

-- fact_reports: users insert/read their own; admins read+update all
create policy "fact_reports_insert_own" on public.fact_reports
  for insert with check (auth.uid() = reported_by);
create policy "fact_reports_read_own" on public.fact_reports
  for select using (auth.uid() = reported_by);
create policy "fact_reports_admin_read_all" on public.fact_reports
  for select using (public.is_admin());
create policy "fact_reports_admin_write" on public.fact_reports
  for all using (public.is_admin()) with check (public.is_admin());

-- fact_exposures: users own their own rows; admins read all
create policy "fact_exposures_select_own" on public.fact_exposures
  for select using (auth.uid() = player_id);
create policy "fact_exposures_insert_own" on public.fact_exposures
  for insert with check (auth.uid() = player_id);
create policy "fact_exposures_update_own" on public.fact_exposures
  for update using (auth.uid() = player_id) with check (auth.uid() = player_id);
create policy "fact_exposures_delete_own" on public.fact_exposures
  for delete using (auth.uid() = player_id);
create policy "fact_exposures_admin_read_all" on public.fact_exposures
  for select using (public.is_admin());

-- question_renderings: authenticated users read validated rows tied to verified facts; admins full
create policy "renderings_read_validated_verified" on public.question_renderings
  for select using (
    auth.role() = 'authenticated'
    and validated = true
    and exists (
      select 1 from public.facts f
      where f.id = question_renderings.fact_id and f.verification_status = 'verified'
    )
  );
create policy "renderings_admin_read_all" on public.question_renderings
  for select using (public.is_admin());
create policy "renderings_admin_write" on public.question_renderings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed categories — all 10 with cross-referenced verification standard
-- ---------------------------------------------------------------------------
insert into public.categories (slug, display_name, verification_standard) values
  ('science',      'Science',      'cross-referenced'),
  ('history',      'History',      'cross-referenced'),
  ('geography',    'Geography',    'cross-referenced'),
  ('film',         'Film',         'cross-referenced'),
  ('music',        'Music',        'cross-referenced'),
  ('sports',       'Sports',       'cross-referenced'),
  ('literature',   'Literature',   'cross-referenced'),
  ('art',          'Art',          'cross-referenced'),
  ('pop-culture',  'Pop Culture',  'cross-referenced'),
  ('general',      'General',      'cross-referenced');
