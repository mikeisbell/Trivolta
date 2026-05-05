# Trivolta — Tech Debt Audit (2026-05-04, v2)

**v2 corrects v1.** The first pass had arithmetic errors, severity inflation in three places, severity *deflation* in one place that materially matters (item 3.1), one self-contradicting recommendation, and several gaps. This version fixes those.

**v1 is gone.** I overwrote it when writing v2 instead of saving it as `TECH_DEBT_AUDIT_2026_05_04_v1.md` first. The audit trail I promised does not exist. The body of v2 documents what changed (severity demotions/promotions are noted inline as `(v1 said X. Demoted/Promoted because Y.)`).

**Self-review caveats up front.**
- I did **not** read `mobile/dev-reset.sh`, `mobile/seed-opentdb.sh`, the admin screens under `mobile/app/admin/`, or the 27 Maestro YAML flows. Items derived from those areas may exist and are not in this audit. Logged as gaps at the bottom.
- Some severity ratings are opinionated and reflect my best guess at how a beta tester would experience the app. Re-rate freely.
- I cross-checked against `INSTRUCTIONS_TECH_DEBT.md` and `DEVIATIONS.md`; reconciliation notes are inline.

---

## Scope

**In scope:** broken or inconsistent code, contract drift between layers, dead code, UI copy that lies, docs that contradict reality, test gaps, migration shape problems, recoverable operational risk.

**Out of scope:** future features, performance optimizations at beta scale, items already roadmapped to Phase 2.6.6+ unless they materially affect the beta UX.

---

## Severity definitions

- **Beta-blocker** — fix before TestFlight. Either user-visibly broken, user-visibly lying, or will silently corrupt data/UX during normal beta usage.
- **Pre-beta-cleanup** — should be done before TestFlight; testers will not encounter it but it's debt that compounds if left.
- **Post-beta** — legitimate debt, not urgent for TestFlight.

---

## Item count

**42 line items, 41 distinct concerns** (N3 is subsumed by 1.1).
**7 beta-blockers, 17 pre-beta-cleanup, 17 post-beta, 1 subsumed.**

