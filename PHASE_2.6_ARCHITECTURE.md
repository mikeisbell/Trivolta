# Phase 2.6 — Question Quality Architecture

## Why this phase exists

The current architecture treats AI output as ground truth in a domain (competitive trivia) where ground truth matters more than generation flexibility. This produces ten well-documented failure modes: accuracy gaps, inconsistent answers, ambiguous questions, unstable difficulty, duplication, hallucinated facts, no audit trail, unbounded cost, latency in the hot path, and no quality control loop.

Phase 2.6 separates the **fact** (atomic truth, human-verified) from the **question** (presentation, AI-rendered, cached). AI moves from sole-source-of-truth to a presentation layer over structured data.

Phase 2.6 is a prerequisite for production deploy and beta opening. Phase 3 (production Supabase) is paused until Phase 2.6.8 is complete on local.

---

## Architecture decisions (locked)

| Decision | Choice |
|---|---|
| Verification standard | Cross-referenced (≥2 independent sources required) for all categories |
| Review policy | Full human review of every fact regardless of source — uniform rigor |
| Distractor authoring | Mix — human for high-value facts, AI-cached for long tail |
| Seeding source | Hybrid — public dataset import + AI-assisted custom additions |
| Beta bank size target | 1,500 facts (Path A — ship sooner with deeper vetting) |
| AI usage | Layer above verified facts; never source of truth |
| On-device caching | Yes — MMKV-backed, in scope for this phase |
| Storage backend | Supabase Postgres (no knowledge graph for beta) |
| Admin tooling | Expo Web view inside existing mobile app, gated by admin role claim |
| Phase 3 timing | Production deploy waits until Phase 2.6.8 complete |
| Phase ordering | Parallel-tracked — Claude Code work runs alongside Mike's seeding |

---

## Three-layer model

```
┌──────────────────────────────────────────────────────────┐
│  Layer 3: Game Composer                                   │
│  Selection logic. No AI. Picks facts, applies difficulty   │
│  curve, anti-repetition, personalization weights.          │
└────────────────────────────┬─────────────────────────────┘
                             │ requests N facts
                             ▼
┌──────────────────────────────────────────────────────────┐
│  Layer 2: Question Renderer                                │
│  AI styles fact into question. Cached so identical inputs  │
│  produce identical output. Validation pipeline rejects     │
│  ambiguous or wrong renderings before serving.             │
└────────────────────────────┬─────────────────────────────┘
                             │ reads from
                             ▼
┌──────────────────────────────────────────────────────────┐
│  Layer 1: Fact Bank                                        │
│  Atomic facts. Cross-referenced sources. Human-verified.   │
│  Pre-authored or AI-cached distractors. Source of truth.   │
└──────────────────────────────────────────────────────────┘
```

Hard boundaries: AI never writes to Layer 1 without human approval. Layer 2 cache key is (fact_id, style, difficulty, tone) — same inputs always produce same output. Layer 3 is pure SQL, no AI.

---

## Layer 1 — Fact Bank schema

```sql
-- Categories define verification standards
create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  display_name text not null,
  parent_id uuid references categories(id),
  verification_standard text not null
    check (verification_standard in ('cross-referenced', 'source-cited', 'self-asserted')),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- The atomic unit
create table facts (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) not null,

  fact_text text not null,
  correct_answer text not null,
  answer_aliases text[] default '{}',

  difficulty integer not null check (difficulty between 1 and 5),
  is_high_value boolean default false,

  verification_status text not null
    check (verification_status in ('pending', 'verified', 'rejected', 'flagged')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id),

  created_by uuid references auth.users(id),
  source_origin text not null,
  created_at timestamptz default now()
);

create index idx_facts_category_verified on facts(category_id, verification_status)
  where verification_status = 'verified';
create index idx_facts_difficulty on facts(difficulty);

-- N sources per fact
create table fact_sources (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references facts(id) on delete cascade not null,
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

create index idx_fact_sources_fact on fact_sources(fact_id);

-- Distractors — human-authored or AI-cached
create table distractors (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references facts(id) on delete cascade not null,
  distractor_text text not null,
  authored_by text not null
    check (authored_by in ('human', 'ai-cached', 'imported')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  quality_score integer check (quality_score between 1 and 5),
  is_active boolean default true
);

create index idx_distractors_fact_active on distractors(fact_id) where is_active = true;

-- Player-reported issues
create table fact_reports (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references facts(id) on delete cascade not null,
  reported_by uuid references profiles(id),
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
create table fact_exposures (
  player_id uuid references profiles(id) on delete cascade,
  fact_id uuid references facts(id) on delete cascade,
  last_seen_at timestamptz default now(),
  seen_count integer default 1,
  primary key (player_id, fact_id)
);

create index idx_exposures_player_recent on fact_exposures(player_id, last_seen_at);
```

