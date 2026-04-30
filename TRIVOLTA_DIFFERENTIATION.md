# Trivolta — AI Differentiation Strategy

> **Important context:** An earlier draft of this document framed Trivolta's data layer as a "fact bank storing knowledge, not questions." That framing was incorrect. The `facts` table currently stores fully-formed trivia questions in `fact_text`, with answers in `correct_answer`. It is a question store with a misleading name. Several differentiators below are weaker than the earlier draft claimed because of this. The honest version is below.

---

## What Trivolta Actually Is Today

**A question bank with AI paraphrase, plus AI-generated distractors.**

- Source data: 3,976 trivia questions imported from The Trivia API, stored verbatim as questions.
- Future render layer (Phase 2.6.4): rewords stored questions into stylistic variants. Paraphrase, not synthesis.
- Distractor pipeline: AI-generated, ambiguity-scored. Built but not yet applied to the imported corpus.

This is a meaningful improvement over a static question bank. It is **not** the "store knowledge, generate questions on demand" architecture the original design described.

---

## Status Legend

- ✅ Built and operating
- ⚠️ Partially built — scaffolding exists, gameplay impact missing
- ❌ Not built
- 🟥 **Re-evaluated downward** — earlier claims overstated based on misread architecture

---

## The Seven Differentiators — Honest Version

---

### 1. Content Scale Without Linear Writing Cost 🟥

**Earlier claim**
"One fact generates many difficulty levels and phrasings. Exponential variety from a small dataset."

**Honest version**
One **question** generates many **paraphrases of the same question**. That's not exponential variety — it's linguistic variation on a fixed pool of 3,976 questions. Quizlet, Kahoot, and competitors do something similar.

**Where the differentiator does still apply**
- Cost structure: cached renderings mean steady-state Anthropic spend is roughly flat with DAU. That's real and valuable.
- Freshness perception: a player seeing the same question worded three different ways across sessions feels less repetitive than seeing it identical three times.

**What it does NOT do**
- Genuinely expand the catalog. The catalog is 3,976 questions, period.
- Generate questions from knowledge. There is no knowledge representation underneath.

**Status: ⚠️ partial — cost benefit real, content-scale claim invalid as currently architected.**

---

### 2. Adaptive Difficulty Per Player ⚠️

**Earlier claim**
"AI adjusts question wording, depth, and complexity per player."

**Honest version**
This is feasible regardless of data shape. The render layer can paraphrase a stored question with skill-aware framing (longer/shorter stems, more/less context). Doesn't require structured facts.

**Trivolta today**
Difficulty auto-scales by session streak only. No per-player skill model.

**Gap to close**
Per-player skill estimate on `profiles`. `render-question` consumes it.

**Status: ⚠️ achievable in current architecture, not yet built.**

---

### 3. Personalized Content Paths ❌

**Earlier claim**
"Sci-fi player sees different pathways than sports player. Weak areas reinforced dynamically."

**Honest version**
Requires per-player category accuracy tracking and a recommender layer. Possible in current architecture (categories are typed). Easier with structured facts (typed relations enable graph-walk recommendation).

**Status: ❌ not built. Achievable post-beta either way.**

---

### 4. Dynamic Question Generation From Structured Facts 🟥

**Earlier claim**
"Other apps store questions. Trivolta stores knowledge and generates questions from it."

**Honest version**
**Trivolta also stores questions.** This differentiator is currently false.

The architecture document described this design. The implementation does not realize it. Importing pre-formed questions from a trivia API populated `fact_text` with question stems, not knowledge statements.

**Path to making it true**
Requires either:
- Backfill: AI extracts structured knowledge from each of the 3,976 imported questions (~$10 in Haiku, plus verification cost), or
- Re-architecture: ingest from structured sources (Wikidata, DBpedia, IMDB structured exports) instead of trivia APIs.

Without one of these, multi-step questions from triples is infeasible.

**Status: 🟥 not real today. Was treated as the architectural keystone of the differentiation argument. Recovery requires significant work.**

---

### 5. Smarter Distractors ⚠️

**Earlier claim**
"AI-assisted system generates plausible distractors from same domain."

**Honest version**
This one is intact. The distractor pipeline (`fact-bank-generate-distractors` + ambiguity scoring) is real, built, and works regardless of whether the source is a question or a fact.

**Trivolta today**
Built. Not applied to the imported 3,976 facts — they currently use the Trivia API's lower-quality distractors.

**Gap to close**
Re-run distractor generation across the imported corpus. ~$5 in Haiku.

**Status: ⚠️ built, not applied. Cheapest pre-beta win.**

---

### 6. Live Balancing in Competitive Modes ❌

**Earlier claim**
"AI adjusts pacing based on survival rates."

