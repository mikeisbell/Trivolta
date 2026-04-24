# Trivolta — Claude Code Context

## What This App Is

Mobile trivia app for iOS and Android. Two modes: solo play and synchronous lobby play (up to 8 players). AI generates questions via the Anthropic API — no static question bank.

**Stack:** React Native (Expo), TypeScript, Supabase (auth + Postgres + Realtime + Edge Functions), AdMob (rewarded ads). TypeScript only — no Python, no separate backend server.

---

## API Key Rule

The mobile app never calls the Anthropic API directly. All AI calls go through Supabase Edge Functions. The Anthropic API key is stored as a Supabase secret — never in the mobile bundle, never in `.env` on the client side.

---

## Answer Shuffle Rule

Answers arrive pre-shuffled from the backend. `correct_index` reflects post-shuffle position. The mobile layer must not re-shuffle — doing so invalidates `correct_index` silently.

---

## Rewarded Ads Only

No interstitials, no banners. Do not add non-rewarded ad placements without an explicit product decision recorded in git.

---

## Lobby Game Rules

**Questions generated before game start — never during.** When a lobby host starts a game, the `generate-questions` Edge Function is called once, generates all 10 questions, and writes them to `lobby_questions`. No question generation happens mid-game.

**Server-timestamp timer.** Each question has a `starts_at` timestamp written by the server to `game_sessions`. Clients calculate `starts_at + 20 seconds = timer_end` and count down locally. Never use client clock as the source of truth for timing.

**Max lobby size is 8.** Enforced in the `create-lobby` Edge Function — not client-side. Attempts to join a full lobby return a 400 error.

**Room code is the join mechanism for friends-only lobbies.** 4-character alphanumeric code generated at lobby creation. No in-app friend graph needed for v1.

---

## Verification Commands

**Mobile (compile):** `cd mobile && npx tsc --noEmit`
**Mobile (run):** `cd mobile && npx expo start` — press `i` for iOS Simulator, `a` for Android Emulator
**Supabase (local):** `supabase start` — starts local Postgres + Edge Functions + Realtime
**Diff:** `git diff HEAD > ~/trivolta_diff.txt`

---

## Local Dev Prerequisites

`supabase/seed.sql` must exist (even if empty) or `supabase db reset` will fail silently and leave migrations unapplied. The file exists at `supabase/seed.sql` — do not delete it.

---

## CLAUDE.md Update Rule

Add an entry only when you discover a constraint that:
1. Is not expressed in code
2. Would cause a wrong decision if absent

Do not append build summaries, feature lists, or task completions. Those belong in git.
