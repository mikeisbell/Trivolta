-- Phase 2.6.3a — Automated seeding pipeline
-- Adds the 'needs_review' verification state, two telemetry tables for the
-- AI-verifies-AI cross-check pipeline, and a cost-estimation helper.

-- ---------------------------------------------------------------------------
-- 1. Add 'needs_review' to the verification_status check constraint
-- ---------------------------------------------------------------------------
alter table public.facts
  drop constraint if exists facts_verification_status_check;

alter table public.facts
  add constraint facts_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected', 'flagged', 'needs_review'));

-- ---------------------------------------------------------------------------
-- 2. Update check_fact_verification trigger to allow needs_review transitions
--    pending -> needs_review                       (no source-count requirement)
--    needs_review -> verified                      (existing source-count requirement)
--    needs_review -> rejected                      (always allowed)
--    All Phase 2.6.1 transitions remain valid.
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

-- ---------------------------------------------------------------------------
-- 3. fact_auto_seed_log — one row per fact-bank-auto-seed invocation
-- ---------------------------------------------------------------------------
create table public.fact_auto_seed_log (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.facts(id) on delete cascade,
  outcome text not null
    check (outcome in ('auto_verified', 'needs_review', 'failed')),
  failure_stage text
    check (failure_stage in ('citation', 'mechanical_check', 'cross_check', 'distractor_generation', 'db_write', 'unknown')),
  failure_reason text,
  cross_check_confidence integer
    check (cross_check_confidence between 1 and 5),
  cross_check_reasoning text,
  cross_check_supported boolean,
  cross_check_model text,
  citation_model text,
  sources_attempted integer not null default 0,
  sources_confirmed integer not null default 0,
  distractors_attempted boolean not null default false,
  distractors_succeeded boolean not null default false,
  total_input_tokens integer not null default 0,
  total_output_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 6) not null default 0,
  total_duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_fact_auto_seed_log_fact on public.fact_auto_seed_log(fact_id, created_at desc);
create index idx_fact_auto_seed_log_outcome on public.fact_auto_seed_log(outcome, created_at desc);
create index idx_fact_auto_seed_log_recent on public.fact_auto_seed_log(created_at desc);

-- ---------------------------------------------------------------------------
-- 4. fact_auto_seed_sources — one row per source URL the citation AI proposed
-- ---------------------------------------------------------------------------
create table public.fact_auto_seed_sources (
  id uuid primary key default gen_random_uuid(),
  auto_seed_log_id uuid not null references public.fact_auto_seed_log(id) on delete cascade,
  fact_id uuid not null references public.facts(id) on delete cascade,
  url text not null,
  source_type text not null
    check (source_type in ('wikipedia', 'imdb', 'official_record', 'reference_book', 'other')),
  proposed_excerpt text not null,
  verified_reachable boolean not null,
  excerpt_match boolean not null,
  http_status_code integer,
  fetch_error text,
  fetch_duration_ms integer,
  inserted_into_fact_sources boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_fact_auto_seed_sources_log on public.fact_auto_seed_sources(auto_seed_log_id);
create index idx_fact_auto_seed_sources_fact on public.fact_auto_seed_sources(fact_id, created_at desc);

-- Expression index on URL host for "what domain fails most often" queries
create index idx_fact_auto_seed_sources_host on public.fact_auto_seed_sources(
  (split_part(split_part(split_part(url, '://', 2), '/', 1), '?', 1))
);

-- ---------------------------------------------------------------------------
-- 5. RLS — admin-only on both new tables. Service role bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.fact_auto_seed_log enable row level security;
alter table public.fact_auto_seed_sources enable row level security;

create policy "fact_auto_seed_log_admin_all" on public.fact_auto_seed_log
  for all using (public.is_admin()) with check (public.is_admin());

create policy "fact_auto_seed_sources_admin_all" on public.fact_auto_seed_sources
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. estimate_anthropic_cost — pure-math helper, hardcoded Apr 2026 rates
--    sonnet-4-6:  $3 / $15 per 1M input/output tokens
--    haiku-4-5:   $0.80 / $4 per 1M input/output tokens
--    unknown:     0
-- ---------------------------------------------------------------------------
create or replace function public.estimate_anthropic_cost(
  model text,
  input_tokens int,
  output_tokens int
)
returns numeric
language sql
immutable
as $$
  select round(
    case model
      when 'claude-sonnet-4-6' then
        (coalesce(input_tokens, 0)::numeric * 3.0 + coalesce(output_tokens, 0)::numeric * 15.0) / 1000000.0
      when 'claude-haiku-4-5-20251001' then
        (coalesce(input_tokens, 0)::numeric * 0.80 + coalesce(output_tokens, 0)::numeric * 4.0) / 1000000.0
      else
        0::numeric
    end,
    6
  );
$$;
