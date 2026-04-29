# Trivolta — System Architecture

The end-to-end design of Trivolta as of Phase 2.6 in progress. Written for anyone — future Claude session, future contributor, or future Mike with stale context — who needs to understand how the system fits together without reading every migration file and Edge Function from scratch.

For phase-by-phase progress, see `TRIVOLTA_TRACKER.md`. For operational rules and gotchas (auth pattern, Maestro quirks, admin role setup), see `CLAUDE.md`. For the two-Claude development process, see `WORKFLOW.md`. For the Phase 2.6 design specifically, see `PHASE_2.6_ARCHITECTURE.md`.

This document is the top-level system view. It is updated when the architecture changes, not when a feature ships.

---

## What Trivolta is

A real-time multiplayer trivia mobile app. iOS-first, Android target after launch. Players play solo against AI-generated questions, compete in synchronous lobby games of up to 8 players, attempt a daily challenge that resets at midnight UTC, and climb leaderboards. The app is closed-source, single-developer, in pre-beta as of this writing.

The interesting product bet: **questions are not pre-authored**. Phase 1–2 generated each question on-demand from an AI model. Phase 2.6 changes that to a layered architecture — facts are human-verified once, AI renders them into questions on demand, renderings are cached. The bet is that this gets the freshness and breadth of AI generation with the trustworthiness of curated content, at a fraction of the steady-state cost.

---

