#!/usr/bin/env bash
# collect-f1-quality-data.sh
#
# Read-only data dump for Mac Claude's F1 quality analysis. Runs six
# queries against the local Supabase Postgres container and writes the
# combined output to F1_QUALITY_DATA.txt at repo root.
#
# Usage:
#   ./collect-f1-quality-data.sh
#
# Local-only. No DML. Re-runnable.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

DB_CONTAINER='supabase_db_Trivolta'
OUT_FILE="$REPO_ROOT/F1_QUALITY_DATA.txt"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres <<'SQL' > "$OUT_FILE"
\pset pager off

\echo === QUERY 1: Quality score distribution (active ai-cached) ===
select quality_score,
       count(*)        as rows,
       count(*) / 3    as facts
from public.distractors
where authored_by = 'ai-cached'
  and is_active = true
group by quality_score
order by quality_score;

\echo
\echo === QUERY 2: Pre/post distractor row totals reconciliation ===
select authored_by, is_active, count(*)
from public.distractors
group by authored_by, is_active
order by 1, 2;

\echo
\echo === QUERY 3: Distractor text length comparison ===
select authored_by,
       count(*)                                                  as n,
       round(avg(length(distractor_text))::numeric, 2)           as avg_len,
       min(length(distractor_text))                              as min_len,
       max(length(distractor_text))                              as max_len,
       round(stddev(length(distractor_text))::numeric, 2)        as stddev_len
from public.distractors
where (authored_by = 'imported'  and is_active = false)
   or (authored_by = 'ai-cached' and is_active = true)
group by authored_by
order by authored_by;

\echo
\echo === QUERY 4: Pairwise text overlap (deactivated-imported vs active-ai-cached on same fact_id) ===
with pairs as (
  select i.fact_id,
         i.distractor_text as old_text,
         a.distractor_text as new_text
  from public.distractors i
  join public.distractors a on a.fact_id = i.fact_id
  where i.authored_by = 'imported'  and i.is_active = false
    and a.authored_by = 'ai-cached' and a.is_active = true
)
select count(*) as total_pairs,
       count(*) filter (where lower(old_text) = lower(new_text))
         as exact_dupes_ci,
       count(*) filter (
         where lower(old_text) <> lower(new_text)
           and (
             position(lower(old_text) in lower(new_text)) > 0
             or position(lower(new_text) in lower(old_text)) > 0
           )
       ) as substring_overlap_ci,
       count(*) filter (
         where length(old_text) >= 3
           and length(new_text) >= 3
           and lower(substring(old_text from 1 for 3))
             = lower(substring(new_text from 1 for 3))
       ) as shared_3_leading_ci
from pairs;

\echo
\echo === QUERY 5: 10 random regenerated facts (imported vs ai-cached side-by-side) ===
\x on
with sampled as (
  select f.id, f.fact_text, f.correct_answer
  from public.facts f
  where exists (
    select 1 from public.distractors d
    where d.fact_id = f.id
      and d.authored_by = 'ai-cached'
      and d.is_active = true
  )
  order by random()
  limit 10
)
select s.fact_text,
       s.correct_answer,
       (select string_agg(distractor_text, ' | ' order by distractor_text)
        from public.distractors
        where fact_id = s.id
          and authored_by = 'imported'
          and is_active = false)                 as imported_distractors_old,
       (select string_agg(distractor_text, ' | ' order by distractor_text)
        from public.distractors
        where fact_id = s.id
          and authored_by = 'ai-cached'
          and is_active = true)                  as ai_cached_distractors_new,
       (select max(quality_score)
        from public.distractors
        where fact_id = s.id
          and authored_by = 'ai-cached'
          and is_active = true)                  as quality_score
from sampled s;
\x off

\echo
\echo === QUERY 6: 10 random validation_failed facts (Haiku could not regenerate; imported still active) ===
\x on
with sampled as (
  select f.id, f.fact_text, f.correct_answer
  from public.facts f
  where f.source_origin = 'trivia_api_import'
    and f.is_high_value = false
    and not exists (
      select 1 from public.distractors d
      where d.fact_id = f.id
        and d.authored_by = 'ai-cached'
        and d.is_active = true
    )
  order by random()
  limit 10
)
select s.fact_text,
       s.correct_answer,
       (select string_agg(distractor_text, ' | ' order by distractor_text)
        from public.distractors
        where fact_id = s.id
          and authored_by = 'imported'
          and is_active = true)                  as imported_distractors_active
from sampled s;
\x off
SQL

echo "Wrote $OUT_FILE"