### Verification rules (enforced by trigger)

```
verification_standard       requirement
─────────────────────       ──────────────────────────────────────────────────
'cross-referenced'          ≥2 fact_sources, both verified_reachable=true,
                            both human_confirmed=true
'source-cited'              ≥1 fact_sources, verified_reachable=true,
                            human_confirmed=true
'self-asserted'             0 sources required (custom user content only)
```

A fact's `verification_status` only flips to `'verified'` when its category's standard is met. Trigger:

```sql
create or replace function check_fact_verification()
returns trigger as $$
declare
  std text;
  source_count int;
begin
  select verification_standard into std from categories where id = new.category_id;

  if new.verification_status = 'verified' then
    select count(*) into source_count
    from fact_sources
    where fact_id = new.id
      and verified_reachable = true
      and human_confirmed = true;

    if std = 'cross-referenced' and source_count < 2 then
      raise exception 'Cross-referenced verification requires ≥2 confirmed sources';
    elsif std = 'source-cited' and source_count < 1 then
      raise exception 'Source-cited verification requires ≥1 confirmed source';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger fact_verification_check
before update on facts
for each row execute function check_fact_verification();
```

### Distractor rules

- High-value fact (`is_high_value = true`): ≥3 distractors with `authored_by IN ('human', 'imported')` AND `reviewed_by IS NOT NULL`
- Long-tail fact (`is_high_value = false`): ≥3 distractors of any `authored_by`. If `'ai-cached'`, must pass Layer 2 validation pipeline.

---

## Layer 2 — Question Renderer

### Purpose
Take a `fact_id` + style parameters, return a fully-formed question ready to display.

### Cache table

```sql
create table question_renderings (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references facts(id) on delete cascade not null,
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

create index idx_renderings_fact on question_renderings(fact_id);
```

### Render logic

```
function render(fact_id, style, difficulty, tone):
  1. Look up question_renderings WHERE fact_id=? AND style=? AND target_difficulty=? AND tone=?
  2. If found AND validated=true: return it
  3. If miss:
     a. Fetch fact + active distractors
     b. If high_value AND has reviewed human distractors: use them
     c. Else if has any active distractors: use them
     d. Else: AI-generate distractors, run distractor-validation, cache them
     e. AI rewords fact_text into question matching style + difficulty + tone
     f. Run rendering-validation
     g. If validation fails: regenerate up to 2x
     h. After 2 failures: mark fact verification_status='flagged', fall back to direct-recall template
     i. Cache the rendering
  4. Return rendering
```

### Validation pipelines

**Distractor validation** (per distractor set):
```
Input: fact, correct_answer, [3 candidate distractors]
Prompt: "Are any of these distractors arguably also correct given the fact?
         Rate ambiguity 1-5 per distractor. Reject set if any score ≥3."
Output: pass/fail + per-distractor scores
```

**Rendering validation** (per generated question):
```
Input: question, answers[4], correct_index, fact, source citations
Prompt: "Does the correct answer match the fact? Is the question phrasing
         unambiguous? Could any other answer also be considered correct?
         Rate overall ambiguity 1-5. Reject if ≥3."
Output: pass/fail + ambiguity score + reason
```

### Why cache forever
Cache key (fact_id, style, difficulty, tone) is deterministic. Fact doesn't change after verification. Renderings have no expiry.

If a fact is corrected or rejected, its renderings are invalidated:
```sql
delete from question_renderings where fact_id = ?;
```

---

## Layer 3 — Game Composer

### Purpose
Pure SQL selection. Pick N facts for a game. No AI in this layer.

### Selection algorithm

