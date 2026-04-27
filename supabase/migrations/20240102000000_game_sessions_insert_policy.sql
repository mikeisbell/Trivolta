-- Allow authenticated users to insert game_sessions (host creates session for each question)
create policy "game_sessions_insert" on public.game_sessions
  for insert
  with check (auth.role() = 'authenticated');
