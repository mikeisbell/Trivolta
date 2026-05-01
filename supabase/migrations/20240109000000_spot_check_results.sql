-- Phase 2.9 Tranche 1 (F3) — Manual fact spot-check audit table + RPC
-- Records each admin's correct/incorrect verdict on a fact during the
-- pre-beta manual review pass. All inserts go through the
-- submit-spot-check Edge Function (service-role bypass of RLS).

create table public.spot_check_results (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.facts(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  verdict text not null check (verdict in ('correct', 'incorrect')),
  note text check (note is null or (length(trim(note)) between 1 and 2000)),
  category_slug text not null,
  reviewed_at timestamptz default now() not null,
  unique (fact_id, reviewer_id)
);

create index idx_spot_check_results_reviewed_at on public.spot_check_results (reviewed_at desc);
create index idx_spot_check_results_verdict on public.spot_check_results (verdict);

alter table public.spot_check_results enable row level security;

-- Admins read all rows.
create policy "spot_check_admin_read" on public.spot_check_results
  for select using (public.is_admin());

-- Reviewers read their own rows.
create policy "spot_check_reviewer_read_own" on public.spot_check_results
  for select using (auth.uid() = reviewer_id);

-- No INSERT/UPDATE/DELETE policies. The submit-spot-check Edge Function
-- writes via the service-role client (bypasses RLS). Same posture as F2.

-- ---------------------------------------------------------------------------
-- get_next_spot_check_fact()
--
-- Returns one random unreviewed fact for the calling admin, weighted so
-- categories with fewer existing reviews come up more often.
--
-- Eligibility:
--   - verification_status in ('pending', 'verified')
--   - NOT already in spot_check_results for this reviewer
--   - has >= 3 active distractors
--
-- Stratification: pick the category slug with the smallest count of
-- spot_check_results by this reviewer, ties broken randomly. From that
-- category, pick a random qualifying fact.
--
-- SECURITY DEFINER + internal is_admin() check so any authenticated
-- caller can invoke it but only admins get rows back.
-- ---------------------------------------------------------------------------
create or replace function public.get_next_spot_check_fact()
returns table (
  id uuid,
  fact_text text,
  correct_answer text,
  difficulty int,
  category_slug text,
  category_display_name text,
  distractors text[]
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  picked_category_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  -- Pick the category that this reviewer has spot-checked the least so
  -- far, restricted to categories that still have eligible facts.
  -- Random tie-break.
  with eligible_facts as (
    select f.id as fact_id, f.category_id
    from public.facts f
    where f.verification_status in ('pending', 'verified')
      and not exists (
        select 1 from public.spot_check_results scr
        where scr.fact_id = f.id and scr.reviewer_id = auth.uid()
      )
      and (
        select count(*) from public.distractors d
        where d.fact_id = f.id and d.is_active = true
      ) >= 3
  ),
  cat_counts as (
    select c.id as category_id,
           coalesce((
             select count(*) from public.spot_check_results scr
             join public.facts f2 on f2.id = scr.fact_id
             where scr.reviewer_id = auth.uid()
               and f2.category_id = c.id
           ), 0) as reviewed_count
    from public.categories c
    where exists (select 1 from eligible_facts ef where ef.category_id = c.id)
  )
  select cc.category_id into picked_category_id
  from cat_counts cc
  order by cc.reviewed_count asc, random()
  limit 1;

  if picked_category_id is null then
    return;
  end if;

  return query
  select f.id,
         f.fact_text,
         f.correct_answer,
         f.difficulty,
         c.slug as category_slug,
         c.display_name as category_display_name,
         (
           select array_agg(d.distractor_text)
           from public.distractors d
           where d.fact_id = f.id and d.is_active = true
         ) as distractors
  from public.facts f
  join public.categories c on c.id = f.category_id
  where f.category_id = picked_category_id
    and f.verification_status in ('pending', 'verified')
    and not exists (
      select 1 from public.spot_check_results scr
      where scr.fact_id = f.id and scr.reviewer_id = auth.uid()
    )
    and (
      select count(*) from public.distractors d
      where d.fact_id = f.id and d.is_active = true
    ) >= 3
  order by random()
  limit 1;
end;
$$;

grant execute on function public.get_next_spot_check_fact() to authenticated;