(v1 was inconsistent: claimed 36, listed 41 across categories, summary table summed 38. I made the same class of error in v2's first draft — this section now reflects the actual table at the bottom of this document, derived row-by-row.)

| Category | Count | Beta-blocker | Pre-beta | Post-beta |
|---|---|---|---|---|
| 1. Contract drift mobile↔server (1.1–1.7) | 7 | 5 | 1 | 1 |
| 2. Code vs. architecture mismatch (2.1–2.5) | 5 | 0 | 4 | 1 |
| 3. Dead, hardcoded, or unused code (3.1–3.10) | 10 | 1 | 3 | 6 |
| 4. Tests, runtime, operational (4.1–4.6) | 6 | 0 | 4 | 2 |
| 5. Schema and migrations (5.1–5.4) | 4 | 0 | 1 | 3 |
| 6. Edge Functions and API surface (6.1–6.6) | 6 | 1 | 2 | 3 |
| New items found on re-review (N1–N4) | 4 | 0 | 2 | 1 (+1 subsumed) |
| **Total** | **42** | **7** | **17** | **17** (+1 subsumed) |

Per-category numbers verified by reading each item's severity in the body. Across all categories, the row-by-row tally matches the totals row.

---

## Category 1 — Contract drift between mobile and Edge Functions

### 1.1 — Mobile sends display labels for `category`; server normalizes silently
**Severity:** beta-blocker
**Where:** `mobile/app/(tabs)/index.tsx:12-17` (CATEGORIES has both `id` and `label`, `onPress` sends `cat.label`); `mobile/app/lobby/create.tsx:11-16` (duplicate CATEGORIES const, same problem); `mobile/app/custom-category.tsx` (sends free-form input verbatim); `supabase/functions/solo-question/index.ts:50` (server-side normalizer absorbs the inconsistency).
**Why it's debt:** The server-side normalizer (lowercase + space-to-hyphen + fallback to `general`) papers over an inconsistent client. Eight call sites hand the Edge Function strings of unpredictable shape.
**Fix:** One canonical category list in `mobile/lib/categories.ts` with `{ slug, displayLabel, emoji }`. Every screen reads from it. Server normalizer becomes a strict slug validator that 400s on unknown slugs.
**Note:** This item is the immediate trigger for the audit.

### 1.2 — `pop_culture` (mobile) vs `pop-culture` (DB) slug mismatch
**Severity:** beta-blocker
**Where:** `mobile/app/(tabs)/index.tsx:13` and `mobile/app/lobby/create.tsx:12` (both `id: 'pop_culture'`); DB has `'pop-culture'` per `supabase/migrations/20240106000000_fact_bank_schema.sql:200`.
**Why it's debt:** The strings disagree. Today's flow works only because the client sends `cat.label` ("Pop culture" with a space), and the server normalizer happens to convert that to `pop-culture`. The day someone "fixes" the client to send `cat.id` for consistency, every Pop Culture request silently falls back to `general`. There are TWO copies of this mistake (home and lobby create), so it must be fixed in both call sites.
**Fix:** Subsumed by 1.1. The shared categories module uses the DB slug.

### 1.3 — `question.tsx` hardcodes `'general knowledge'` (with a space) as fallback
**Severity:** beta-blocker
**Where:** `mobile/app/question.tsx:75` `category ?? 'general knowledge'`. Echoed at lines 117 and 122 inside `saveScore` and `handleNext`.
**Why it's debt:** Two-word string with a space, not a valid DB slug. Survives only because the server normalizer falls back to `general` when no facts match. If `category` is ever undefined, the Results screen shows "general knowledge · 5/10 correct" — which doesn't match anything else in the app and looks broken.
**Fix:** Subsumed by 1.1. Shared categories module exports a default slug constant.

### 1.4 — Custom Category screen UI copy lies about AI generation
**Severity:** beta-blocker
**Where:** `mobile/app/custom-category.tsx:127` ("AI generates your quiz in seconds"). Trending row meta text at `:184` ("plays today · AI-generated"). Example prompts row at `:54-61` offers things like "Seinfeld episodes," "NASA missions," "The Beatles discography" that the app cannot deliver post-DB-rewrite.
**Why it's debt:** Outright false post-solo-question-rewrite. Tap "NASA missions" → silently get a random general-knowledge question. This is a UX integrity problem, not just a code problem.
**Fix options:**
- (a) Hide the custom-category card from the home grid for beta. Keep file on disk for post-beta restore. **Recommended.**
- (b) Carve out custom-category as the *only* AI path — keep one Anthropic-calling Edge Function for free-form topics, DB for canonical categories. More work, more risk.
- (c) Rewrite copy to "Pick from canonical categories." Defeats the feature.

### 1.5 — Lobby create has the same category contract problem as solo
**Severity:** beta-blocker (will surface at lobby DB-rewrite time)
**Where:** `mobile/app/lobby/create.tsx:32` — `effectiveCategory` is the display label or free-form custom text. Sent to `createLobby(category)` → `create-lobby` Edge Function → `generate-questions`.
**Why it's debt:** `generate-questions` still calls Anthropic and accepts any string, so the bug is masked today. The moment lobby is replaced with DB lookup, lobbies created with custom topics ("90s video games") will have zero matching facts.
**Fix:** Subsumed by 1.1 (shared module) plus the lobby DB-rewrite.

### 1.6 — Display rendering of slug strings on `question.tsx`
**Severity:** post-beta
**Where:** `mobile/app/question.tsx:179` renders `{category}` directly with `textTransform: 'capitalize'`.
**Why it's debt:** With slug-over-wire (post-1.1), the UI shows "Pop-Culture" or "General" — readable but ugly. Cosmetic, not broken.
**Fix:** Use `displayLabel(slug)` from the shared categories module.
**(v1 noted this as pre-beta-cleanup. Demoted because it doesn't break anything; testers will read it as the category name.)**

### 1.7 — `daily-challenge` Edge Function returns hardcoded `category: 'Mixed trivia'`
**Severity:** pre-beta-cleanup
**Where:** `supabase/functions/daily-challenge/index.ts:38`.
**Why it's debt:** The Edge Function returns "Mixed trivia" as the category. The QuestionScreen displays it, then sends it to `solo-question`. Server normalizes to "mixed-trivia" → no facts → fallback to general. Works by coincidence. The mismatch between the displayed label ("Mixed trivia") and the actual gameplay (general-knowledge questions) is invisible to users today only because the questions don't have a visible category attribution beyond the screen label.
**Fix:** Couple with item 3.10 below; either land F7 or change the hardcoded string to `'general'` and the displayed label to "General."

---

## Category 2 — Code that contradicts current architecture

### 2.1 — `CLAUDE.md` opening line says AI generates every question
**Severity:** pre-beta-cleanup
**Where:** `CLAUDE.md:5-7` "AI generates questions via the Anthropic API — no static question bank."
**Why it's debt:** Wrong post-solo-question-rewrite. Will be wrong-er post-lobby-rewrite.
**Fix:** Mike has explicitly said this update is post-merge of the current diff. Tracked.
**(v1 rated this beta-blocker. Demoted: it's a doc, not user-facing, with a clear pending update.)**

### 2.2 — `TRIVOLTA_ARCHITECTURE.md` describes pre-2.6.5 architecture as current
**Severity:** pre-beta-cleanup
**Where:** Whole document. The "Solo game (current, pre-Phase 2.6.5)" section, the system diagram, the cost-shape paragraphs.
**Why it's debt:** Canonical architecture document will be stale immediately after solo-question lands.
**Fix:** Single rewrite pass after both Edge Function rewrites land. Don't update incrementally.

### 2.3 — `TRIVOLTA_TRACKER.md` Core Features list contains items that are no longer accurate
**Severity:** pre-beta-cleanup
**Where:** `TRIVOLTA_TRACKER.md` "Core Features" section.
**Why it's debt:** "AI question generation (solo) — claude-sonnet-4-6" listed as a ✅ Phase 1 feature; will be wrong post-rewrite. "Trending categories from real play data" listed as ✅, but `custom-category.tsx:75-95` falls back to a hardcoded TRENDING array if the query returns < 4 rows, and on a fresh DB it always returns 0.
**Fix:** Revisit Core Features after Phase 2.6.5. Either downgrade or qualify with the fallback note.

### 2.4 — `facts` table is a question bank with a misleading name
**Severity:** post-beta
**Where:** `supabase/migrations/20240106000000_fact_bank_schema.sql`. Documented in `TRIVOLTA_HALLUCINATION_STRATEGY.md` ("Important context").
**Why it's debt:** The schema accepted bad data shape silently because `fact_text` is unconstrained text. Every new contributor will be confused for the same reason. The hallucination doc captured this honestly but no rename is on any roadmap.
**Fix:** Defer. Either rename column/table or add structured triple columns. Add to "Post-Beta Restoration" so it's not lost.

### 2.5 — Phase 2.6.4 / 2.6.5 marked ⬜ in tracker; both are now obsolete
**Severity:** pre-beta-cleanup
**Where:** `TRIVOLTA_TRACKER.md` Phase 2.6 section — entries for `INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md` and `INSTRUCTIONS_PHASE_2.6.5_MOBILE_CUTOVER.md`.
**Why it's debt:** Cancelled per `HANDOFF_2026_05_04.md`. Replacement specs (`INSTRUCTIONS_REPLACE_SOLO_QUESTION.md`, `INSTRUCTIONS_REPLACE_LOBBY_QUESTIONS.md`) are listed as parallel entries but the original phases are not marked ⏸. Future-Mike or future-Claude reading the tracker will think both architectures are roadmapped.
**Fix:** Mark 2.6.4 and 2.6.5 ⏸ with a one-line note pointing at the replacements. **Leave 2.6.6 / 2.6.7 / 2.6.8 alone — they may still apply.**
**(v1 said "2.6.4 / 2.6.5 / 2.6.6 / 2.6.7 / 2.6.8 are now partially obsolete" in the title but the body said only 2.6.4–5. Title corrected.)**

---

## Category 3 — Dead, hardcoded, or unused code

### 3.1 — `gameHistory` is a user-session-scoped store passed as intra-game `previousQuestions`; will exhaust small categories during beta
**Severity:** beta-blocker
**Where:** `mobile/lib/gameHistory.ts` (module-scoped `categoryHistory: Record<string, string[]>`, cleared only in `auth.signOut()`); `mobile/app/question.tsx:75` (passes `getHistory(category)` to `previousQuestions`).
**Why it's debt:** The history grows across the entire user session — never bounded, never trimmed, never cleared between games. The Edge Function selects from a 200-row pool and excludes anything in `previousQuestions`. Combined: a beta tester playing repeatedly in a small category will hit `no_questions_available` mid-session. Concrete failure points:
- **Art (49 facts):** game 5 gets `no_questions_available` after seeing all 40 questions across 4 games.
- **Literature (109 facts):** game 11.
- **Sports (160 facts):** game 16.
- **Science / History / Geography (275–391 facts):** beyond beta scope but eventually.
A beta tester picking "Art" twice and replaying each could fail to load on game 5. They'll see a hard error.
**Fix (beta):** Clear the per-category history on game start (`fetchQuestion` first call after entering question screen). Keep within-game dedup only. Or: drop client-side dedup entirely, ship without it, and tolerate the (rare) intra-game repeat for beta.
**Recommendation:** Per-game scope. ~5 lines.
**(v1 rated this pre-beta-cleanup AND mis-titled it as "process-global Map that resets on every navigation" — the opposite of what the file does. Both errors corrected.)**

### 3.2 — `INSTRUCTIONS_PHASE_2.6.4_RENDER_AND_COMPOSE.md` still on disk but cancelled
**Severity:** post-beta
**Where:** Repo root.
**Why it's debt:** `HANDOFF_2026_05_04.md` says "do not execute it." The file itself doesn't say so. A future session listing the directory has to know external context.
**Fix:** Add a `# CANCELLED — superseded by INSTRUCTIONS_REPLACE_SOLO_QUESTION.md` header line.
**(v1 rated this pre-beta-cleanup. Demoted: it is invisible to beta testers and HANDOFF documents the cancellation.)**

### 3.3 — `INSTRUCTIONS_PHASE_2.6.3c_CATEGORY_SOURCE_REGISTRY.md` parked but undocumented in the file itself
**Severity:** post-beta
**Where:** Repo root. Tracker says ⏸. File header doesn't.
**Fix:** Add a header. Bundle with 3.2.

### 3.4 — `mobile/seed-trivia-api.sh` is dead infrastructure
**Severity:** post-beta
**Why it's debt:** Trivia API was wiped (non-commercial license). The seed script invites future-someone to re-run it.
**Fix:** Move to `archived/seeding/`.

### 3.5 — `mobile/smoke-test-cross-check.sh` is parked infrastructure
**Severity:** post-beta
**Why it's debt:** Cross-check pipeline is parked for beta. Smoke test sits idle.
**Fix:** Bundle with 3.4.

### 3.6 — XP and level system on `profile.tsx` is decorative
**Severity:** pre-beta-cleanup
**Where:** `mobile/app/(tabs)/profile.tsx:13-22` (XP/level computed from `total_score / 1000`); XP bar UI `:168-180`.
**Why it's debt:** Looks like real progression. Beta testers will treat it as such. Acknowledged in tracker ("Acceptable for beta, not for launch") — but I disagree with that assessment given the user-experience implications.
**Fix options:**
- (a) Hide XP UI for beta. Cleanest.
- (b) Re-label to "Points to next milestone" — preserves visual rhythm.
**Recommendation:** (b).

### 3.7 — Achievements computed client-side
**Severity:** post-beta
**Where:** `mobile/app/(tabs)/profile.tsx:38-92`.
**Why it's debt:** No unlock events, no notifications. Display correctly. Acceptable for beta.

### 3.8 — `auth.tsx` constructs a second Supabase client for profile upsert
**Severity:** post-beta
**Where:** `mobile/lib/auth.tsx:43-54`.
**Why it's debt:** Manual `createClient` with header injection. Sidesteps the singleton. Works because of a real timing issue with sign-up JWT propagation. Smell, not a bug.
**Fix:** Either move profile creation server-side (Edge Function or trigger) or wait for the auth state listener.
**(v1 rated this pre-beta-cleanup. Demoted: works, no user-facing issue. Real cleanup, but not pre-TestFlight.)**

### 3.9 — `Alert.alert` breaks on Expo Web for sign-out
**Severity:** pre-beta-cleanup
**Where:** `mobile/app/(tabs)/profile.tsx:106-119`.
**Why it's debt:** Sign-out silently no-ops on Expo Web. Beta testers won't hit this (they use native), but Mike does daily during admin work.
**Fix:** Platform.select pattern: `Alert.alert` on native, `window.confirm` on web.

### 3.10 — `daily-challenge` Edge Function does not generate or pre-fetch questions
**Severity:** pre-beta-cleanup
**Where:** `supabase/functions/daily-challenge/index.ts` — entire function.
**Why it's debt:** Returns metadata only (id, category, completion). QuestionScreen calls `solo-question` per question. Two players doing the daily challenge get **completely different** questions. F7 in Phase 2.9 Tranche 3 is the proper fix.
**Fix:** F7 lands → ✅. F7 slips → hide the daily challenge UI for beta. Do not ship "daily challenge" with non-shared questions; the name lies.

---

## Category 4 — Tests, runtime, and operational

### 4.1 — `test_18` (question error/retry) non-automatable
**Severity:** pre-beta-cleanup
**Why it's debt:** Acknowledged. Manual check before every beta release.
**Fix:** Accept the manual check.

### 4.2 — `test_27` (feedback FAB) non-automatable
**Severity:** pre-beta-cleanup
**Why it's debt:** Acknowledged. react-native-screens 4.16 + newArch issue. Manual check required.
**Fix:** Accept until react-native-screens upgrade fixes it.

### 4.3 — `test_26` (lobby results play-again) does not verify subsequent create flow
**Severity:** pre-beta-cleanup
**Where:** Tracker explicitly notes this.
**Why it's debt:** Asserts navigation only. ~30 minutes to extend.

### 4.4 — Maestro suite is iOS-only
**Severity:** post-beta
**Why it's debt:** Acknowledged. Android parity assumed but unverified.
**Fix:** Defer to Android launch.

### 4.5 — `supabase db reset` workflow has no recovery wrapper
**Severity:** pre-beta-cleanup
**Where:** `mobile/dev-reset.sh`, `mobile/seed-opentdb.sh`, `CLAUDE.md` "Admin Role Setup."
**Why it's debt:** After every reset, three things must happen: (a) re-grant admin to dev account, (b) re-run `seed-opentdb.sh`, (c) optionally re-run distractor regen ($18+). No wrapper. Today's near-mistake (the original INSTRUCTIONS file casually included `supabase db reset` and would have wiped 3,285 facts) shows the cost.
**Fix:** Write `dev-after-reset.sh` wrapping admin grant + seed. Add explicit warning to `CLAUDE.md`.
**(v1 rated this beta-blocker. Demoted: it's a developer-experience risk, not a tester-facing one. Pre-beta-cleanup is correct severity.)**

### 4.6 — `regenerate-distractors.sh` and F1 investigation artifacts in repo root
**Severity:** post-beta
**Where:** `mobile/regenerate-distractors.sh`, `F1_QUALITY_DATA.txt`, `collect-f1-quality-data.sh`.
**Why it's debt:** Used once, sitting there. Repo root should be active artifacts.
**Fix:** Move to `archived/f1-investigation/`. Bundle with 3.4 / 3.5.

---

## Category 5 — Schema and migrations

### 5.1 — Migration timestamps use `2024-01-XX` format despite landing in 2026
**Severity:** post-beta
**Where:** All ten migrations `20240101000000` through `20240110000000`.
**Why it's debt:** Cosmetic. Future migrations are visually indistinguishable from the early ones. A reader assumes the schema froze in Jan 2024.
**Fix:** Going forward: real dates. Don't rewrite history (migrations are immutable). Document the cutover in CLAUDE.md.
**(v1 rated this pre-beta-cleanup. Demoted: cosmetic, no functional impact.)**

### 5.2 — `facts.fact_text` stores questions in a freeform text column
**Severity:** post-beta
**Why it's debt:** Schema discipline issue documented in `TRIVOLTA_HALLUCINATION_STRATEGY.md`. Coupled to 2.4.
**Fix:** Defer. Add to Post-Beta Restoration.

### 5.3 — `verification_status` machinery is inert in the beta path
**Severity:** post-beta
**Where:** `facts.verification_status`, `categories.verification_standard`, `fact_sources` table, `check_fact_verification` trigger.
**Why it's debt:** All 3,285 facts are `'pending'`. Nothing transitions them. The trigger is inert. Carrying complexity that nothing exercises is a maintenance liability.
**Fix:** Defer. Roadmapped under Post-Beta Restoration.

### 5.4 — `lobby_questions` schema does not record `fact_id` provenance
**Severity:** pre-beta-cleanup
**Where:** `supabase/migrations/20240101000000_initial_schema.sql` (lobby_questions: question, answers jsonb, correct_index — all freeform).
**Why it's debt:** Lobby DB-rewrite needs `fact_id` to link rendered lobby questions back to their source fact. Without it, `fact_reports` from lobby gameplay can't be associated with the underlying fact for player-feedback recovery.
**Fix:** Add `fact_id uuid references public.facts(id)` to `lobby_questions` as part of the lobby-DB-rewrite work. The lobby rewrite is the natural moment.
**(v1 rated this post-beta. Promoted: the lobby DB-rewrite is itself pre-beta, and shipping it without `fact_id` means the recovery path documented elsewhere doesn't work for lobby gameplay.)**

---

## Category 6 — Edge Functions and API surface

### 6.1 — Auth preamble duplicated across ~10 Edge Functions
**Severity:** post-beta
**Where:** `solo-question`, `generate-questions`, `create-lobby`, `join-lobby`, `daily-challenge`, `submit-feedback`, `submit-spot-check`, three `fact-bank-*` functions. Each hand-rolls the apikey-header-with-env-fallback pattern + `auth.getUser()` + 401 path.
**Why it's debt:** Pattern is ~12 lines, repeated ~10 times. A change in one (e.g. log unauthenticated calls) requires touching all of them.
**Fix:** Extract `_shared/auth.ts` with `requireUser(req): Promise<{ user, userClient } | Response>` (Response = 401 to return directly).
**Note:** `_shared/` exists and contains `auto_seed_pipeline.ts`, `opentdb-category-map.ts`, `trivia-api-category-map.ts`. Adding `auth.ts` is consistent with that directory's purpose.
**(v1 rated this pre-beta-cleanup. Demoted: it's refactor cleanup, no functional issue. Real but not urgent. v1 also incorrectly said the directory was "empty (or close to it)" — corrected.)**

### 6.2 — `generate-questions` still calls Anthropic on every lobby start
**Severity:** beta-blocker
**Where:** `supabase/functions/generate-questions/index.ts`.
**Why it's debt:** Until the lobby DB-rewrite, every lobby costs ~$0.05 in Anthropic calls and inherits all of solo's old issues (hallucination risk, no source provenance, accepts any category string). For beta with even 50 lobby games/day, that's $2.50/day burn that the architecture review already decided to eliminate.
**Fix:** `INSTRUCTIONS_REPLACE_LOBBY_QUESTIONS.md` (not yet written).
**(v1 rated this pre-beta-cleanup. Promoted: this is a planned beta-blocker hiding under the "scheduled work" framing. It's the next big task on the roadmap and has the same legal+UX concerns as solo did.)**

### 6.3 — `solo-question` `correct_index` via `indexOf` has a latent collision risk
**Severity:** post-beta
**Where:** `supabase/functions/solo-question/index.ts:103` `answers.indexOf(fact.correct_answer)`.
**Why it's debt:** If a distractor string equals the correct answer, `indexOf` returns the first match. OpenTrivia DB de-dupes on import so risk is near-zero today, but the pattern is fragile.
**Fix:** Defer. Refactor to shuffle `[{answer, isCorrect}]` tuples when convenient.

### 6.4 — `solo-question` random-samples from a 200-row pool
**Severity:** pre-beta-cleanup
**Where:** `supabase/functions/solo-question/index.ts:62-72`.
**Why it's debt:** Two issues. (a) Random selection from `.limit(200)` biases toward the first 200 rows by insertion order. For categories > 200 facts (general 641, pop-culture 540, film 423, music 391, history 391, geography 306, science 275), facts beyond row 200 are unreachable. (b) Wasted DB transfer. **Coupled to 3.1:** with the gameHistory bug, players in those large categories also accumulate exclusions only against the same 200-row pool — the unreachable facts can't even be revealed by exhausting the visible ones.
**Fix:** RPC: `select * from facts where ... order by random() limit 1`. ~10 lines.
**(v1 rated this post-beta and treated it independently from 3.1. Promoted and coupled: 3.1 is the user-visible failure; 6.4 is the structural cause that compounds it. Both should be fixed in the same INSTRUCTIONS file.)**

### 6.5 — `fetchUserStats` returns null silently on no-session
**Severity:** pre-beta-cleanup
**Where:** `mobile/lib/api.ts:60`.
**Why it's debt:** Profile screen renders an empty profile with all-zero stats and no error if there's no session. Looks identical to a fresh user. If RLS misconfigures later, this masks the auth failure as empty data.
**Fix:** Discriminated return type or throw.

### 6.6 — `fetchUserStats` scans the leaderboard view for rank
**Severity:** post-beta
**Where:** `mobile/lib/api.ts:75`.
**Why it's debt:** Acknowledged. Returns 0/null for users outside top 50.
**Fix:** Roadmapped for Phase 2.6.7 as `get_user_rank(user_id)` RPC.

---

## New items found on re-review (not in v1)

### N1 — `heroPlayBtnDone` style still missing — daily challenge "Completed ✓" button stays purple
**Severity:** pre-beta-cleanup
**Where:** Per `DEVIATIONS.md` #2 and `mobile/app/(tabs)/index.tsx:67-99`. The "Completed ✓" state of the daily challenge hero button uses the same purple `heroPlayBtn` style as the active "Play →" state.
**Why it's debt:** v1 missed this entirely. It's a visible UI bug on the home screen — beta testers see the same purple button whether the challenge is done or not. DEVIATIONS.md #2 marked it "Accepted — purple is visually acceptable for v1," but that decision was made before the no-debt-before-beta posture.
**Fix:** Add the missing style. ~8 lines.

### N2 — Anthropic API key cleanup window after lobby DB-rewrite
**Severity:** post-beta
**Where:** `supabase/.env.local`, Supabase production secrets, all Edge Functions importing `Anthropic`.
**Why it's debt:** After both `solo-question` and `generate-questions` are DB-backed, the Anthropic key is unused by gameplay. Still needed by admin tooling (`fact-bank-validate-source`, `fact-bank-generate-distractors`). Until Tranche 2 (F4–F6) lands, the key gets re-introduced for paraphrasing. Worth tracking explicitly so the key isn't forgotten in `.env.local` or accidentally rotated in a way that breaks admin tooling.
**Fix:** Add a "Anthropic Key Lifecycle" note to CLAUDE.md after lobby rewrite.

### N3 — Two duplicate `CATEGORIES` constants (mobile)
**Severity:** subsumed by 1.1, but worth naming
**Where:** `mobile/app/(tabs)/index.tsx:12-17` and `mobile/app/lobby/create.tsx:11-16`. Two near-identical const arrays defining categories.
**Why it's debt:** Both contain the `pop_culture` (underscore) bug. Both will go stale at different rates. Custom-category screen has its own `CATEGORY_EMOJI` lookup (a third source).
**Fix:** Subsumed by 1.1's shared module.

### N4 — `INSTRUCTIONS_TECH_DEBT.md` (existing file) reconciliation
**Severity:** pre-beta-cleanup
**Where:** `INSTRUCTIONS_TECH_DEBT.md` at repo root.
**Why it's debt:** v1 noted the file existed but didn't reconcile. The file lists 4 specific items: (1) coin badge removal, (2) quick-play random category, (3) XP bar removal, (4) trending categories from real data. Reading the current code:
- Item 1 (coin badge): home screen has no `coinBadge` JSX visible in current `index.tsx`. **Likely done.**
- Item 2 (quick-play random): current `index.tsx:139` uses `PLAYABLE_CATEGORIES` (filtered to non-custom). **Done.**
- Item 3 (XP bar on ResultScreen): current `results.tsx` has no XP block. **Done.** But the equivalent XP UI on `profile.tsx` is still there — which is item 3.6 of this audit, distinct concern.
- Item 4 (trending from real): implemented in `custom-category.tsx:75-95` with hardcoded fallback when query returns < 4. **Done with caveat (caveat = item 2.3).**
The file itself is not marked complete or removed.
**Fix:** Mark `INSTRUCTIONS_TECH_DEBT.md` as superseded — either rename/move or add a status header. Update tracker accordingly.

---

## Summary table

| ID | Severity | Title (short) |
|---|---|---|
| 1.1 | beta-blocker | Mobile sends display labels for category |
| 1.2 | beta-blocker | `pop_culture` vs `pop-culture` slug mismatch |
| 1.3 | beta-blocker | `'general knowledge'` fallback hardcoded |
| 1.4 | beta-blocker | Custom Category UI lies about AI |
| 1.5 | beta-blocker | Lobby create has same contract problem |
| 1.6 | post-beta | Slug-as-display-label rendering |
| 1.7 | pre-beta | `daily-challenge` returns "Mixed trivia" string |
| 2.1 | pre-beta | CLAUDE.md says AI generates every question |
| 2.2 | pre-beta | TRIVOLTA_ARCHITECTURE.md describes pre-2.6.5 |
| 2.3 | pre-beta | TRIVOLTA_TRACKER Core Features stale |
| 2.4 | post-beta | `facts` table is misleadingly named |
| 2.5 | pre-beta | Phase 2.6.4/2.6.5 not marked obsolete |
| 3.1 | beta-blocker | gameHistory unbounded — small categories fail |
| 3.2 | post-beta | Cancelled INSTRUCTIONS file undocumented |
| 3.3 | post-beta | Parked INSTRUCTIONS file undocumented |
| 3.4 | post-beta | `seed-trivia-api.sh` dead |
| 3.5 | post-beta | `smoke-test-cross-check.sh` parked |
| 3.6 | pre-beta | Profile XP system decorative |
| 3.7 | post-beta | Achievements client-side |
| 3.8 | post-beta | auth.tsx constructs second client |
| 3.9 | pre-beta | Alert.alert breaks on Expo Web |
| 3.10 | pre-beta | `daily-challenge` doesn't generate questions |
| 4.1 | pre-beta | test_18 manual-only |
| 4.2 | pre-beta | test_27 manual-only |
| 4.3 | pre-beta | test_26 doesn't verify create flow |
| 4.4 | post-beta | Maestro iOS only |
| 4.5 | pre-beta | supabase db reset workflow no wrapper |
| 4.6 | post-beta | F1 investigation artifacts in root |
| 5.1 | post-beta | Migration timestamps frozen at 2024-01 |
| 5.2 | post-beta | `fact_text` stores questions |
| 5.3 | post-beta | `verification_status` machinery inert |
| 5.4 | pre-beta | `lobby_questions` lacks `fact_id` |
| 6.1 | post-beta | Auth preamble duplicated ~10 times |
| 6.2 | beta-blocker | `generate-questions` still calls Anthropic |
| 6.3 | post-beta | `correct_index` via `indexOf` |
| 6.4 | pre-beta | `solo-question` 200-row sampling bias |
| 6.5 | pre-beta | `fetchUserStats` silent null |
| 6.6 | post-beta | `fetchUserStats` rank scan |
| N1 | pre-beta | `heroPlayBtnDone` style missing |
| N2 | post-beta | Anthropic key lifecycle window |
| N3 | (subsumed) | Duplicate CATEGORIES consts |
| N4 | pre-beta | `INSTRUCTIONS_TECH_DEBT.md` reconciliation |

**Verified counts** (from this table, row by row): 7 beta-blockers, 17 pre-beta-cleanup, 17 post-beta, 1 subsumed. 42 line items, 41 distinct concerns. Matches the opening.

---

## Proposed remediation INSTRUCTIONS files (revised)

v1 had 8 files, one of which (F: `DOC_SYNC.md`) self-contradicted my own "do not bundle" rule. v2 splits that file and re-orders.

**A. `INSTRUCTIONS_CATEGORY_CONTRACT_CLEANUP.md`** — Single source of truth in `mobile/lib/categories.ts`. Update home, lobby create, custom category, question, results to use it. Server normalizer in `solo-question` becomes strict slug validator. Covers 1.1, 1.2, 1.3, 1.6, N3.

**B. `INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md`** — Remove "Any topic" tile. Hide custom-category route. Files stay on disk for post-beta. Covers 1.4.

**C. `INSTRUCTIONS_FIX_GAME_HISTORY_AND_SAMPLING.md`** — Bound `gameHistory` per game (item 3.1). Replace 200-row pool sampling with `order by random() limit 1` RPC (item 6.4). Coupled because they interact. Covers 3.1, 6.4.

**D. `INSTRUCTIONS_REPLACE_LOBBY_QUESTIONS.md`** — DB-lookup replacement for `generate-questions`. Adds `fact_id` to `lobby_questions`. Covers 1.5, 5.4, 6.2.

**E. `INSTRUCTIONS_DAILY_CHALLENGE_HONESTY.md`** — Either land F7 (shared daily challenge) or hide the daily challenge UI for beta. Covers 1.7, 3.10.

**F. `INSTRUCTIONS_PROFILE_XP_RELABEL.md`** — Re-label or hide XP UI on profile. Covers 3.6.

**G. `INSTRUCTIONS_HOMESCREEN_HERO_BUTTON_STYLE.md`** — Add `heroPlayBtnDone` style for completed daily challenge state. Covers N1.

**H. `INSTRUCTIONS_FETCH_USER_STATS_HARDENING.md`** — Discriminated return for `fetchUserStats`. Profile screen handles unauthenticated case. Covers 6.5.

**I. `INSTRUCTIONS_DEV_OPS_SAFETY.md`** — Write `dev-after-reset.sh` wrapper. Add explicit warning to CLAUDE.md. Covers 4.5.

**J. `INSTRUCTIONS_DOC_SYNC_PHASE_1.md`** — Update CLAUDE.md, TRIVOLTA_TRACKER.md, TRIVOLTA_ARCHITECTURE.md to match post-rewrite reality. Mark obsolete phases. Reconcile `INSTRUCTIONS_TECH_DEBT.md`. Covers 2.1, 2.2, 2.3, 2.5, N4.

**K. `INSTRUCTIONS_TEST_26_EXTEND.md`** — Extend test_26 to drive through one more lobby creation. Covers 4.3.

**L. `INSTRUCTIONS_ALERT_ALERT_WEB_FIX.md`** — Platform.select pattern for sign-out confirmation. Covers 3.9.

**M. `INSTRUCTIONS_ARCHIVE_DEAD_SCRIPTS.md`** — Move dead scripts to `archived/`. Add cancelled-headers to dead INSTRUCTIONS files. Migration timestamp convention note. Covers 3.2, 3.3, 3.4, 3.5, 4.6, 5.1.

That's **13 INSTRUCTIONS files.** (v1 said 8; the 8-file plan bundled too many concerns and would have hidden the `DOC_SYNC` file becoming a dumping ground.)

---

## Recommended execution order

1. **A** — Category contract cleanup. Prerequisite for D.
2. **C** — gameHistory + sampling fix. Stops a real beta-tester failure mode. Independent of A.
3. **G** — heroPlayBtnDone style. One-line cosmetic, fast win.
4. **B** — Hide custom-category. Removes a constant source of audit findings.
5. **D** — Replace lobby questions. Largest piece of work. Needs A done first.
6. **E** — Daily challenge honesty. After D so it can use the same DB pattern.
7. **F** — XP relabel. Independent.
8. **H** — fetchUserStats hardening. Independent.
9. **L** — Alert.alert web fix. Independent.
10. **K** — test_26 extend. Independent.
11. **I** — Dev ops safety. Independent, but pairs naturally with...
12. **M** — Archive dead scripts. Together I+M is the cleanup pass.
13. **J** — Doc sync. Last, after the code work is stable so docs reflect a stable state.

**A, C, D, B, E** must precede TestFlight. The rest can be parallelized or deferred to the final cleanup sprint.

---

## Process change worth considering

Add to `WORKFLOW.md` a "Scope Expansion" clause: when Claude Code finds adjacent broken code, it stops and proposes a 1-paragraph scope expansion to Mike rather than working around it silently. This would have caught items 1.1 and 1.2 the moment Claude Code wrote the server-side normalizer.

This is the single highest-leverage process change to prevent the next session from generating new debt while fixing this debt.

---

## Gaps in this audit (honest)

I did not read the following. Items derived from these may exist and are not in this audit. Logged so the next pass knows where to look.

- `mobile/dev-reset.sh` — likely related to item 4.5
- `mobile/seed-opentdb.sh` — likely related to 4.5
- `mobile/app/admin/*` — six subdirectories, used daily, completely unaudited
- All 27 Maestro YAML flows — assertions could be matching the wrong things
- `supabase/functions/_shared/auto_seed_pipeline.ts` — read first 40 lines only; Anthropic-call paths and Sonnet vs Haiku usage not fully audited
- `mobile/components/` — directory exists, not listed or read
- `mobile/app/auth.tsx` — read for sign-up flow but not the sign-in error UX
- `mobile/lib/theme.ts` — assumed correct but not verified

A focused next session reading these areas would likely find another 5–15 items.
