# Trivolta — Project Tracker

## Status Key
✅ Done | 🔄 In Progress | ⬜ Pending | 🔴 Blocked | ⏸ Deferred

---

## Phase 1 — Feature Complete ✅

### Infrastructure
✅ GitHub repo created — github.com/mikeisbell/Trivolta
✅ Local directory — /Users/mizzy/Developer/Trivolta
✅ Domain registered — trivolta.app
✅ Supabase project initialised (local)
✅ Database schema — profiles, scores, lobbies, lobby_players, lobby_questions, game_sessions, lobby_answers, daily_challenges, daily_challenge_completions
✅ RLS policies on all tables
✅ Leaderboard view + get_leaderboard RPC + create_game_session RPC
✅ Edge Functions — solo-question, generate-questions, create-lobby, join-lobby, daily-challenge
✅ CLAUDE.md — project source of truth
✅ theme.ts — single source of visual truth
✅ scoring.ts — shared calcScore function

### Screens
✅ Auth screen — sign up, sign in, sign out, profile creation
✅ HomeScreen — greeting, hero daily challenge card (real), 2×2 category grid, tab navigator
✅ QuestionScreen — full solo game loop, timer, scoring, streak multiplier, explanation feedback
✅ ResultScreen — score, accuracy, play again, home
✅ CustomCategoryScreen — any topic input, example prompts, trending categories (real data)
✅ ProfileScreen — real stats from Supabase, achievements, XP, level
✅ LeaderboardScreen — podium top 3, rank rows with period tabs (alltime/week/month)
✅ Lobby — CreateLobbyScreen (standard + custom topic)
✅ Lobby — JoinLobbyScreen (4-box code entry, error state)
✅ Lobby — LobbyWaitingScreen (real-time player list, start/leave)
✅ Lobby — LobbyGameScreen (synchronous play, server-timestamp timer, retry button)
✅ Lobby — LobbyResultScreen (score-based ranking)
✅ Daily Challenge — real implementation (server-side, resets midnight UTC)

### Core Features
✅ AI question generation (solo) — claude-sonnet-4-6
✅ AI question generation (lobby) — parallel Promise.all, ~5s
✅ Session-wide question deduplication
✅ Score saving to Supabase
✅ Streak multiplier scoring (shared scoring.ts)
✅ Difficulty auto-scaling by streak (easy/medium/hard)
✅ Tab navigator (Home, Play, Ranks, Profile)
✅ Auth routing gate
✅ Real-time lobby synchronisation (Supabase Realtime)
✅ Server-timestamp timer for lobby games (Postgres RPC, not client clock)
✅ Room code join flow
✅ Lobby question generation (all 10 before game start, parallel)
✅ Lobby ranking by score (time bonus + streak multiplier)
✅ Daily challenge logic (server-side, resets at midnight)
✅ Trending categories from real play data
✅ Auth guards on all Edge Functions (401 on missing/invalid JWT)
⏸ AdMob rewarded ads — deferred post-launch

---

## Phase 2 — Test Coverage (Substantially Complete — Backlog Deferred)

25 of 25 active tests pass. Remaining items are either deferred to Tier 3 backlog or confirmed non-automatable. The active test suite is considered stable for beta purposes.

### Maestro E2E Tests (25/25 passing)
✅ test_01 — auth screen on launch
✅ test_02 — sign up (deletes + recreates user, validates signup flow)
✅ test_03 — sign in
✅ test_04 — sign out
✅ test_05 — custom category flow
✅ test_06 — profile screen data
✅ test_07 — leaderboard display
✅ test_08 — solo game loop (start, answer all 10, results)
✅ test_09 — play again from results
✅ test_10 — timer expiry (unanswered question)
✅ test_11 — streak tracking
✅ test_12 — create lobby via UI
✅ test_13 — join lobby via room code
✅ test_14 — lobby game full flow (deep link, start, 10 questions, results)
✅ test_15 — leave lobby (guest)
✅ test_16 — auth validation (empty fields, mode toggle, wrong password)
✅ test_17 — results screen assertions (score, grade, navigate home)
⏸ test_18 — question error state/retry — confirmed non-automatable in Maestro; manual-only
✅ test_19 — join lobby invalid code (error state)
✅ test_20 — home category taps (Science, Pop culture, History)
✅ test_21 — custom category interactions (freeform, back, submit)
✅ test_22 — create lobby custom topic
✅ test_23 — leaderboard tab switching (alltime/week/month)
✅ test_24 — back navigation mid-game + results home
✅ test_25 — join lobby error flow
✅ test_26 — lobby results navigation (home + play-again navigation only)

