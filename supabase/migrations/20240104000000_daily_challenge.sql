create table public.daily_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_date date unique not null,
  category text not null default 'Mixed trivia',
  created_at timestamptz default now()
);

create table public.daily_challenge_completions (
  challenge_id uuid references public.daily_challenges(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  score integer not null,
  correct_count integer not null,
  total_questions integer not null,
  best_streak integer not null,
  completed_at timestamptz default now(),
  primary key (challenge_id, user_id)
);

alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_completions enable row level security;

create policy "daily_challenges_select" on public.daily_challenges
  for select
  to authenticated
  using (true);

create policy "daily_challenge_completions_select" on public.daily_challenge_completions
  for select
  using (auth.uid() = user_id);

create policy "daily_challenge_completions_insert" on public.daily_challenge_completions
  for insert
  with check (auth.uid() = user_id);
