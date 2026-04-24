-- Users (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  total_score integer default 0,
  best_streak integer default 0,
  games_played integer default 0,
  created_at timestamptz default now()
);

-- Solo game scores
create table public.scores (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  category text not null,
  score integer not null,
  correct_count integer not null,
  total_questions integer not null,
  best_streak integer not null,
  played_at timestamptz default now()
);

-- Lobbies
create table public.lobbies (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  host_id uuid references public.profiles(id) not null,
  category text not null,
  status text default 'waiting' check (status in ('waiting', 'active', 'finished')),
  max_players integer default 8,
  created_at timestamptz default now()
);

-- Lobby players
create table public.lobby_players (
  lobby_id uuid references public.lobbies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (lobby_id, user_id)
);

-- Questions for a lobby game (generated once before game start)
create table public.lobby_questions (
  id uuid default gen_random_uuid() primary key,
  lobby_id uuid references public.lobbies(id) on delete cascade not null,
  question_index integer not null,
  question text not null,
  answers jsonb not null,
  correct_index integer not null,
  explanation text not null,
  difficulty text not null,
  unique (lobby_id, question_index)
);

-- Game session timing (server-authoritative timestamps)
create table public.game_sessions (
  id uuid default gen_random_uuid() primary key,
  lobby_id uuid references public.lobbies(id) on delete cascade not null,
  question_index integer not null,
  starts_at timestamptz not null,
  unique (lobby_id, question_index)
);

-- Player answers in lobby games
create table public.lobby_answers (
  lobby_id uuid references public.lobbies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  question_index integer not null,
  answer_index integer not null,
  answered_at timestamptz default now(),
  primary key (lobby_id, user_id, question_index)
);

-- RLS
alter table public.profiles enable row level security;
alter table public.scores enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_players enable row level security;
alter table public.lobby_questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.lobby_answers enable row level security;

create policy "profiles_read_all" on public.profiles for select using (true);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

create policy "scores_read_all" on public.scores for select using (true);
create policy "scores_insert_own" on public.scores for insert with check (auth.uid() = user_id);

create policy "lobbies_read" on public.lobbies for select using (auth.role() = 'authenticated');
create policy "lobbies_insert" on public.lobbies for insert with check (auth.uid() = host_id);
create policy "lobbies_update_host" on public.lobbies for update using (auth.uid() = host_id);

create policy "lobby_players_read" on public.lobby_players for select using (auth.role() = 'authenticated');
create policy "lobby_players_insert" on public.lobby_players for insert with check (auth.uid() = user_id);

create policy "lobby_questions_read" on public.lobby_questions for select using (auth.role() = 'authenticated');
create policy "game_sessions_read" on public.game_sessions for select using (auth.role() = 'authenticated');

create policy "lobby_answers_read" on public.lobby_answers for select using (auth.role() = 'authenticated');
create policy "lobby_answers_insert" on public.lobby_answers for insert with check (auth.uid() = user_id);

-- Leaderboard view (top 50, last 30 days)
create view public.leaderboard as
  select
    p.id,
    p.username,
    p.avatar_url,
    sum(s.score) as total_score,
    count(s.id) as games_played
  from public.profiles p
  join public.scores s on s.user_id = p.id
  where s.played_at > now() - interval '30 days'
  group by p.id, p.username, p.avatar_url
  order by total_score desc
  limit 50;
