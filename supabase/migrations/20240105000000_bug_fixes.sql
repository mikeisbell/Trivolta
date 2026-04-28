-- 1a — create_game_session RPC: server-authoritative starts_at
create or replace function public.create_game_session(
  p_lobby_id uuid,
  p_question_index integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_starts_at timestamptz;
begin
  insert into public.game_sessions (lobby_id, question_index, starts_at)
  values (p_lobby_id, p_question_index, now() + interval '2 seconds')
  returning starts_at into v_starts_at;
  return v_starts_at;
end;
$$;

revoke all on function public.create_game_session(uuid, integer) from public;
grant execute on function public.create_game_session(uuid, integer) to authenticated;

-- 1b — score column on lobby_answers
alter table public.lobby_answers
  add column if not exists score integer not null default 0;

-- 1c — Tighten lobby_questions RLS to lobby members
drop policy if exists "lobby_questions_read" on public.lobby_questions;
create policy "lobby_questions_members_read" on public.lobby_questions
  for select using (
    exists (
      select 1 from public.lobby_players lp
      where lp.lobby_id = lobby_questions.lobby_id
        and lp.user_id = auth.uid()
    )
  );

-- 1d — Tighten lobby_answers RLS to lobby members
drop policy if exists "lobby_answers_read" on public.lobby_answers;
create policy "lobby_answers_members_read" on public.lobby_answers
  for select using (
    exists (
      select 1 from public.lobby_players lp
      where lp.lobby_id = lobby_answers.lobby_id
        and lp.user_id = auth.uid()
    )
  );

-- 1e — Indexes
create index if not exists scores_user_id_idx on public.scores(user_id);
create index if not exists scores_played_at_idx on public.scores(played_at desc);
create index if not exists lobby_players_joined_idx on public.lobby_players(lobby_id, joined_at);

-- 1f — get_leaderboard RPC
create or replace function public.get_leaderboard(period text)
returns table (
  id uuid,
  username text,
  avatar_url text,
  total_score bigint,
  games_played bigint,
  rank bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
begin
  if period = 'week' then
    v_since := now() - interval '7 days';
  elsif period = 'month' then
    v_since := now() - interval '30 days';
  else
    v_since := 'epoch'::timestamptz;
  end if;

  return query
    select
      p.id,
      p.username,
      p.avatar_url,
      sum(s.score)::bigint as total_score,
      count(s.id)::bigint as games_played,
      rank() over (order by sum(s.score) desc) as rank
    from public.profiles p
    join public.scores s on s.user_id = p.id
    where s.played_at >= v_since
    group by p.id, p.username, p.avatar_url
    order by total_score desc
    limit 50;
end;
$$;

revoke all on function public.get_leaderboard(text) from public;
grant execute on function public.get_leaderboard(text) to authenticated;
