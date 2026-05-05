-- Beta-only: allow authenticated users to read facts regardless of verification_status.
-- The original policy gated reads on verification_status = 'verified', which made sense
-- when facts were ingested from arbitrary AI-authored sources. For beta, all facts come
-- from OpenTrivia DB (a vetted, commercially-licensed source) and remain status='pending'
-- because Trivolta's own verification pipeline (fact_sources confirmations) does not
-- apply to externally-vetted imports.
--
-- TODO(post-beta): Restore the verification gate before opening to non-beta users, OR
-- decide on a permanent verification model for externally-imported facts. The original
-- policy was:
--
--   create policy "facts_read_verified" on public.facts
--     for select using (
--       auth.role() = 'authenticated' and verification_status = 'verified'
--     );
--
-- See TRIVOLTA_TRACKER.md → "Post-Beta Restoration" for tracking.

drop policy if exists "facts_read_verified" on public.facts;

create policy "facts_read_authenticated" on public.facts
  for select using (auth.role() = 'authenticated');

-- The distractors read policy gates on the parent fact being status='verified'
-- via an EXISTS subquery; with the facts policy relaxed but the distractors
-- policy unchanged, distractor reads still return empty for pending facts and
-- the user-JWT path can't assemble a 4-answer question. Relaxing in lockstep.
--
-- TODO(post-beta): Restore alongside the facts policy. Original predicate:
--
--   create policy "distractors_read_active_verified" on public.distractors
--     for select using (
--       auth.role() = 'authenticated'
--       and is_active = true
--       and exists (
--         select 1 from public.facts f
--         where f.id = distractors.fact_id
--           and f.verification_status = 'verified'
--       )
--     );

drop policy if exists "distractors_read_active_verified" on public.distractors;

create policy "distractors_read_active_authenticated" on public.distractors
  for select using (
    auth.role() = 'authenticated'
    and is_active = true
  );
