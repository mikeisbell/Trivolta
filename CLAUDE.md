# Quizly — Claude Code Context

## What This App Is

Mobile trivia app for iOS and Android. AI generates every question live via the Anthropic API — no static question bank.

**Stack:** React Native (Expo), TypeScript, Supabase (auth + Postgres), FastAPI (Python backend), AdMob (rewarded ads).

---

## API Key Rule

The mobile app never calls the Anthropic API directly. All AI calls go through the FastAPI backend. This keeps the API key server-side. Do not add Anthropic API calls to the mobile layer under any circumstances.

---

## Answer Shuffle Rule

Answers arrive pre-shuffled from the backend. `correct_index` reflects post-shuffle position. The mobile layer must not re-shuffle — doing so invalidates `correct_index` silently.

---

## Rewarded Ads Only

No interstitials, no banners. Do not add non-rewarded ad placements without an explicit product decision recorded in git.

---

## Verification Commands

**Backend:** `cd backend && pytest tests/ -v`
**Mobile (compile):** `cd mobile && npx tsc --noEmit`
**Mobile (run):** `cd mobile && npx expo start` — press `i` for iOS Simulator, `a` for Android Emulator
**Diff:** `git diff HEAD > /tmp/quizly_diff.txt`

---

## CLAUDE.md Update Rule

Add an entry only when you discover a constraint that:
1. Is not expressed in code
2. Would cause a wrong decision if absent

Do not append build summaries, feature lists, or task completions. Those belong in git.
