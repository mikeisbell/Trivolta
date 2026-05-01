-- Phase 2.9 Tranche 1 (F2) — In-app feedback channel
-- Persistent capture surface for user feedback submitted via the FAB.
-- All inserts go through the submit-feedback Edge Function (service-role
-- bypass of RLS); there is intentionally no INSERT policy here.

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  screen text not null,
  route_path text,
  app_version text,
  platform text not null check (platform in ('ios', 'android', 'web')),
  state_snapshot jsonb,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz default now() not null
);

create index idx_feedback_reports_created_at on public.feedback_reports (created_at desc);
create index idx_feedback_reports_screen on public.feedback_reports (screen);

alter table public.feedback_reports enable row level security;

-- Admins can read all rows (used by /admin/feedback triage).
create policy "feedback_reports_admin_read" on public.feedback_reports
  for select using (public.is_admin());

-- Users can read their own rows.
create policy "feedback_reports_user_read_own" on public.feedback_reports
  for select using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies. The submit-feedback Edge Function
-- writes via the service-role client (bypasses RLS). This keeps the
-- insert path single and lets the function add validation, throttling,
-- or PII scrubbing later without touching the client.