All active tests are self-contained — each guarantees its own test user via ensure_test_user_02.js.
Single run passes after supabase db reset. No warm-up run required.

### Test Backlog (Tier 3 — deferred, not blocking beta)
⬜ test_27 — lobby game timer expiry (requires 25s wait in lobby context)
⬜ test_28 — profile achievement unlock assertions (requires seeding specific stats)
⬜ test_29 — leaderboard current user highlighted (requires seeding top-10 position)
⬜ test_30 — join full lobby rejected (requires seeding 8 players)

### Edge Case Coverage (deferred — not blocking beta)
⬜ Network failure during question fetch — retry UI (test_18 non-automatable)
⬜ Network failure during answer submit — graceful fail
⬜ Full lobby (8 players) — join rejected (covered by test_30 when implemented)
✅ Expired room code — error handling (test_19, test_25)
⬜ Duplicate username on sign up — friendly error

---

## Phase 2.5 — Code Review & Bug Fixes ✅

✅ Full code analysis — TRIVOLTA_CODE_REVIEW.md (24.7KB, 10 sections)
✅ All Critical/High/Medium/Low bugs fixed — INSTRUCTIONS_BUG_FIXES.md
✅ Test isolation — all 25 tests self-contained — INSTRUCTIONS_TEST_ISOLATION.md

---

## Phase 2.6 — Question Quality Architecture

Separates fact (atomic truth, human-verified) from question (AI-rendered, cached).
See PHASE_2.6_ARCHITECTURE.md for the full design. Phase 3 is gated on 2.6.8 complete.

**Verification-gate scope (decided 2026-04-29):** the `verification_status = 'verified'` filter applies ONLY to production gameplay. Dev, Maestro, and iOS Simulator builds run against pending facts so 2.6.4–2.6.7 can proceed in parallel with Mike's seeding (2.6.3) instead of blocking on it. The strict filter activates in `compose-game` based on environment, and is enforced as the actual gate by Phase 2.6.8.

**Beta-verification posture (decided 2026-04-29):** AI-verifies-AI cross-check is parked. Two reasons surfaced during 2.6.3a manual testing: (1) the mechanical excerpt-match check fails on most authoritative sources — Wikipedia is JS-rendered (excerpts not in raw HTML), CIA World Factbook is deprecated (302 → farewell page), Britannica is the only reliably matching source; and (2) the cross-check itself was never validated end-to-end because the Paris/Berlin smoke test bailed at `failure_stage: mechanical_check` before the cross-check fired. Beta will ship with possibly-imperfect facts; the `fact_reports` table is the real verification mechanism via player feedback. The 2.6.8 verification gate is informational-only for beta, not a hard blocker.

**Beta data source (decided 2026-04-29):** ~3,976 facts from The Trivia API populated locally via 2.6.3e. Distributed across 10 Trivolta slugs (general 663, pop-culture 454, music 446, history 424, science 419, film 418, literature 404, geography 381, sports 291, art 76). Imported as `pending`; visible to dev/Simulator gameplay because the verification gate is prod-only. Re-runnable on any fresh `dev-reset`.