## System diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          MOBILE CLIENT                          │
│  React Native + Expo Router (iOS Simulator / TestFlight / Web)  │
│                                                                 │
│  Screens (tabs)         Screens (modal/stack)    Admin (web)    │
│  • Home                 • Question (solo)        • /admin/*     │
│  • Play                 • Result                   (Phase 2.6)  │
│  • Leaderboard          • Custom Category                       │
│  • Profile              • Lobby Create/Join/Wait/Game/Result    │
│  • Auth                                                         │
│                                                                 │
│  Lib                                                            │
│  • supabase.ts (client)  • auth.tsx (context, isAdmin)         │
│  • api.ts (Edge Function calls)  • theme.ts  • scoring.ts      │
│  • gameHistory.ts  • types.ts                                  │
└────────────────┬───────────────────────────────────┬────────────┘
                 │                                   │
                 │ HTTPS + Authorization+apikey     │ WebSocket
                 │ headers (sb_publishable_*)       │ (Realtime
                 ▼                                   │  subscriptions)
┌─────────────────────────────────────────────────────┴───────────┐
│                       SUPABASE PLATFORM                         │
│                                                                 │
│  ┌────────────────────────┐    ┌──────────────────────────────┐ │
│  │   AUTH (GoTrue)        │    │   REALTIME                   │ │
│  │   • Email/password     │    │   • Postgres CDC → WS        │ │
│  │   • JWT (ES256)        │    │   • Lobby subscriptions      │ │
│  │   • app_metadata.role  │    │   • 200/500 concurrent cap   │ │
│  └────────────────────────┘    └──────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     POSTGRES                               │ │
│  │  Identity:   profiles                                      │ │
│  │  Gameplay:   scores, daily_challenges,                     │ │
│  │              daily_challenge_completions                   │ │
│  │  Lobby:      lobbies, lobby_players, lobby_questions,     │ │
│  │              game_sessions, lobby_answers                  │ │
│  │  Fact bank:  categories, facts, fact_sources, distractors,│ │
│  │              fact_reports, fact_exposures,                 │ │
│  │              question_renderings                           │ │
│  │  RLS on every table. Triggers enforce verification rules. │ │
│  │  Views: leaderboard. RPCs: get_leaderboard,               │ │
│  │  create_game_session, is_admin().                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │           EDGE FUNCTIONS (Deno, --no-verify-jwt)           │ │
│  │  Gameplay (current):  solo-question, generate-questions,   │ │
│  │                       create-lobby, join-lobby,            │ │
│  │                       daily-challenge                      │ │
│  │  Fact bank (Phase 2.6.2): fact-bank-import,               │ │
│  │                       fact-bank-validate-source,           │ │
│  │                       fact-bank-generate-distractors       │ │
│  │  Coming (Phase 2.6.4): render-question, compose-game,     │ │
│  │                        compose-lobby-game                  │ │
│  │  All check Authorization header + auth.getUser() in code. │ │
│  │  Admin functions also check app_metadata.role === 'admin'.│ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────┬────────────────────────────────────────────────┘
                 │ HTTPS (Anthropic API)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ANTHROPIC API                              │
│  • claude-sonnet-4-6  — solo/lobby question generation (legacy, │
│                         removed by Phase 2.6.5)                 │
│                       — Phase 2.6.4 render-question + validate  │
│  • claude-haiku-4-5-20251001 — source citation,                 │
│                                distractor generation            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Mobile client

### Stack
- React Native via Expo SDK
- Expo Router for file-based navigation
- TypeScript throughout
- Maestro for end-to-end testing (25 active flows, run via `mobile/run_tests.sh` one-flow-per-invocation due to Maestro 2.5.0 parallelization)
- Supabase JS client for auth, queries, RPCs, Realtime, and Edge Function invocation

### Layout
```
mobile/app/
  _layout.tsx           — root, auth gate, font loading
  auth.tsx              — sign up / sign in
  (tabs)/
    _layout.tsx         — bottom tab nav
    index.tsx           — Home (greeting, daily challenge card, category grid)
    play.tsx            — Play hub (lobby create/join entry)
    leaderboard.tsx     — Leaderboard with period tabs
    profile.tsx         — Profile, stats, achievements, XP/level
  question.tsx          — Solo game loop
  results.tsx           — Solo results
  custom-category.tsx   — Custom topic input
  lobby/
    create.tsx, join.tsx, [code]/index.tsx, [code]/game.tsx, [code]/results.tsx
  admin/                — Phase 2.6, Expo Web only, gated by isAdmin
    _layout.tsx, index.tsx, facts/, sources/, distractors/, reports/, coverage/
```

### Lib modules
- `supabase.ts` — single Supabase client, configured from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable key, despite the legacy variable name). Persistent session via SecureStore.
- `auth.tsx` — React context wrapping the Supabase auth state. Exposes `session`, `user`, `loading`, and `isAdmin` (derived from `user.app_metadata.role`). Used by the auth gate and admin layout.
- `api.ts` — typed wrappers for Edge Function calls (`generateSoloQuestion`, `generateLobbyQuestions`, `createLobby`, `joinLobby`, `getDailyChallenge`). Phase 2.6.5 replaces these with `composeGame` / `composeLobbyGame`.
- `theme.ts` — design tokens (colors, radius, spacing). Single source of visual truth. Admin pages reuse these tokens.
- `scoring.ts` — `calcScore(timeRemaining, streak)` — the only place the score formula lives. Used by both solo and lobby scoring paths.
- `gameHistory.ts` — session-level question deduplication (avoids repeating questions within one game session). Phase 2.6 supersedes this with the `fact_exposures` table.
- `types.ts` — shared TypeScript types for questions, lobbies, scores.

### Routing
Auth state drives the root layout. Unauthenticated users see `/auth`; authenticated users land on `/(tabs)`. Admin routes under `/admin/*` redirect to `/(tabs)` for non-admin users; the redirect logic lives in `admin/_layout.tsx` reading `isAdmin` from `useAuth()`.

### State management
No Redux, no Zustand, no React Query in the mobile bundle as of Phase 2.6.2. Local state via `useState` / `useEffect`. The architecture allows for it (Phase 2.6.6 explicitly does not introduce React Query) — instead, on-device caching uses MMKV directly with explicit invalidation hooks.

---

## Supabase platform

### Auth
Supabase's GoTrue service. Email/password only, no social providers. Sessions are JWTs signed with an asymmetric ES256 key pair (the local stack stores the keys at `supabase/signing_keys.json`, gitignored; production uses Supabase's hosted keys).

The system uses Supabase's **new API key system** (`sb_publishable_*` / `sb_secret_*`), not legacy `anon` / `service_role`. Practical consequences:
- Mobile client uses the publishable key (named `EXPO_PUBLIC_SUPABASE_ANON_KEY` for backward compat)
- The publishable key is NOT a JWT, so platform-level JWT verification at the Edge Function gateway is incompatible
- All Edge Functions deploy with `--no-verify-jwt` and validate auth in code
- The publishable key is read from `req.headers.get('apikey')` with `Deno.env.get('SUPABASE_ANON_KEY')` as fallback (the env var sync is unreliable on new-key projects)

Two role tiers:
- Regular user — anyone signed up via the app
- Admin — `auth.users.app_metadata.role = 'admin'`. Set via SQL grant locally, via dashboard in production. Never read from `user_metadata` (user-editable). The `is_admin()` Postgres function reads from the JWT and is used by RLS policies; admin Edge Functions check `auth.user.app_metadata?.role === 'admin'` directly.

### Postgres data model

The schema groups into four logical clusters.

**Identity**
```
profiles ─ id (FK auth.users), username, avatar_url, total_score,
           best_streak, games_played, created_at
```
RLS: anyone reads, owner updates/inserts.

**Gameplay (solo and daily)**
```
scores ─ id, user_id (FK profiles), category, score, correct_count,
         total_questions, best_streak, played_at

daily_challenges ─ id, challenge_date (unique), category, created_at

daily_challenge_completions ─ challenge_id (FK), user_id (FK),
                              score, correct_count, total_questions,
                              best_streak, completed_at
                              PK (challenge_id, user_id)
```
RLS: scores readable by anyone, insertable by owner. Daily challenges readable by all authenticated. Completions readable + insertable by owner only.

**Lobby (real-time multiplayer)**
```
lobbies ─ id, code (unique short code), host_id, category, status,
          max_players, created_at

lobby_players ─ lobby_id, user_id, joined_at  PK (lobby_id, user_id)

lobby_questions ─ id, lobby_id, question_index, question, answers (jsonb),
                  correct_index, explanation, difficulty
                  unique (lobby_id, question_index)

game_sessions ─ id, lobby_id, question_index, starts_at
                unique (lobby_id, question_index)
                Server-authoritative timestamps for synchronous timer.

lobby_answers ─ lobby_id, user_id, question_index, answer_index,
                answered_at  PK (lobby_id, user_id, question_index)
```
RLS: anyone authenticated reads (lobby state needs to be visible to participants); inserts are owner-scoped (lobby_players, lobby_answers) or host-scoped (lobbies update). Lobby questions and game sessions are read-only from the client; only Edge Functions write them.

**Fact bank (Phase 2.6 — the new architecture)**
See `PHASE_2.6_ARCHITECTURE.md` for full schema details. Summary of the seven tables:

```
categories ─ slug, display_name, parent_id, verification_standard
             ('cross-referenced' | 'source-cited' | 'self-asserted')

facts ─ id, category_id, fact_text, correct_answer, answer_aliases,
        difficulty (1-5), is_high_value, verification_status
        ('pending' | 'verified' | 'rejected' | 'flagged'),
        verified_by, verified_at, source_origin, created_by

fact_sources ─ id, fact_id, url, citation, excerpt, source_type,
               verified_reachable, human_confirmed, added_by_ai

distractors ─ id, fact_id, distractor_text,
              authored_by ('human' | 'ai-cached' | 'imported'),
              reviewed_by, reviewed_at, quality_score, is_active

fact_reports ─ id, fact_id, reported_by (player), reason, detail,
               status ('open' | 'reviewed' | 'resolved' | 'dismissed')

fact_exposures ─ player_id, fact_id, last_seen_at, seen_count
                 PK (player_id, fact_id)
                 Anti-repetition: don't show the same fact too soon.

question_renderings ─ id, fact_id, style, target_difficulty, tone,
                      question_text, shuffled_answers (jsonb),
                      correct_index, generated_by, validated
                      unique (fact_id, style, target_difficulty, tone)
                      Layer 2 cache: deterministic, no expiry.
```

A Postgres trigger (`check_fact_verification`) enforces the verification gate: a fact's `verification_status` cannot transition to `'verified'` unless its category's `verification_standard` is satisfied by confirmed `fact_sources` rows. Cross-referenced needs ≥2 confirmed sources; source-cited needs ≥1; self-asserted needs none.

RLS: verified facts and their sources/distractors readable by authenticated users; admin can read/write everything; users own their own `fact_exposures` rows; users insert reports for themselves.

**Phase 2.6 verification gate is prod-only.** The `verification_status = 'verified'` filter applies to gameplay in production. Dev, Maestro, and iOS Simulator builds run against pending facts so Phase 2.6.4–2.6.7 can develop in parallel with Mike's seeding (2.6.3) instead of blocking on it. Phase 2.6.8 enforces the strict filter and is the gate to Phase 3.

### Views and RPCs
- `leaderboard` — view aggregating scores from the last 30 days, top 50. Backs the leaderboard tab.
- `get_leaderboard(period)` — RPC for period-filtered leaderboards (alltime / week / month).
- `create_game_session(lobby_id, question_index)` — RPC that atomically creates the server-timestamped session row. Used by the lobby game flow to start each question with a known server time.
- `is_admin()` — security definer function that reads `auth.jwt() -> 'app_metadata' ->> 'role'` and returns boolean. Used by all Phase 2.6 RLS policies.
- `check_fact_verification()` — trigger function on `facts`, enforces the verification standard.

### Realtime
Supabase Realtime is a separate WebSocket service that watches Postgres for changes and pushes them to subscribed clients. It powers lobby waiting/play flows: each player's app subscribes to `lobby_players` and `lobby_answers` for their lobby, and the UI reacts to events as they arrive.

Concurrent-connection caps: Free tier 200, Pro tier 500. Each lobby player = one connection. This is the tightest scaling bottleneck for synchronous play. Workarounds when outgrown: bigger Supabase plan, self-hosted Realtime, or replace with a dedicated WebSocket service (Pusher, Ably).

Solo and daily challenge do not use Realtime.

### Edge Functions

Trivolta runs nine Edge Functions as of Phase 2.6.2 (Phase 2.6.4 adds three more, Phase 2.6.5 deprecates two).

Auth pattern (every function):
1. Handle CORS preflight
2. Check `Authorization` header is present (else 401)
3. Construct a user-scoped Supabase client with the user's JWT and the apikey-header-with-env-fallback pattern
4. Call `userClient.auth.getUser()` (else 401)
5. (Admin functions only) check `user.app_metadata?.role === 'admin'` (else 403)
6. Construct a service-role Supabase client for any DB writes that need to bypass RLS

**Gameplay functions**
- `solo-question` — generates one question for a solo game using `claude-sonnet-4-6`. Reads `category` and `streak` from the request, returns shuffled answers + correct_index + explanation. Removed by Phase 2.6.5 cutover (replaced by `compose-game`).
- `generate-questions` — generates 10 questions in parallel for a lobby game. Removed by Phase 2.6.5 (replaced by `compose-lobby-game`).
- `create-lobby` — atomic create-and-join: inserts a row in `lobbies`, generates a unique 4-char code, joins the host to `lobby_players`. Returns the code.
- `join-lobby` — looks up a lobby by code, validates it's `waiting` and not full, inserts the player.
- `daily-challenge` — fetches or creates today's `daily_challenges` row, returns its 10 questions. Currently generates per-user; the architecture intent is shared questions per day, deferred as a product redesign.

**Fact-bank tooling (Phase 2.6.2, admin-only)**
- `fact-bank-import` — accepts OpenTrivia DB JSON, decodes HTML entities, maps category strings to Trivolta slugs via the shared lookup module, inserts each row as a `pending` fact with imported distractors. No Anthropic calls.
- `fact-bank-validate-source` — for a given fact_id, asks Haiku to propose 2 source URLs each with a quoted excerpt, then mechanically verifies each (URL reachability + case-insensitive substring match of the excerpt on the response body). Returns candidates with verification flags. Does NOT auto-insert into `fact_sources`.
- `fact-bank-generate-distractors` — for a long-tail fact, generates 3 distractors via Haiku, runs a second Haiku pass to score ambiguity, retries up to twice if any score is ≥3. Returns validated candidates. Does NOT auto-insert.

**Phase 2.6.4 (planned)**
- `render-question` — Layer 2: takes a fact_id + style + difficulty + tone, returns a fully-rendered question. Uses Sonnet for rewording, then a second Sonnet pass to validate the rendering before caching it in `question_renderings`. Cache key (fact_id, style, target_difficulty, tone) is unique and deterministic.
- `compose-game` — Layer 3: pure SQL fact selection (filtered by category, verification status, anti-repetition window from `fact_exposures`, distractor count, difficulty curve) followed by parallel `render-question` calls. Returns 10 fully-rendered questions.
- `compose-lobby-game` — same logic for an 8-player lobby. The dev-mode toggle (env-based) controls whether `verification_status` is filtered.

### Deployment
Local dev uses `supabase start` (Docker stack) + `supabase functions serve --no-verify-jwt --env-file supabase/.env.local`. The `--env-file` flag is required because Supabase CLI 2.95.4+ does not auto-load `supabase/.env.local`; without it, `ANTHROPIC_API_KEY` is unreachable.

Production deployment is `supabase functions deploy <name> --no-verify-jwt`. Anthropic's API key is set via `supabase secrets set ANTHROPIC_API_KEY=...` (encrypted at rest by Supabase, never in the repo). Migrations apply via `supabase db push` against the linked project.

Production deploy is gated on Phase 2.6.8 complete (see `INSTRUCTIONS_PRODUCTION_SUPABASE.md`).

---

## Anthropic API

Two models in active use:

**Sonnet (`claude-sonnet-4-6`)** — used for the legacy gameplay generators (`solo-question`, `generate-questions`) until Phase 2.6.5 retires them, and for Phase 2.6.4's `render-question` (which rewords a verified fact into a question and runs a validation pass to reject ambiguous renderings). Sonnet is the right tier for output that gets cached and shown to players.

**Haiku (`claude-haiku-4-5-20251001`)** — used for source citation and distractor generation. These are mechanical tasks (propose URLs, generate plausible wrong answers, score ambiguity) where Haiku's speed and cost matter more than Sonnet's nuance.

Cost shape:
- Beta-month total: ~$35, dominated by one-time seeding work (1,500 facts × ~5 calls each)
- Steady-state monthly post-launch at <1k DAU: ~$10, mostly cache fills for new content
- The cache hit rate (~95% after warmup) is what makes the architecture economical at scale; without it, cost grows linearly with DAU like the current architecture does

---

## Request flows

### Sign up
```
Mobile app: user submits email/username/password
  → POST /auth/v1/signup (GoTrue)
  → GoTrue creates auth.users row, returns JWT
  → Mobile app calls profiles.insert({ id: user.id, username }) via Supabase client
  → RLS policy 'profiles_insert_own' allows the insert because auth.uid() = id
  → Auth context updates, root layout swaps unauthenticated UI for /(tabs)
```

### Solo game (current, pre-Phase 2.6.5)
```
HomeScreen / CustomCategory: user picks a category
  → router.push('/question?category=...&streak=0')
  → QuestionScreen mounts, calls api.generateSoloQuestion(category, streak)
  → POST /functions/v1/solo-question with apikey + Authorization headers
  → Edge Function: auth.getUser() → 401 if invalid; else
    → anthropic.messages.create({ model: 'claude-sonnet-4-6', ... })
    → return { question, answers, correct_index, explanation }
  → QuestionScreen renders, starts timer, accepts tap
  → On answer: calcScore(timeLeft, streak), update local state, advance
  → After 10 questions: scores.insert({ user_id, score, ... })
  → router.push('/results')
```

### Solo game (Phase 2.6.5 onward)
```
HomeScreen: user picks a category
  → router.push('/question?category=...')
  → QuestionScreen mounts, calls api.composeGame({ category, count: 10 })
  → POST /functions/v1/compose-game
  → Edge Function: auth → SQL select 10 verified facts in category,
    excluding recent fact_exposures
    → for each fact, call render-question (which checks the
       question_renderings cache and only calls Anthropic on miss)
    → return 10 rendered questions
  → QuestionScreen renders all 10 from the response (no per-question round trips)
  → On game complete: insert one batch of fact_exposures rows + one scores row
  → router.push('/results')
```

The cache hit path means a typical solo game makes **zero Anthropic calls** — pure DB read.

### Lobby game (synchronous multiplayer)
```
Host taps Create Lobby
  → api.createLobby({ category }) → Edge Function inserts lobby + first lobby_players row
  → router.push(`/lobby/${code}`)
  → LobbyWaitingScreen subscribes to lobby_players via Realtime

Guests tap Join, enter code
  → api.joinLobby({ code }) → Edge Function inserts lobby_players row
  → Realtime pushes the change to host and other guests
  → All players' UIs update with the new player

Host taps Start
  → api.startLobby({ lobby_id })
  → Edge Function calls compose-lobby-game (post-2.6.5) or generate-questions (pre)
  → Inserts 10 lobby_questions rows + first game_sessions row
  → Updates lobbies.status = 'active'
  → Realtime pushes status change to all players
  → All apps navigate to /lobby/[code]/game

Game loop (per question, all 8 players in lockstep)
  → App reads lobby_questions[i] and game_sessions[i].starts_at
  → Timer counts down from server-authoritative starts_at + 25s (not client clock)
  → Player taps answer → lobby_answers.insert({ ... })
  → On timer expiry: app advances to next question
  → Last player to insert their answer for question_index N triggers
    create_game_session RPC for question_index N+1 (server timestamp)
  → Realtime pushes the new game_sessions row, all apps start the next question

Game end (after question 10)
  → Each app computes final score from local lobby_answers + game_sessions
  → router.push(`/lobby/${code}/results`)
  → LobbyResultScreen reads all lobby_answers, ranks, displays
  → Host updates lobbies.status = 'finished'
```

### Daily challenge
```
HomeScreen mounts, calls api.getDailyChallenge()
  → Edge Function: SELECT today's daily_challenges row by challenge_date
    → If missing, INSERT new row + generate 10 questions (per-user currently)
  → Returns the 10 questions + completion status for this user
HomeScreen renders the hero card
  → If completed: green Completed ✓ badge (button color bug, see tracker)
  → If not completed: Play button → router.push('/daily-challenge')
DailyChallengeScreen runs the same loop as solo
  → On game complete: daily_challenge_completions.insert({ user_id, challenge_id, ... })
```

---

## Auth model in detail

**Three layers** check authorization, in this order:

1. **API key on every request.** The mobile client always sends the publishable key as the `apikey` header. Edge Functions and PostgREST reject requests without it.
2. **JWT on every authenticated request.** The mobile client sends `Authorization: Bearer <jwt>` after sign-in. The JWT carries the user's id and `app_metadata`. Edge Functions verify it via `auth.getUser()` against a user-scoped Supabase client. Postgres verifies it via the platform's PostgREST gateway (which is the case even with `--no-verify-jwt` set on Edge Functions — that flag affects Edge Function gateway verification only, not PostgREST).
3. **RLS policies on every table.** Even if a request is authenticated, the policy decides what rows the user can see or change. `is_admin()` is the discriminator for admin-only operations.

**Why the publishable key is not a JWT.** The new key system separates "this client is allowed to talk to the project" (publishable key, static, in the mobile bundle) from "this user is authenticated" (JWT, ephemeral, per-session). The legacy `anon` key was both at once, which made platform-level JWT verification possible. The new system requires in-function auth checks, which is why every Edge Function has the same auth preamble.

**Admin role storage.** `auth.users.app_metadata` is a JSON column writable only via service-role calls. `user_metadata` is writable by the user. Admin status in `app_metadata` is forge-resistant. RLS reads it from `auth.jwt() -> 'app_metadata' ->> 'role'`.

**Granting admin locally:**
```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                        || '{"role":"admin"}'::jsonb
where email = '<email>';
```
Then the user must sign out and sign back in for the new JWT to include the updated metadata.

In production: Supabase Dashboard → Authentication → Users → User Metadata → set `role: admin` under app_metadata.

---

## Environment topology

### Local development (current)
- `supabase start` — Docker stack on `127.0.0.1` (Postgres `:54322`, API `:54321`, Studio `:54323`)
- `supabase/signing_keys.json` — local ES256 key pair, gitignored
- `supabase/.env.local` — `ANTHROPIC_API_KEY=<value>`, gitignored, loaded by `--env-file` flag
- `mobile/.env.local` — `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and `EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_*`, gitignored
- `mobile/maestro/.env.maestro` — `SUPABASE_SERVICE_KEY=sb_secret_*` for test-user provisioning, gitignored
- iOS Simulator runs against this stack via `npx expo run:ios`
- Expo Web runs against this stack via `npx expo start --web` at `localhost:8081` (used for admin tooling)

### Production (planned, Phase 3 / `INSTRUCTIONS_PRODUCTION_SUPABASE.md`)
- New Supabase project `trivolta-prod` in `us-west-1`, Free tier initially
- Repo linked via `supabase link --project-ref <ref>`
- Migrations applied via `supabase db push`
- Anthropic key set via `supabase secrets set`
- All 9–11 Edge Functions deployed via `supabase functions deploy --no-verify-jwt`
- `mobile/.env.local` swapped to point at `https://<ref>.supabase.co`
- TestFlight build via EAS (`INSTRUCTIONS_EAS_BUILD.md`)
- Legacy `anon` and `service_role` keys disabled

### Scaling ceilings
| Configuration | DAU ceiling | Limiting factor |
|---|---|---|
| Current arch, no caching | ~2,000 | Edge Function invocations + Anthropic cost |
| Phase 2.6 server-cache only | ~7,000 | Edge Function invocations |
| Phase 2.6 + on-device cache | ~30,000 | Realtime concurrent connections (lobby only) |
| Phase 2.6 + Supabase Pro | ~50,000+ | Postgres write throughput |

The architecture comfortably handles a successful indie launch (5K–10K DAU on $25/month Supabase Pro). Beyond that, infrastructure changes are needed but they're optimizations of working systems, not rewrites.

---

## Cross-cutting concerns

### Migrations
Numbered `YYYYMMDD000000_<name>.sql`. Files are append-only — never modify a migration after it's been pushed. New work goes in a new file. Six migrations as of Phase 2.6.1:
1. `20240101` — initial schema (profiles, scores, lobbies, etc.)
2. `20240102` — game_sessions insert policy fix
3. `20240103` — lobbies host cascade fix
4. `20240104` — daily challenge tables
5. `20240105` — bug fixes from Phase 2.5 review
6. `20240106` — fact bank schema (Phase 2.6.1)

### Testing
Maestro for end-to-end flows on iOS Simulator (25 active flows, 1 manual-only). The Maestro 2.5.0+ parallelization gotcha means the test runner must call `maestro test` once per flow file rather than against the directory. `mobile/run_tests.sh` handles this.

No unit test framework. The codebase is small enough and the e2e suite catches the things that matter. Adding Vitest or Jest for the lib/ helpers (scoring, gameHistory) would be reasonable but isn't on the roadmap.

### Theme and styling
All visual styling reads from `mobile/lib/theme.ts`. New screens reuse the tokens. Admin pages reuse the tokens too — admin tooling is intentionally visually utilitarian, but it sits inside the same color palette as the rest of the app for cognitive consistency.

### Two-Claude development workflow
See `WORKFLOW.md`. Mac Claude (this assistant) writes design docs and INSTRUCTIONS files; Claude Code (in the iTerm2 + VS Code environment) reads INSTRUCTIONS files and implements the code. INSTRUCTIONS files specify *what* and *why* and constraints; they do NOT contain implementation code. Each completed sub-phase produces a diff that Mac Claude reviews against four criteria before the commit lands.

### Operational rules
Documented in `CLAUDE.md`. Highlights that affect anyone touching the system:
- Edge Functions deploy with `--no-verify-jwt` (required, not forbidden, under new keys)
- The apikey-header-with-env-fallback pattern is the correct way to read the publishable key inside an Edge Function
- Maestro must be run via `run_tests.sh` (loop per flow) not `maestro test maestro/`
- `supabase db reset` wipes auth.users — admin role grants must be re-applied after reset
- Admin role goes in `app_metadata` not `user_metadata`

---

## Known limits and tech debt

Tracked exhaustively in `TRIVOLTA_TRACKER.md` under "Known Issues / Tech Debt." The architectural-level items:

- **Daily challenge generates per-user** instead of shared questions per day. Intended design is shared. Deferred as a product redesign — touches the daily challenge Edge Function and the `daily_challenges` schema (would need a `questions` jsonb column).
- **`fetchUserStats` scans the leaderboard table** to compute the current user's rank. Folded into Phase 2.6.7 as `get_user_rank(user_id)` RPC.
- **Realtime subscription teardown leaks** in some lobby screens. Folded into Phase 2.6.7.
- **No request deduplication** in `api.ts` — double-tapping a category fires two calls. Folded into Phase 2.6.7.
- **Android untested.** All Maestro tests run iOS Simulator only. Cross-platform correctness assumed but not verified.
- **AI source-citation excerpt-match misses on dynamically rendered pages.** Wikipedia and JS-rendered sites sometimes serve raw HTML where the AI's quoted excerpt is not a substring. The mechanical check correctly flags these. Working as designed; affects seeding throughput, not code correctness.

---

## What's NOT in this document

- Sub-phase implementation details (those live in the relevant `INSTRUCTIONS_*.md` files)
- Phase-by-phase progress (`TRIVOLTA_TRACKER.md`)
- Operational gotchas and environmental rules (`CLAUDE.md`)
- The Phase 2.6 design specifically (`PHASE_2.6_ARCHITECTURE.md`)
- The two-Claude development workflow (`WORKFLOW.md`)
- Specific code-review findings (`TRIVOLTA_CODE_REVIEW.md`)
- Deviations log (`DEVIATIONS.md`)

---

## Maintenance rule

Update this document when **architecture** changes. Examples that warrant an update:
- A new top-level service is added (e.g. a search service, a CDN, a separate analytics backend)
- A table cluster is added or removed
- The auth model changes
- The mobile/server boundary moves (e.g. moving compose logic to the client)
- A scaling ceiling shifts because of an infrastructure change

Do NOT update this document for:
- A new screen, button, or copy change
- A new Maestro test
- A new INSTRUCTIONS file
- A bug fix
- A renamed table column

If in doubt, ask whether a future contributor needs to know this to understand the system shape. If yes, document it. If they only need to know it to fix a specific bug, leave it in a phase-scoped file.
