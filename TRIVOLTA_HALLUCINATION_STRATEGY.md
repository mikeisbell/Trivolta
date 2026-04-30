# Trivolta — Hallucination Strategy

> **Important context:** An earlier draft of this document described Trivolta's storage as a "fact bank storing knowledge, not questions." That description was wrong. The `facts` table currently stores **fully-formed trivia questions** in the `fact_text` column, with the answer in `correct_answer` and wrong answers in the `distractors` table. It is a question store with a misleading name, not a knowledge store. Every analysis below reflects what's actually in the database.

---

## What's Actually Stored

The `facts` table has columns `fact_text` (freeform text), `correct_answer` (freeform text), and `answer_aliases` (text array). The Trivia API import populated `fact_text` with verbatim question stems like *"What is the capital of France?"* and `correct_answer` with *"Paris"*.

This is not a knowledge representation. It is a question/answer pair. The schema accepted this because `fact_text` is an unconstrained `text` column with no semantic validation.

The architectural intent (per `PHASE_2.6_ARCHITECTURE.md`) was to store atomic knowledge that AI would render into questions. The implementation does not enforce that intent.

---

## How This Changes the Hallucination Picture

### What I previously described

The render layer takes a fact ("Paris is the capital of France") and rewords it into a question ("What is the capital of France?"). Drift risk is bounded because the source is a declarative statement and the rewording target is a question.

### What's actually true

The render layer takes an **existing question** ("What is the capital of France?") and rewords it into a **different question** ("Which European city serves as France's seat of government?"). This is paraphrase, not synthesis. The drift surface area is meaningfully larger because:

- Both source and target are questions, so meaning-preserving rewording is harder to constrain.
- The model has more latitude to interpret what the question is "really asking" and substitute concepts.
- Trivia questions often contain implicit context (year ranges, qualifiers, framings) that paraphrasing can lose.
- Some imported questions are genuinely ambiguous on their own — they relied on a category context the model can't see.

This is closer to translation drift than to question-from-fact synthesis. The mitigation strategy is still valid — constrained prompts plus a correctness check — but the **upper bound** of how good rendering can get is lower than I implied.

---

## The Three Moments AI Touches a Question

### Moment 1 — Seeding

**What AI does**
`fact-bank-validate-source` proposes source URLs with quoted excerpts. `fact-bank-generate-distractors` proposes 3 plausible wrong answers.

**Hallucination risk**
High in principle. Mechanically gated.

**Existing mitigation**
URLs must reach a real page (HTTP 200 + non-empty body). Excerpts must substring-match the page HTML. Distractors run through a second AI pass that scores ambiguity 0–4 and retries on ≥3.

**Status**
Built. Conservative — rejects too much rather than too little. Verification gate parked for beta.

---

### Moment 2 — Rendering

**What AI does**
`render-question` (Phase 2.6.4, not yet built) takes a stored question and rewords it.

**Hallucination risk — revised upward**
Higher than I previously claimed, because the input is already a question, not a fact. Question-to-question paraphrase has more surface area for meaning drift than fact-to-question synthesis would have had.

**Existing mitigation**
None. Phase 2.6.4 must include the correctness check described below.

**Status**
Not built.

---

### Moment 3 — Custom-Category Solo Play

**What AI does**
Player types any topic into CustomCategoryScreen → Sonnet generates questions on the fly with no fact bank.

**Hallucination risk**
Highest. Pure generation, no grounding, no verification.

**Existing mitigation**
None. By design. `fact_reports` is the recovery path.

**Status**
Out of scope for the fact-bank work.

---

## Concrete Examples of Rendering Drift

These are paraphrase failures the correctness check must catch.

**Year drift on paraphrase**
- Stored question: *"In what year did Ridley Scott direct Alien?"* Answer: *"1979."*
- Bad paraphrase: *"In what year was the 1982 sci-fi classic Alien released?"*
- Why wrong: The paraphrase introduced *"1982"* (Blade Runner's year, not Alien's), corrupting the framing.

**Specificity collapse**
- Stored question: *"What is the capital of Australia?"* Answer: *"Canberra."*
- Bad paraphrase: *"What is the largest city in Australia?"*
- Why wrong: The paraphrase substituted "capital" → "largest city." Different question, different answer.

**Qualifier loss**
- Stored question: *"As of 2020, who is the oldest living US president?"* Answer: *"Jimmy Carter."*
- Bad paraphrase: *"Who is the oldest living US president?"*
- Why wrong: Dropped the *"as of 2020"* qualifier. The answer becomes time-dependent and may now be wrong.

**Hidden-context exposure**
- Stored question (originally in Geography category): *"What is the highest peak?"* Answer: *"Mount Everest."*
- Bad paraphrase: *"What is the highest peak in the world?"*
- This one is *better* paraphrase but illustrates that some imported questions are under-specified. Without category context, *"What is the highest peak?"* is ambiguous (highest in what?). Paraphrase can either fix or worsen this — both are drift from the original.

These failure modes are paraphrase-specific. They would be smaller risks if the source were a structured fact rather than another question.

---

## Does Relational Storage Make This Worse?

**Conditionally yes, in a way I previously missed.**

A relational schema with a freeform `text` column for `fact_text` accepts whatever the import code writes. The Trivia API import wrote questions. The schema permitted it. There was no semantic gate.