```
Input: { player_id, category_id?, count, context, exclude_recent_days }

1. Filter facts:
   - verification_status = 'verified'
   - category_id matches (or any)
   - id NOT IN (player's fact_exposures from last N days)
   - has ≥3 active distractors

2. Apply difficulty curve based on context:
   - solo: 2 easy, 3 medium, 3 hard, 2 expert (matched to streak)
   - lobby: 3 easy, 4 medium, 3 hard
   - daily_challenge: 2 easy, 4 medium, 3 hard, 1 expert (fixed curve)

3. Apply personalization weights (post-launch only):
   - boost categories with high accuracy + engagement
   - downweight previously-skipped categories

4. Random sample respecting weights

5. For each picked fact, request render() from Layer 2
```

### Anti-repetition window
- Default exclusion: facts seen in last 30 days
- Tunable per category (e.g., niche categories may need 90-day exclusion)
- After-game: batch insert into `fact_exposures` (one round-trip, not per-question)

---

## On-device caching (MMKV)

### Why MMKV
- Faster than AsyncStorage
- Encryption support out of the box (addresses cheating risk)
- Modern React Native default
- One additional dependency: `react-native-mmkv`

### Cache layers

**Layer A — Question pack (encrypted)**
- Pre-fetched in background after login or app foreground
- 100 questions per active category, ~80 KB each = ~1 MB total
- Refresh trigger: cache age >24 hrs OR remaining unused < 20
- Cache hit on game start: 0 server calls, instant launch
- Encryption key: derived from user session token (rotates on logout)

**Layer B — Profile/leaderboard cache**
- User stats: 5 min TTL, invalidate on game completion
- Leaderboard top 50: 60 sec TTL
- Daily challenge metadata: TTL until midnight UTC
- Recent fact_exposures: synced from server, used for client-side filtering
- Total: ~25 KB

**Layer C — HTTP response cache**
- Cache-Control headers on Edge Function responses
- Native fetch cache handles category list, trending topics
- System-managed, no app-side code

### Total on-device footprint: ~1-2 MB

### Cache invalidation events
| Event | Invalidates |
|---|---|
| Game completion | Layer B profile, leaderboard |
| Daily challenge completion | Layer B daily challenge, profile |
| User reports a fact | Layer A pack containing that fact |
| Cache age > 24 hrs | Layer A pack for that category |
| User logout | All caches |

### Cheating risk for Layer A
- Encrypted with session-derived key prevents casual snooping
- correct_index IS in the pack (required for offline answering)
- Sophisticated reverse-engineering still possible but high-effort, low-reward for casual trivia
- Acceptable for beta. Revisit if real prizes are introduced.

---

## Edge Function inventory

### New
| Function | Purpose | JWT auth | Notes |
|---|---|---|---|
| `compose-game` | Layer 3 entrypoint, returns 10 rendered questions | Yes | Replaces solo-question |
| `compose-lobby-game` | Layer 3 batch for lobbies | Yes | Replaces generate-questions |
| `render-question` | Layer 2, single fact → rendered question | Yes (admin or service) | Internal mostly |
| `fact-bank-import` | Bulk import from JSON/CSV | Admin only | Seeding tool |
| `fact-bank-validate-source` | AI source citation + URL reachability | Admin only | Seeding tool |
| `fact-bank-search` | Admin search/filter | Admin only | Powers admin UI |
| `report-fact` | Player reports a question | Yes | RLS insert into fact_reports |

### Modified
| Function | Change |
|---|---|
| `daily-challenge` | Internally calls `compose-game` for question selection |
| `create-lobby` | Unchanged |
| `join-lobby` | Unchanged |

### Deprecated (removed after cutover)
- `solo-question` — superseded by `compose-game`
- `generate-questions` — superseded by `compose-lobby-game`

### Auth pattern (all of them)
- `--no-verify-jwt` deploy flag (per existing CLAUDE.md rule)
- `Authorization` header check + `auth.getUser()` in code
- `apikey` header read pattern with env fallback (per existing CLAUDE.md rule)
- Admin functions check role claim: `auth.user.app_metadata.role === 'admin'`

---

## Admin tooling

Required, not optional. Without it, seeding 1,500 facts is infeasible.

### Approach
**Expo Web view inside the existing mobile app**, gated by admin role claim. Reuses existing components and auth.

Why Expo Web over a separate Next.js app:
- Reuses existing Supabase auth, session refresh, RLS-aware queries (saves ~1-2 days of duplicate work)
- Reuses existing theme and component library
- Single deploy pipeline (EAS for iOS, Expo Web export for admin)
- Functional > polished — admin UI is for one user (Mike)
- Migrate to Next.js later if and only if friction emerges (5+ routes, charts, non-developer reviewers)

