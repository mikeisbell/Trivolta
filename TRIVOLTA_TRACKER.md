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

## Phase 3 — Beta Testing 🔄 NEXT

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
⬜ Feedback collection mechanism in place
⬜ Bug triage process defined (Sev 1/2/3)

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
- **Leaderboard rank outside top 50** — `fetchUserStats` uses the `leaderboard` view which limits to 50 rows. Users ranked 51+ see rank 0 or null on ProfileScreen. Not fixed.
- **Daily challenge shared questions** — each user gets independently AI-generated questions for the same day. Intended design: all users get the same 10 questions. Deferred as a product redesign.
- **XP and level system is decorative** — ProfileScreen shows XP bar and level computed from score, but there is no real XP progression system, no level-up events, and no XP from daily challenge completion. Acceptable for beta, not for launch.
- **HomeScreen streak display hardcoded** — greeting area shows a hardcoded "🔥 3 day streak". Actual consecutive-day streak tracking from Supabase not implemented. Cosmetic only.
- **Achievements computed client-side** — unlock states derived from `gamesPlayed`, `bestStreak` etc. locally. No server-side achievement events, no push notifications on unlock. Acceptable for beta.
- **Android not tested** — all Maestro tests run on iOS Simulator only. Android parity assumed but untested.
- **test_18 manual-only** — QuestionScreen error/retry state cannot be automated in Maestro (requires killing Edge Functions mid-test). Must be manually verified before each beta release.
- **lobby/results play-again not fully tested** — test_26 verifies navigation to `/lobby/create` only; does not verify that the full subsequent create-lobby flow completes successfully.

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
⬜ INSTRUCTIONS_PRODUCTION_SUPABASE.md
⬜ INSTRUCTIONS_EAS_BUILD.md
⬜ INSTRUCTIONS_ADMOB.md (deferred post-launch)
