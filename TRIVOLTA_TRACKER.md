# Trivolta — Project Tracker

## Status Key
✅ Done | 🔄 In Progress | ⬜ Pending | 🔴 Blocked

---

## Phase 1 — Feature Complete

### Infrastructure
✅ GitHub repo created — github.com/mikeisbell/Trivolta
✅ Local directory — /Users/mizzy/Developer/Trivolta
✅ Domain registered — trivolta.app
✅ Supabase project initialised (local)
✅ Database schema — profiles, scores, lobbies, lobby_players, lobby_questions, game_sessions, lobby_answers
✅ RLS policies on all tables
✅ Leaderboard view (top 50, last 30 days)
✅ Edge Functions — solo-question, generate-questions, create-lobby, join-lobby
✅ CLAUDE.md — project source of truth
✅ theme.ts — single source of visual truth

### Screens
✅ Auth screen — sign up, sign in, sign out, profile creation
✅ HomeScreen — greeting, hero daily challenge card, 2×2 category grid, tab navigator
✅ QuestionScreen — full solo game loop, timer, scoring, streak multiplier, explanation feedback
✅ ResultScreen — score, accuracy, XP bar, play again, home
✅ CustomCategoryScreen — any topic input, example prompts, trending categories
✅ ProfileScreen — real stats from Supabase, achievements, XP, level
✅ LeaderboardScreen — podium top 3, rank rows with movement arrows, global/weekly tabs
✅ Lobby — CreateLobbyScreen
✅ Lobby — JoinLobbyScreen
✅ Lobby — LobbyWaitingScreen (real-time player list via Supabase Realtime)
✅ Lobby — LobbyGameScreen (synchronous play, server-timestamp timer)
✅ Lobby — LobbyResultScreen (final scores for all players)
⬜ Daily Challenge — real implementation (not just a card)

### Core Features
✅ AI question generation (solo) — claude-sonnet-4-6
✅ Session-wide question deduplication
✅ Score saving to Supabase
✅ Streak multiplier scoring
✅ Difficulty auto-scaling by streak (easy/medium/hard)
✅ Tab navigator (Home, Play, Ranks, Profile)
✅ Auth routing gate
✅ Real-time lobby synchronisation (Supabase Realtime)
✅ Server-timestamp timer for lobby games
✅ Room code join flow
✅ Lobby question generation (all 10 before game start)
⬜ Daily challenge logic (server-side, resets at midnight)
⬜ AdMob rewarded ads integration
⬜ Trending categories from real play data (currently hardcoded)

---

## Phase 2 — Full Test Coverage

### Maestro E2E Tests
✅ test_01 — auth screen on launch
✅ test_02 — sign up
✅ test_03 — sign in
✅ test_04 — sign out
✅ test_05 — custom category flow
✅ test_06 — profile screen data
✅ test_07 — leaderboard display
✅ test_08 — solo game loop (start, answer, complete 10 questions, results)
✅ test_09 — play again from results
✅ test_10 — timer expiry (unanswered question)
✅ test_11 — streak tracking
✅ test_12 — create lobby
✅ test_13 — join lobby via room code
✅ test_14 — lobby game full flow
✅ test_15 — leave lobby (guest)

### Edge Case Coverage
⬜ Network failure during question fetch — retry UI
⬜ Network failure during answer submit — graceful fail
⬜ Full lobby (8 players) — join rejected
⬜ Expired room code — error handling
⬜ Duplicate username on sign up — friendly error

---

## Phase 3 — Beta Testing

⬜ Production Supabase project created
⬜ Production environment variables set
⬜ EAS Build configured
⬜ Apple Developer account connected to EAS
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

## Phase 5 — Polish

⬜ App icon designed and implemented
⬜ Splash screen designed and implemented
⬜ UI refinement pass — all screens
⬜ Animations and transitions
⬜ App Store screenshots (6.7" iPhone, required sizes)
⬜ App Store description and keywords
⬜ Privacy policy page (trivolta.app/privacy)
⬜ Support page (trivolta.app/support)
⬜ Google Play Store assets

---

## Phase 6 — Launch

⬜ App Store submission
⬜ Google Play submission
⬜ Social media launch posts (TikTok, Instagram, X)
⬜ Product Hunt launch

---

## Known Issues / Tech Debt
- Trending categories on CustomCategoryScreen are hardcoded — needs real Supabase query
- Daily challenge card on HomeScreen is visual only — needs real server-side logic
- Coin balance on HomeScreen is hardcoded — needs real implementation
- Streak display on HomeScreen is hardcoded — needs real data from Supabase
- XP and level system not yet implemented — ResultScreen XP bar is decorative

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
⬜ INSTRUCTIONS_DAILY_CHALLENGE.md
⬜ INSTRUCTIONS_ADMOB.md
⬜ INSTRUCTIONS_EAS_BUILD.md
⬜ INSTRUCTIONS_PRODUCTION_SUPABASE.md