Mike opens `localhost:8081/admin` (dev) or `trivolta.app/admin` (post-prod-deploy) in a browser. Admin role claim gates access.

### Routes
| Route | Purpose |
|---|---|
| `/admin/facts` | List, search, filter, paginate; coverage gaps by category |
| `/admin/facts/queue` | Pending facts in priority order |
| `/admin/facts/[id]` | Review one fact: sources, distractors, approve/reject |
| `/admin/facts/import` | Paste/upload OpenTrivia DB JSON or CSV |
| `/admin/sources/cite` | AI-assisted source citation queue |
| `/admin/distractors/generate` | Bulk AI-distractor generation |
| `/admin/reports` | Player-reported issues triage |
| `/admin/coverage` | Category coverage dashboard |

### AI-assisted source citation flow
For each fact missing sources:
1. Admin opens fact in `/admin/sources/cite`
2. AI proposes 2-3 source URLs with quoted excerpts
3. Backend validates each URL is reachable AND the excerpt actually appears at that URL (mechanical check, no LLM trust)
4. Admin reviews proposed sources, approves or rejects
5. On approval: `fact_sources` row inserted with `human_confirmed=true`
6. When ≥2 confirmed sources accumulate (cross-referenced category), fact auto-promotes to `verification_status='verified'`

### Throughput target
With this tooling, per-fact verification time drops from ~2 min (manual) to ~1 min (AI-cited + confirm). 1,500 facts × ~2 min average (full review of every fact, regardless of source) = ~50 hours of Mike's time over 3-4 weeks.

---

## Cost projections

### Per-call cost (Sonnet 4.5: $3/M input, $15/M output)
| Call | Cost |
|---|---|
| Question render | $0.0038 |
| Render validation | $0.0027 |
| Distractor generation | $0.0042 |
| Distractor validation | $0.0033 |
| Source citation | $0.0069 |
| **Average** | **~$0.004** |

### Beta-month total
- Seeding: 1,500 facts × ~5 calls each = ~7,500 calls = **~$30**
- Live gameplay (5% cache miss): ~375 calls = **~$1.50**
- Admin tooling overhead: ~$5
- **Total: ~$35 (mostly one-time seeding)**

### Steady-state monthly (post-launch)
- Mostly cache hits, occasional new fact rendering
- 200 new facts/month seeding: ~$5
- Live cache fills: ~$5
- **Total: ~$10/month at <1k DAU**

### Comparison to current architecture
| | Current | New |
|---|---|---|
| Beta month | ~$10 | ~$35 (one-time) |
| Steady at 1k DAU | ~$300/month | ~$10/month |
| Steady at 10k DAU | ~$3,000/month | ~$30/month |

Phase 2.6 pays back in ~2 months at any meaningful scale.

---

## DAU ceiling impact

| Configuration | DAU ceiling | Limiting factor |
|---|---|---|
| Current arch, no caching | ~2,000 | Edge Function invocations + Anthropic cost |
| Phase 2.6 server-cache only | ~7,000 | Edge Function invocations |
| Phase 2.6 + on-device cache | ~30,000 | Realtime concurrent connections (lobby only) |
| Phase 2.6 + Supabase Pro | ~50,000+ | Postgres write throughput |

---

## Code-level fixes folded into Phase 2.6

These were identified in the existing codebase. They get fixed as part of the migration since most of the affected code is being replaced anyway.

| Issue | Severity | Fix location |
|---|---|---|
| `fetchUserStats` pulls full leaderboard to compute rank | High | New RPC `get_user_rank(user_id)` returning a single row |
| `fetchLobbyResults` does N sequential queries | Medium | New view or RPC `lobby_final_standings(lobby_id)` |
| `solo-question` retries with no backoff | Medium | Replaced by `compose-game` with proper retry policy |
| Per-question Edge Function call pattern | High (UX) | `compose-game` returns all 10 upfront |
| Request deduplication (double-tap → 2 calls) | Low | Client-side in-flight guard in `lib/api.ts` |
| Realtime subscription teardown leaks | Low | Audit lobby screens, ensure cleanup in useEffect returns |
| `saveScore` is fire-and-forget | Low | Add minimal error toast; defer full retry to post-beta |

---

## Phased rollout (parallel-tracked)

Seeding (Phase 2.6.3) is the longest single sub-phase at ~50 hours of Mike's time spread over 3 weeks. To minimize calendar time, Claude Code work runs in parallel with seeding once the schema and admin tooling exist.