**Honest version**
Achievable. Independent of data shape. Depends on #2 (skill model) being live first.

**Status: ❌ not built. Post-beta.**

---

### 7. Continuous Content Evolution ⚠️

**Earlier claim**
"Nightly job regenerates renderings. Importer auto-pulls new facts."

**Honest version**
"Continuously regenerate paraphrases of the existing 3,976 questions" is what this means today. That's not content evolution — that's continuous restyling of a fixed corpus.

To genuinely evolve content, the importer must pull from sources that produce new questions or new structured facts. The Trivia API has a finite pool too. Real evolution requires either continuous trivia-API monitoring or structured-knowledge ingestion.

**Status: ⚠️ scheduling layer not wired. Even when wired, the "evolution" is restyling, not new content, until the ingestion side changes.**

---

## What's Actually True About Trivolta's AI Differentiation

Stripping the false claims:

**Real differentiators (current architecture supports them):**
- ✅ Cost structure that flattens with DAU (cached AI rendering vs. per-request generation)
- ✅ Higher-quality distractors than imported defaults (when applied)
- ⚠️ Skill-aware paraphrasing (achievable, not built)
- ⚠️ Per-player content weighting (achievable, not built)

**Aspirational differentiators (require architecture change):**
- 🟥 One-fact-many-questions content multiplication
- 🟥 Multi-step reasoning questions from composed facts
- 🟥 Genuine content evolution (vs. restyling)

**Independent of architecture:**
- ❌ In-match adaptation in lobbies (depends on #2 + lobby state machine)

---

## What This Means For Beta

**Beta as currently planned demonstrates:** A polished trivia app with cached AI paraphrase, AI-generated distractors, and a competent multiplayer mode. Cost-efficient at scale. Better-than-average question quality.

**Beta does NOT demonstrate:** The "AI changes the system properties" framing the original differentiation pitch promised. That framing assumed knowledge storage. Knowledge isn't there.

**This is recoverable, but requires deliberate choice.**

---

## Three Strategic Paths

### Path A — Ship beta as a polished trivia app, drop the "knowledge store" framing

Acknowledge Trivolta is a question bank with AI paraphrase. Lean into what it does well (cost structure, distractor quality, future skill-aware rendering). Compete on execution rather than category-creating differentiators.

**Effort:** Low. Requires updating marketing/docs to match reality.
**Risk:** Lower. No architectural rework before beta.
**Ceiling:** Trivolta is a good trivia app. Not a fundamentally different one.

### Path B — Add structured columns alongside `fact_text` before beta

`subject`, `predicate`, `object` columns on `facts`, NOT NULL with a backfill across 3,976 rows via Haiku extraction. Going forward, importers populate structured fields. `fact_text` becomes derived/legacy.

**Effort:** Medium. Migration + backfill + verification + new importer logic. ~2-3 weeks.
**Risk:** Medium. Backfill quality is the question. AI extraction across 4k trivia-API questions of varying clarity will not be uniformly correct.
**Ceiling:** Differentiators #1, #4, and #5 become real. Beta can demonstrate them.

### Path C — Re-architect ingestion from structured sources, defer beta

Stop importing from trivia APIs. Build ingestion from Wikidata / DBpedia / structured datasets. The fact bank becomes a real knowledge store.

**Effort:** High. Months of work.
**Risk:** High. Significant beta delay. Genuine architectural decision, not a refactor.
**Ceiling:** Trivolta's category-creating differentiation case becomes structurally true.

---

## Recommendation Framework

**The right path depends on a question I cannot answer for Mike:**

*Is Trivolta competing on execution polish, or on architectural category-creation?*

If execution polish: Path A. Ship beta. Iterate. Add structure later if data justifies it.

If category-creation: Path B is the minimum viable. Path C is the honest version.

**The path most strategies fall into by default — Path A while continuing to claim Path B/C-level differentiation in pitches and product copy — is the worst of both worlds.** It sets tester and investor expectations the product can't meet.

---

## What Doesn't Change Regardless Of Path

These pre-beta items are valuable on every path:

- **Phase 2.6.4 + render-time correctness check.** Render layer must validate output. See `TRIVOLTA_HALLUCINATION_STRATEGY.md`.
- **Phase 2.6.9 — distractor regeneration.** Replace Trivia API distractors with AI-generated, ambiguity-scored ones. ~$5. Hours of work.
- **Schema honesty.** Rename `facts` to `questions`, or add a discriminator column. Stop calling the table a "fact bank" until it stores facts.

---

## Roadmap Implication

Roadmap finalization is paused pending the strategic-path decision above. Locking new phases (2.7, 2.8, 3.5+) before answering the path question would repeat the original framing mistake — building toward a destination the architecture doesn't reach.