A schema enforcing structured triples — whether in Postgres (`subject text not null, predicate text not null, object text not null`) or in a graph database — would have **rejected the import**. The discipline is structural.

This isn't a Postgres-vs-Neo4j argument. It's a *flat-text-vs-structured-fields* argument. Either DB technology can enforce the structure if the schema does. The current schema doesn't.

So: the storage **technology** is orthogonal to hallucination risk. The storage **schema discipline** is not. The current schema accepted bad data shapes silently, and that's a real problem that compounds the rendering hallucination risk.

---

## Where a Knowledge Graph (or Strict Triple Schema) Would Help

A graph or strict-triple Postgres schema helps in two distinct ways:

**1. Forces correct ingestion**
A `subject NOT NULL, predicate NOT NULL, object NOT NULL` constraint means the Trivia API import would have failed loudly on day one. We'd have known immediately that the import code was producing the wrong shape, and the architecture conversation would have happened months earlier.

**2. Enables gameplay capabilities**

- **Multi-step questions (#4):** Composing two triples is graph-native. Currently impossible.
- **Smarter distractors (#5):** "Other directors of 1970s sci-fi" is a graph query. Currently requires AI guessing.
- **Personalized paths (#3):** Recommender systems benefit from typed edges and graph traversal.

**Does it reduce hallucination directly?**
Modestly. With a triple as input, the render prompt becomes *"Generate a question that resolves to: subject=Ridley Scott, predicate=directed, object=Alien"* — which is a much more constrained synthesis task than paraphrasing a question. Less drift surface area.

So: the KG argument is partly a **gameplay capability** argument and partly an **input-discipline** argument. The discipline part is the one I missed. It is the strongest argument for migration.

---

## What Actually Reduces Rendering Hallucination

Independent of storage shape:

### A. Constrained prompts at render time

The render prompt includes:
- The verbatim source text (currently a question, ideally a fact).
- The verbatim correct answer.
- The existing distractors (so the model knows what *not* to drift toward).
- An explicit forbidden-substitutions list: do not change years, names, numerical values, units, or proper nouns.

When the source is a question (today's reality), add: *"The output must resolve to the same answer as the input. Do not change scope, qualifiers, or specificity."*

### B. Post-render correctness check

After Sonnet rewords, a follow-up Haiku call validates:
- Given source X with answer Y, does the new question Q resolve to Y?
- Are all key entities (people, places, dates, numbers, units, qualifiers) preserved?
- For paraphrase specifically: is the **scope** of the question preserved? (The Australia/Canberra example.)

If not, reject and retry. ~2x render cost on cache misses. Cache misses <5% at steady state.

### C. Cache invalidation on negative feedback

`fact_reports` invalidates the **rendering**, not the source. Hallucinated renderings have a one-flag lifetime. Source row gets queued for manual review.

### D. Style constraints that limit drift surface area

Each rendering style has explicit constraints:
- "Indirect style: every entity in the original must appear verbatim in the question or answer."
- "Timed challenge style: no additional context that wasn't in the original."

### E. Cache the correctness check

Once a rendering passes, it's cached. Re-using a cached rendering does not re-run the check.

---

## Revised Recommendations

### 1. Acknowledge the data shape honestly in code and docs

Rename `facts` → `questions`, or add a discriminator column distinguishing imported-questions from authored-facts. Stop calling the table a "fact bank" until it actually stores facts.

### 2. Decide whether to enforce structure going forward

Three options:

- **A. Accept the current shape.** Treat Trivolta as a question bank with AI paraphrase. Drop the "knowledge store" framing. Differentiator #1 weakens; #4 becomes infeasible without a separate effort.
- **B. Add structured columns alongside `fact_text`.** New columns `subject text`, `predicate text`, `object text`, NOT NULL with a backfill. Backfill via Haiku extraction across the existing 3,976 rows (~$10). Going forward, new imports must populate the structured fields, and `fact_text` becomes derived/legacy.
- **C. Migrate to a strict triple schema with no `fact_text`.** Requires extracting structured knowledge from every imported row before it can be used. Highest discipline, highest migration cost.

### 3. Add the render-time correctness check regardless

The Haiku validation pass is independent of which option above is chosen. It's the single highest-leverage hallucination mitigation, and it should be in Phase 2.6.4 either way.

### 4. Use beta to measure paraphrase-drift rate specifically

If the post-render check drops drift to <1% on paraphrase, current architecture is sufficient. If drift stays above ~5% on paraphrase but would be lower on synthesis-from-triple, that's the data justifying option B or C above.

---

## Bottom Line

**My earlier framing was wrong.**
The fact bank is a question bank. The render layer paraphrases questions, not synthesizes from facts. Hallucination risk at render time is higher than I originally described.

**Storage technology is orthogonal to hallucination risk.**
But schema discipline is not. The current freeform-text schema permitted the wrong data shape, and that compounds the rendering risk.

**The KG / strict-triple argument has two parts.**
Gameplay capability (post-beta decision) and input discipline (a real problem now, regardless of storage technology).

**The correctness check is non-negotiable.**
Independent of any other decision, Phase 2.6.4 must include Haiku validation on every cache miss.

**The roadmap conversation needs to wait for the architecture conversation.**
Decisions about `facts` table structure cascade into 2.6.4, 2.6.9, 2.7, and 2.8. Locking the roadmap before answering the structure question would compound the original framing error.