✅ Phase 2.6.1 — Schema + admin tooling shell — INSTRUCTIONS_PHASE_2.6.1_SCHEMA_AND_ADMIN.md
✅ Phase 2.6.2 — Import + AI source citation — INSTRUCTIONS_PHASE_2.6.2_IMPORT_AND_SOURCING.md
✅ Phase 2.6.3a — Automated seeding tooling — INSTRUCTIONS_PHASE_2.6.3_AUTOMATED_SEEDING.md
⏸ Phase 2.6.3b — Calibration + curation — parked alongside cross-check (see beta-verification posture above). Steps below kept for post-beta revisit.
⏸ Phase 2.6.3c — Category source registry — parked pending post-beta revisit. INSTRUCTIONS file exists on disk but not handed to Claude Code.
✅ Phase 2.6.3d — The Trivia API as second import source — INSTRUCTIONS_PHASE_2.6.3d_TRIVIA_API_IMPORT.md (auto-detects OpenTrivia DB vs Trivia API shape; tag-level disambiguation; nbsp stripping; `imported_ids` + `source` in response)
✅ Phase 2.6.3e — Bulk Trivia API seed + per-category dedupe — INSTRUCTIONS_PHASE_2.6.3e_BULK_TRIVIA_API_SEED.md (`skipped_duplicate` counter on importer; `mobile/seed-trivia-api.sh` reusing `dev-reset.sh` admin; 3,976 facts imported across 10 slugs in 63s)
⬜ Phase 2.6.4 — Render + Compose Edge Functions — INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md
⬜ Phase 2.6.5 — Mobile integration + cutover — INSTRUCTIONS_PHASE_2.6.5_MOBILE_CUTOVER.md
⬜ Phase 2.6.6 — On-device caching (MMKV) — INSTRUCTIONS_PHASE_2.6.6_DEVICE_CACHING.md
⬜ Phase 2.6.7 — Code-level fixes — INSTRUCTIONS_PHASE_2.6.7_CODE_FIXES.md
⬜ Phase 2.6.8 — Validation + soak test (informational gate for beta; hard gate for Phase 3 only post-beta)

### Phase 2.6.3b — Mike's calibration steps (parked, kept for post-beta revisit)

**Step 0 — Pre-flight smoke test (~5 min, MANDATORY before any batch run).** Insert two manually-crafted facts: one known-true ("Capital of France?" → "Paris") and one deliberately-wrong ("Capital of France?" → "Berlin"). Run `fact-bank-auto-seed` on each. Expected: the true fact auto-verifies with confidence ≥4, the wrong fact lands in `needs_review` with confidence ≤2 and reasoning explaining the mismatch. If the wrong fact auto-verifies, the cross-check is broken — do NOT run any larger batch until fixed. SQL + curl commands for this test are documented in the conversation that produced Phase 2.6.3a. **Status:** smoke test ran but both facts bailed at `failure_stage: mechanical_check` before cross-check fired — cross-check correctness still unproven. See `mobile/smoke-test-cross-check.sh`.