```
Week 1
├─ Phase 2.6.1 (Schema + admin tooling shell) — Claude Code
└─ Phase 2.6.2 (Import + AI source citation)  — Claude Code, starts mid-week 1

Weeks 2–4
├─ Phase 2.6.3 (Seeding to 1,500 facts)        — Mike, ~50 hrs over 3 weeks
├─ Phase 2.6.4 (Render + Compose Edge Funcs)  — Claude Code, week 2
├─ Phase 2.6.5 (Mobile integration + cutover)  — Claude Code, week 3
├─ Phase 2.6.6 (On-device caching)             — Claude Code, week 3
└─ Phase 2.6.7 (Code-level fixes)              — Claude Code, week 4

Week 5
└─ Phase 2.6.8 (Validation + soak test)        — both, ~1 week

THEN
├─ INSTRUCTIONS_PRODUCTION_SUPABASE.md         — Phase 3
├─ INSTRUCTIONS_EAS_BUILD.md                   — Phase 3
└─ TestFlight beta opens
```

**Critical insight:** Phase 2.6.3 (Mike's hands-on seeding) does not block Phases 2.6.4 through 2.6.7 (Claude Code work). Both proceed in parallel once Phase 2.6.1 + 2.6.2 are done. Phase 2.6.8 (validation) requires both seeding to be complete (≥1,500 facts in bank) AND all Claude Code work to be merged.

### Phase 2.6.1 — Schema + admin tooling shell (1 week)
- Migrations: categories, facts, fact_sources, distractors, fact_reports, fact_exposures, question_renderings
- Verification trigger
- Admin role claim + RLS policies
- `/admin/*` route shells (Expo Web view, gated, empty pages with navigation)
- INSTRUCTIONS file: `INSTRUCTIONS_PHASE_2.6.1_SCHEMA_AND_ADMIN.md`
- Verifiable objective: schema migrations applied to local Supabase, admin role claim works, Mike can navigate to `localhost:8081/admin/facts` and see an empty list

### Phase 2.6.2 — Import + AI source citation (3-4 days, mid-week 1)
- `fact-bank-import` Edge Function
- `fact-bank-validate-source` Edge Function with URL reachability + excerpt-match check
- OpenTrivia DB importer script
- `/admin/sources/cite` UI (functional)
- `/admin/facts/import` UI (functional)
- INSTRUCTIONS file: `INSTRUCTIONS_PHASE_2.6.2_IMPORT_AND_SOURCING.md`
- Verifiable objective: Mike can paste OpenTrivia DB JSON into `/admin/facts/import` and see facts land in `pending` state; can open one in `/admin/sources/cite`, get AI-proposed sources, mechanically validate, and approve

### Phase 2.6.3 — Seeding to 1,500 facts (~50 hrs Mike's time, weeks 2-4)
- Mike's hands-on review, approve, gap-fill
- Coverage targets per category (defined in Phase 2.6.1 INSTRUCTIONS)
- No INSTRUCTIONS file — this is Mike's curation work
- Verifiable objective: ≥1,500 facts in `verification_status = 'verified'` state, distributed across categories per coverage targets

### Phase 2.6.4 — Render + Compose Edge Functions (1 week, week 2 in parallel with seeding)
- `render-question` with both validation pipelines
- `compose-game` and `compose-lobby-game`
- Modify `daily-challenge` to call `compose-game`
- Maestro tests updated for new endpoints (where seeding has provided enough facts)
- INSTRUCTIONS file: `INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md`
- Verifiable objective: a curl against `compose-game` returns 10 rendered questions when bank has enough verified facts in target category

### Phase 2.6.5 — Mobile integration + cutover (3-4 days, week 3)
- Replace `lib/api.ts` calls to `solo-question` / `generate-questions` with `compose-game` / `compose-lobby-game`
- Add `/report` UI on QuestionScreen and LobbyGameScreen
- Update Maestro tests (mostly drop-in replacements)
- Deprecate old Edge Functions (keep deployed locally, stop calling)
- INSTRUCTIONS file: `INSTRUCTIONS_PHASE_2.6.5_MOBILE_CUTOVER.md`
- Verifiable objective: solo and lobby games run end-to-end against new architecture in iOS Simulator; report button opens functional report flow

### Phase 2.6.6 — On-device caching (3 days, week 3)
- MMKV integration
- Layer A: question pack pre-fetch + encrypted storage
- Layer B: profile/leaderboard/daily-challenge caching
- Cache invalidation hooks
- INSTRUCTIONS file: `INSTRUCTIONS_PHASE_2.6.6_DEVICE_CACHING.md`
- Verifiable objective: with airplane mode on (after one online warmup), solo game still loads first 10 questions from device cache; profile and leaderboard render from cache

### Phase 2.6.7 — Code-level fixes (2 days, week 4)
- `get_user_rank` RPC
- `lobby_final_standings` RPC
- Request deduplication in `api.ts`
- Realtime subscription teardown audit
- Score-save error UI
- INSTRUCTIONS file: `INSTRUCTIONS_PHASE_2.6.7_CODE_FIXES.md`
- Verifiable objective: profile screen rank query returns in <100ms regardless of total user count; double-tapping a category fires only one Edge Function call

### Phase 2.6.8 — Validation + soak test (1 week, week 5)
- Full Maestro suite green on new architecture
- Manual playtesting across all categories on iOS Simulator
- Cost telemetry verified (cache hit rate ≥90% after warmup)
- Cache hit rate measured per category
- Final review of `PHASE_2.6_ARCHITECTURE.md` against shipped code
- No INSTRUCTIONS file — this is verification work
- Verifiable objective: 25/25 Maestro tests pass + manual playthroughs of all 10 categories show no Sev 1 or Sev 2 issues + cache hit rate documented

### Total calendar: ~5 weeks
- Mike's hands-on: ~60 hrs total (50 hrs seeding + 10 hrs reviews/testing)
- Claude Code: ~3-4 weeks of work, mostly autonomous

---

## What this gives you

| Concern from your list | Resolution |
|---|---|
| 1. Accuracy failures | All facts cross-referenced (≥2 sources), full human review |
| 2. Inconsistent answers | Cache key is deterministic; same fact + style = same question forever |
| 3. Ambiguous questions | Validation pipeline rejects ambiguous renderings (score ≥3 = reject) |
| 4. Difficulty instability | Per-fact difficulty rating set during human review, not inferred by AI at render time |
| 5. Duplicate content | `fact_exposures` table excludes recent facts per player |
| 6. Hallucinated facts | AI never writes to Layer 1; renders only from human-verified facts |
| 7. No audit trail | Every fact has sources; every rendering links to fact_id; every report links back |
| 8. Cost scaling | Cache hit rate ~95% means cost flatlines instead of growing with DAU |
| 9. Latency issues | Hot path is DB read only — no AI round-trip during gameplay |
| 10. Weak quality control | Admin tooling + reports + validation pipelines + human review gate |

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Seeding takes longer than 50 hrs | Cut beta to 8 categories instead of 10; ship narrower |
| AI source-citation hallucinates URLs | Mechanical URL-reachability + excerpt-match check; never trust unvalidated AI sources |
| Cache poisoning if a verified fact is later wrong | `fact_reports` flow + admin invalidation + cascade delete on `question_renderings` |
| Migration breaks existing Maestro tests | Run full suite after each sub-phase; sub-phases are independently verifiable |
| Encrypted cache key compromise | Session-derived key rotates on logout; impact bounded to single device |
| MMKV adds native module dependency | Test on both iOS and Android Simulator before adopting |
| Phase 2.6.4 starts before bank has facts | Bootstrap with ~50 manually-seeded facts in 2.6.1 to unblock Edge Function dev |

---

## What's NOT in this phase

- Knowledge graph (Postgres-only for beta; revisit at 50k+ facts)
- Personalization engine (selection weights are stubs in Phase 2.6; activate post-launch with real play data)
- Themed packs / battle royale / event quizzes (post-launch content expansion)
- Tone variation (`'playful'` is in schema but only `'serious'` used in beta)
- Push notifications on report status
- Server-side achievement events
- Android testing parity (iOS-first, per current Trivolta scope)
- Production deploy (waits for Phase 2.6.8 complete; covered by `INSTRUCTIONS_PRODUCTION_SUPABASE.md`)
- EAS Build / TestFlight (Phase 3, separate INSTRUCTIONS file)

---

## Open questions

None — all major architectural decisions are locked. Ready to write `INSTRUCTIONS_PHASE_2.6.1_SCHEMA_AND_ADMIN.md`.