**Step 1 — Geography starter batch (~30 min).** Pull 50 Geography facts from OpenTrivia DB (https://opentdb.com/api.php?amount=50&type=multiple&category=22), import + auto-seed via /admin/facts/auto-seed. Open /admin/telemetry — verify cost ~$1, auto-verify rate 85–90%.

**Step 2 — Spot-check 20 auto-verified facts.** Manually click through to source URLs, confirm each fact is correct. Note any false positives.

**Step 3 — Review the needs_review queue.** Approve, reject, or edit each. Note any false negatives (facts that should have auto-verified).

**Step 4 — Decide whether to scale up.** If false positive rate >5%, pause and tune. Otherwise scale to bigger batches across remaining 9 categories until ~1,500 facts seeded.

---

## Phase 2.9 — Pre-Beta Feature Roadmap

Feature scope expansion ahead of beta, decided after the differentiation discussion (see TRIVOLTA_DIFFERENTIATION.md). Ordered by tranche; tranches are dependency-bounded, not time-bounded. Within a tranche, features can ship in any order unless otherwise noted.

The goal of this work is not to add gameplay surface — it is to make beta produce interpretable retention data and to ship the architectural pieces (render layer, distractor regen) that turn Trivolta from "competent trivia app" into "competent trivia app with smarter questions and a real habit loop."

### Tranche 1 — Foundation

Independent of each other and of all later tranches. Ship before Tranche 2.

⬜ **F1. Distractor regeneration across imported corpus** — run existing distractor pipeline against all 3,976 facts, replace Trivia API distractors with ambiguity-scored AI-generated ones, spot-check 20 samples. Depends on: nothing.
⬜ **F2. In-app feedback channel** — `feedback_reports` table (user, screen, state snapshot, free text, timestamp), persistent feedback button on every screen. Every feature shipped after this gets feedback capture for free. Depends on: nothing.
⬜ **F3. Manual fact spot-check** — click through 50 random facts across all 10 categories, log incorrect answers in `fact_reports`. Gate before any external tester sees the app. Depends on: nothing.

### Tranche 2 — Question Rendering Layer

⬜ **F4. Render Edge Function** (Phase 2.6.4) — input: stored fact, target skill level, style hint. Output: paraphrased question + render-time correctness check per TRIVOLTA_HALLUCINATION_STRATEGY.md. Depends on: F1.
⬜ **F5. Compose Edge Function** (Phase 2.6.4) — selects facts, calls render, assembles 10-question game. Depends on: F4.
⬜ **F6. Mobile cutover to compose endpoint** (Phase 2.6.5) — mobile app calls compose instead of legacy generate paths; old endpoints deprecated; Maestro suite passes. Depends on: F5.

### Tranche 3 — Retention Triangle

These three form a coherent retention loop. Ship together to be tested together.

⬜ **F7. Shared daily challenge** — server generates one question set per day, all users see the same 10. Migration on `daily_challenges`. Replaces current per-user generation. Resolves tech-debt item: "Daily challenge shared questions." Depends on: nothing.
⬜ **F8. Real consecutive-day streak tracking** — `current_streak`, `longest_streak`, `last_played_date` on profiles, server-side update after each session. Replaces hardcoded "🔥 3 day streak." Resolves tech-debt item: "HomeScreen streak display hardcoded." Depends on: nothing.
⬜ **F9. Streak freeze mechanic** — `streak_freezes_available` on profiles (default 1/week, regenerates weekly), auto-consumes when a missed day would break an active streak, UI surfacing on profile + home, animation when freeze fires. Depends on: F8.

### Tranche 4 — Acquisition Surface

⬜ **F10. Sharable result card** — ResultScreen "Share" button generates screenshot-ready card (score, accuracy, category, optional emoji grid for daily challenge); `expo-sharing` for native share sheet. The card *is* the marketing — design seriously. Depends on: F7 (shared daily challenge for the emoji-grid case), F8 (streak data on the card).

### Tranche 5 — Personalization

⬜ **F11. Skill estimate per player** — `skill_estimate` column on profiles, RPC updates after each completed session based on accuracy and difficulty. No UI surface — input to F12 only. Depends on: nothing.
⬜ **F12. Skill-aware paraphrasing** — render Edge Function (F4) accepts skill estimate; lower-skill profiles get shorter stems, more context, simpler vocabulary; higher-skill profiles get terser, harder phrasings. Depends on: F4, F11.

### Tranche 6 — Social Signal Test

Most cuttable tranche if runway compresses. Solo retention validated first via Tranches 1–4; this tranche tests whether latent social demand exists.

⬜ **F13. Friend code system** — 6-char alphanumeric per user, `friendships` table with accept/pending/blocked states, "Add Friend" surface accepts code. No contact import, no social graph. Depends on: nothing.
⬜ **F14. Friend-filtered leaderboard** — new "Friends" tab on LeaderboardScreen, same data shape as global leaderboard, filtered to accepted friendships. Depends on: F13.

### Tranche 7 — Habit Triggers

⬜ **F15. Push notification infrastructure** — Expo push service, iOS provisioning, Android FCM, permission flow on first launch (or after first session for better acceptance rate). Depends on: nothing.
⬜ **F16. Streak risk notification** — 8pm local trigger when user has active streak ≥2 days and hasn't played today; scheduled on each session completion. Depends on: F15, F8.
⬜ **F17. Daily challenge availability notification** — 9am local trigger daily; opt-out from settings. Most cuttable item in this tranche. Depends on: F15.

### Tranche 8 — Beta Release Gates

Not features — release prerequisites. Carried forward from prior tracker state.

✅ Local dev migrated to new Supabase API keys (sb_publishable / sb_secret) — INSTRUCTIONS_LOCAL_NEW_KEYS.md
⬜ Production Supabase project created — INSTRUCTIONS_PRODUCTION_SUPABASE.md
⬜ Production environment variables set in mobile app
⬜ Edge Functions deployed to production
⬜ EAS Build configured — INSTRUCTIONS_EAS_BUILD.md
⬜ Apple Developer account connected to EAS
⬜ App icon designed and implemented
⬜ Splash screen designed and implemented
⬜ Privacy policy page (trivolta.app/privacy)
⬜ TestFlight build submitted
⬜ 25 beta testers recruited and onboarded
⬜ Bug triage process defined (Sev 1/2/3)

*Note: "Feedback collection mechanism in place" is now F2 in Tranche 1.*

### Cuttable Order If Runway Compresses

1. **Tranche 6** (friend system) — most cuttable; testable post-beta if signal warrants.
2. **Tranche 5** (skill personalization) — F12 is a real differentiator but invisible to testers; defer if needed.
3. **Tranche 7 partial** — F17 (daily challenge nudge) droppable; F15+F16 (streak risk) is the high-value piece.

Tranches 1–4 are non-negotiable. They're what makes beta produce interpretable retention data.

### Explicitly NOT in Pre-Beta Scope

- New gameplay modes (timed/survival/head-to-head) — add post-beta if signal warrants.
- Achievements / XP buildout beyond decorative — derivative retention surface; doesn't fix bad retention.
- UGC custom topic shareable quizzes — too risky to ship half-baked.
- On-device caching (Phase 2.6.6) — defer; beta load too low to need it.
- Social-graph features beyond friend codes — covered in differentiation discussion; wrong rabbit hole right now.

### Deferred Pre-Beta Items (carry-forward, lower priority)

⬜ Cost optimization pass — prompt caching across all Anthropic-calling Edge Functions; consider Haiku for question rendering (~30% steady-state savings)
⬜ run_tests.sh exit-code masking — folded into Phase 2.6.7.
⬜ Wikipedia excerpt-match calibration — measure miss rate across categories; consider switching to flatter HTML sources where Wikipedia consistently fails. Post-beta unless `fact_reports` data shows correctness issues.
⬜ Top up `art` slug coverage — currently 76 facts vs ~400 in other slugs. Either re-run more `arts_and_literature` batches or import a focused art-only dataset from another source.

---

## Phase 3 — Beta Testing (gated on Phase 2.6.8 + Phase 2.9 Tranches 1–4)

See Phase 2.9 Tranche 8 for release-gate items.

---

## Phase 4 — Bug Fixing

⬜ All Sev 1 bugs resolved (crashes, data loss, auth failures)
⬜ All Sev 2 bugs resolved (broken flows, wrong data, bad UX)
⬜ Most Sev 3 bugs resolved (minor UI, edge cases)

---

## Phase 5 — Polish & Launch Prep

⬜ UI refinement pass — all screens
⬜ Animations and transitions
⬜ App Store screenshots (6.7" iPhone, required sizes)
⬜ App Store description and keywords
⬜ Support page (trivolta.app/support)
⬜ Google Play Store assets

---

## Phase 6 — Launch

⬜ App Store submission
⬜ Google Play submission
⬜ AdMob rewarded ads integration
⬜ Social media launch posts (TikTok, Instagram, X)
⬜ Product Hunt launch

---

## Known Issues / Tech Debt

- **`heroPlayBtnDone` style missing** — daily challenge "Completed ✓" button stays purple instead of green (DEVIATIONS.md #2). Fix in polish pass.
- **Leaderboard rank outside top 50** — `fetchUserStats` uses the `leaderboard` view which limits to 50 rows. Users ranked 51+ see rank 0 or null on ProfileScreen. Not fixed. (Folded into Phase 2.6.7.)
- **Daily challenge shared questions** — each user gets independently AI-generated questions for the same day. Intended design: all users get the same 10 questions. ~~Deferred as a product redesign.~~ Promoted to F7 in Phase 2.9 Tranche 3.
- **XP and level system is decorative** — ProfileScreen shows XP bar and level computed from score, but there is no real XP progression system, no level-up events, and no XP from daily challenge completion. Acceptable for beta, not for launch.
- **HomeScreen streak display hardcoded** — greeting area shows a hardcoded "🔥 3 day streak". Actual consecutive-day streak tracking from Supabase not implemented. ~~Cosmetic only.~~ Promoted to F8 in Phase 2.9 Tranche 3.
- **Achievements computed client-side** — unlock states derived from `gamesPlayed`, `bestStreak` etc. locally. No server-side achievement events, no push notifications on unlock. Acceptable for beta.
- **Android not tested** — all Maestro tests run on iOS Simulator only. Android parity assumed but untested.
- **test_18 manual-only** — QuestionScreen error/retry state cannot be automated in Maestro (requires killing Edge Functions mid-test). Must be manually verified before each beta release.
- **lobby/results play-again not fully tested** — test_26 verifies navigation to `/lobby/create` only; does not verify that the full subsequent create-lobby flow completes successfully.
- **AI source-citation excerpt-match misses on dynamically rendered pages** — Wikipedia and similar JS-rendered sites sometimes return raw HTML where the AI's quoted excerpt is not a substring. The mechanical check correctly flags these as failed. Combined with CIA Factbook deprecation (302 → farewell page), the only reliably matching authoritative source is Britannica. Not a code defect — working as designed. Drove the 2.6.3b/c/cross-check parking decision.
- **AI cross-check unvalidated** — the cross-check pass in `fact-bank-auto-seed` was never observed firing end-to-end because the mechanical-check gate failed first on every smoke-test fact. The architecture may be correct or may be broken; we don't know. Parked alongside 2.6.3b. Beta relies on `fact_reports` instead.
- **Fact correctness not spot-checked** — the 3,976 Trivia API facts have not been manually validated. The Trivia API has a fact_reports / community curation reputation but no Trivolta-side QA has been done. iPhone testing may surface incorrect answers; the player-feedback `fact_reports` table is the recovery mechanism, not pre-import validation.
- **Dev gameplay sees `pending` facts** — the verification gate is prod-only, so any garbage imported into local DB is immediately playable. If you import junk for testing, `dev-reset.sh` is the cheapest cleanup.
- **`art` slug under-represented** — 76 facts vs ~400 in other slugs. The Trivia API's `arts_and_literature` tag distribution skews literary. Worth knowing if `art` category gameplay feels thin during iPhone testing. Folded into Pre-Beta Checklist.
- **`Alert.alert` is iOS-only on React Native Web** — sign-out from /(tabs)/profile silently no-ops on Expo Web because Alert.alert isn't supported there. Workaround during admin work: clear localStorage + reload. Permanent fix folded into Phase 2.6.7. New admin code is required to use `window.confirm()` or custom modals instead.
- **`run_tests.sh` exit-code masking** — when run without a booted iOS Simulator, the `tee` pipe masks `maestro test`'s non-zero exit code and the script reports "25 passed". Folded into Phase 2.6.7. Until then, always confirm a simulator is booted before trusting a green result.

---

## INSTRUCTIONS Files Written
✅ INSTRUCTIONS_SETUP.md
✅ INSTRUCTIONS_AUTH.md
✅ INSTRUCTIONS_MAESTRO_AUTH.md
✅ INSTRUCTIONS_HOME_SCREEN.md
✅ INSTRUCTIONS_QUESTION_SCREEN.md
✅ INSTRUCTIONS_CUSTOM_CATEGORY_SCREEN.md
✅ INSTRUCTIONS_PROFILE_SCREEN.md
✅ INSTRUCTIONS_LEADERBOARD_SCREEN.md
✅ INSTRUCTIONS_LOBBY_CREATE_JOIN.md
✅ INSTRUCTIONS_LOBBY_WAITING.md
✅ INSTRUCTIONS_LOBBY_GAME.md
✅ INSTRUCTIONS_LOBBY_RESULTS.md
✅ INSTRUCTIONS_LOBBY_TESTS.md
✅ INSTRUCTIONS_SOLO_GAME_TESTS.md
✅ INSTRUCTIONS_DAILY_CHALLENGE.md
✅ INSTRUCTIONS_TECH_DEBT.md
✅ INSTRUCTIONS_MISSING_TESTS.md
✅ INSTRUCTIONS_CODE_REVIEW.md
✅ INSTRUCTIONS_BUG_FIXES.md
✅ INSTRUCTIONS_TEST_ISOLATION.md
✅ INSTRUCTIONS_LOCAL_NEW_KEYS.md
✅ INSTRUCTIONS_PHASE_2.6.1_SCHEMA_AND_ADMIN.md
✅ INSTRUCTIONS_PHASE_2.6.2_IMPORT_AND_SOURCING.md
✅ INSTRUCTIONS_PHASE_2.6.3_AUTOMATED_SEEDING.md
⏸ INSTRUCTIONS_PHASE_2.6.3c_CATEGORY_SOURCE_REGISTRY.md (parked — written but not handed to Claude Code)
✅ INSTRUCTIONS_PHASE_2.6.3d_TRIVIA_API_IMPORT.md
✅ INSTRUCTIONS_PHASE_2.6.3e_BULK_TRIVIA_API_SEED.md
⬜ INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md
⬜ INSTRUCTIONS_PHASE_2.6.5_MOBILE_CUTOVER.md
⬜ INSTRUCTIONS_PHASE_2.6.6_DEVICE_CACHING.md
⬜ INSTRUCTIONS_PHASE_2.6.7_CODE_FIXES.md
✅ INSTRUCTIONS_PRODUCTION_SUPABASE.md
⬜ INSTRUCTIONS_EAS_BUILD.md
⬜ INSTRUCTIONS_ADMOB.md (deferred post-launch)

### Phase 2.9 — Pre-Beta Feature Roadmap (to be written as needed)

⬜ INSTRUCTIONS_F1_DISTRACTOR_REGEN.md
⬜ INSTRUCTIONS_F2_FEEDBACK_CHANNEL.md
⬜ INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md (covers F4 + F5; already on disk)
⬜ INSTRUCTIONS_PHASE_2.6.5_MOBILE_CUTOVER.md (covers F6)
⬜ INSTRUCTIONS_F7_SHARED_DAILY_CHALLENGE.md
⬜ INSTRUCTIONS_F8_STREAK_TRACKING.md
⬜ INSTRUCTIONS_F9_STREAK_FREEZE.md
⬜ INSTRUCTIONS_F10_SHARE_CARD.md
⬜ INSTRUCTIONS_F11_F12_SKILL_PARAPHRASING.md
⬜ INSTRUCTIONS_F13_F14_FRIEND_SYSTEM.md
⬜ INSTRUCTIONS_F15_F16_F17_PUSH_NOTIFICATIONS.md
