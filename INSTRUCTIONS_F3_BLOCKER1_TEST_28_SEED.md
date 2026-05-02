# INSTRUCTIONS — F3 Blocker 1: test_28 fact-bank pre-condition

## Task

The full-repo-access reviewer flagged a `[blocker]` against the F3 commit (`a69392e`): test_28 cannot pass on a fresh DB because `supabase/seed.sql` is empty, so `get_next_spot_check_fact()` returns no rows after `supabase db reset` and the spot-check screen renders the empty state instead of `spot-check-fact-text`.

This INSTRUCTIONS file does two things, in order:

1. **Verify the blocker is real.** Reset the DB, run the test suite, observe whether test_28 actually fails.
2. **If real, fix it** by adding a Maestro `runScript` step that seeds one fact + three active distractors into a category before test_28 navigates to the spot-check screen. The seeding script is patterned on `mobile/maestro/scripts/ensure_test_user_02.js` — idempotent via service-role REST API.

If the verification step shows test_28 passing on a fresh DB, the blocker was a false positive. Stop, log the calibration result in `reviews/README.md`, and report.

This is **local-only work**. No production impact. The fix touches one Maestro YAML, adds one helper script, and updates the tracker.

## Verifiable objective

### Step A — Verification (always run first)

- [ ] `supabase db reset` runs cleanly. Capture stdout.
- [ ] `cd mobile && ./run_tests.sh` runs immediately after. Capture full output.
- [ ] Identify whether `test_28_spot_check.yaml` passes or fails. If it fails, capture the failure mode (timeout on which assertion, screen state at failure).
- [ ] If test_28 passes: blocker was a false positive. Skip Steps B–D. Go to Step E (calibration note).
- [ ] If test_28 fails on the empty-state assertion: proceed to Steps B–D.

### Step B — Seeding script (only if Step A confirmed failure)

- [ ] New file `mobile/maestro/scripts/ensure_spot_check_facts.js`.
- [ ] Patterned on `mobile/maestro/scripts/ensure_test_user_02.js`: ESM-style, uses `fetch` against the local Supabase REST API with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from env, idempotent (skip-if-exists semantics).
- [ ] Behavior:
  1. Ensures one category exists with slug `spot-check-test` (insert if missing). Display name "Spot Check Test".
  2. Ensures one fact exists in that category with `verification_status = 'pending'`. Skip if already present.
  3. Ensures the fact has at least 3 active distractors. Skip if already present.
  4. Logs a one-line summary (`spot-check seed: ok` or `spot-check seed: created N rows`).
- [ ] Uses Supabase REST API (`/rest/v1/categories`, `/rest/v1/facts`, `/rest/v1/distractors`) with the service-role key. No psql, no Docker exec. Same constraint as other Maestro helper scripts (CLAUDE.md "test user cleanup uses Supabase admin API via HTTP — not psql").
- [ ] Uses Node 18+ globals (`fetch`, no node-fetch import). Same posture as `ensure_test_user_02.js`.
- [ ] Has a header comment block describing the file's purpose, the env vars it reads, and the idempotency guarantee.

### Step C — test_28 update

- [ ] Edit `mobile/maestro/test_28_spot_check.yaml` to add a `runScript` step at the start, after the existing `ensure_admin_test_user.js` step (or merged with it — match the YAML's existing structure for ordering).
- [ ] The new step invokes `./scripts/ensure_spot_check_facts.js` with the same env-var passthrough pattern (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) used by other test_*.yaml files.
- [ ] No other changes to test_28's existing flow.

### Step D — Verify the fix

- [ ] `supabase db reset` from clean.
- [ ] `cd mobile && ./run_tests.sh` reports 28/28 passing (or whatever the baseline count was per the prior F3 commit — match the existing convention; the report said "27 passed" which is the active count excluding the historical test_18 gap, so this should now be 28 active).
- [ ] Confirm test_28 specifically reaches `spot-check-fact-text` and exercises both correct/incorrect verdicts.

### Step E — Calibration note (always run, both branches)

- [ ] Append a one-paragraph "Calibration notes" section to the bottom of `reviews/README.md` recording the outcome:
  - If false positive: "On 2026-05-02, the full-repo-access reviewer flagged a [blocker] against `a69392e` claiming test_28 fails on fresh DB. Verified: test_28 passes on `supabase db reset && ./run_tests.sh`. The reviewer's reasoning chain (empty seed.sql → no facts → empty state) was technically valid but missed [whatever actual seeding mechanism keeps test_28 working]. Future reviews of seeding-dependent tests should verify the failure mode before flagging."
  - If real bug: "On 2026-05-02, the full-repo-access reviewer flagged a [blocker] against `a69392e` claiming test_28 fails on fresh DB. Verified: confirmed real. Fix landed in commit `<sha>` adding `ensure_spot_check_facts.js` runScript step to test_28."

### Step F — Tracker

- [ ] Add a one-line entry under `## Workflow infrastructure` (or `## Phase 2.9 Tranche 1`, whichever reads cleaner — one or the other is fine):
  - If false positive: `✅ F3 Blocker 1 calibration — INSTRUCTIONS_F3_BLOCKER1_TEST_28_SEED.md (no fix needed; calibration note in reviews/README.md)`
  - If real fix: `✅ F3 Blocker 1 fix — INSTRUCTIONS_F3_BLOCKER1_TEST_28_SEED.md (ensure_spot_check_facts.js seeds one fact + 3 distractors before test_28)`
- [ ] Mark `✅ INSTRUCTIONS_F3_BLOCKER1_TEST_28_SEED.md` in the INSTRUCTIONS Files Written section.

## Constraints

- **Do not** modify test_28's existing assertions, testIDs, or flow logic. Only add the seeding step.
- **Do not** modify any other Maestro YAML file. Only test_28 changes.
- **Do not** modify the F3 spot-check screen, Edge Function, migration, or RPC. The bug (if real) is in test setup, not in the feature code.
- **Do not** modify `supabase/seed.sql`. The fix is per-test, not global. Other tests don't need facts seeded.
- **Do not** add new dependencies. Use Node 18+ globals only.
- **Do not** use psql or `docker exec` in the seeding script. REST API only, per CLAUDE.md.
- **Do not** seed via the implementer's `seed-trivia-api.sh` script. That seeds the full Trivia API corpus and is way more than test_28 needs.
- **Do not** skip Step A. The whole point is to verify before assuming the reviewer was right.
- **Do not** commit until Mac Claude has reviewed the diff against the four criteria.

## Steps

### 1. Read existing files

- `mobile/maestro/test_28_spot_check.yaml` — current test flow.
- `mobile/maestro/scripts/ensure_test_user_02.js` — pattern reference for the new seeding script.
- `mobile/maestro/scripts/ensure_admin_test_user.js` — same pattern, plus admin-grant logic.
- `supabase/migrations/20240106000000_fact_bank_schema.sql` — schema for `categories`, `facts`, `distractors`.
- `supabase/migrations/20240109000000_spot_check_results.sql` — the `get_next_spot_check_fact()` RPC's eligibility filters (so the seeded data passes them).
- `supabase/seed.sql` — confirm it is in fact empty.
- `mobile/run_tests.sh` — test runner glob loop.

### 2. Verification (Step A)

```bash
cd /Users/mizzy/Developer/Trivolta
supabase db reset 2>&1 | tee /tmp/db-reset.log
cd mobile && ./run_tests.sh 2>&1 | tee /tmp/maestro-run.log
```

Inspect `/tmp/maestro-run.log`. Look for `test_28` outcome. Record:
- Pass/fail
- If fail: which assertion timed out; what the screen showed (empty state? partially-loaded?)

### 3. Branch on Step A outcome

**If test_28 passed:** skip to Step 6.

**If test_28 failed on the spot-check empty state:** proceed to Step 4.

### 4. Build the seeding script

Implement `mobile/maestro/scripts/ensure_spot_check_facts.js` per the Step B verifiable objective. Reference structure (illustrative, not a literal patch):

```js
#!/usr/bin/env node
// ensure_spot_check_facts.js
// Idempotently seeds one category + one pending fact + 3 active
// distractors for test_28_spot_check.yaml. Required because
// supabase/seed.sql is empty; without this, get_next_spot_check_fact()
// returns no rows on a fresh `supabase db reset` and test_28 hits the
// empty state. Pattern from ensure_test_user_02.js: REST + service role.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

// 1. Upsert category by slug
// 2. Find or insert fact under that category, verification_status='pending'
// 3. Find existing distractors for fact; insert as many as needed to reach 3 active

// (full implementation here — match the schema exactly)
```

Use the actual column names from `20240106000000_fact_bank_schema.sql`. Verify the inserted fact will pass `get_next_spot_check_fact()`'s filters: `verification_status in ('pending','verified')` and `count(active distractors) >= 3`.

### 5. Wire into test_28

Edit `mobile/maestro/test_28_spot_check.yaml` per Step C. Match the existing `runScript` step's syntax (look at how `ensure_admin_test_user.js` is invoked — copy that pattern).

### 6. Re-verify (Step D)

```bash
cd /Users/mizzy/Developer/Trivolta
supabase db reset
cd mobile && ./run_tests.sh
```

Confirm test_28 passes. If still failing, do not push forward — investigate root cause before reporting done.

### 7. Calibration note (Step E)

Append to `reviews/README.md`. Use the appropriate template from the Step E verifiable objective.

### 8. Tracker (Step F)

Use `Filesystem:edit_file` for the two tracker entries.

### 9. Standard pipeline tail

```bash
bash simplify-and-verify.sh
bash run-review.sh "$(git rev-parse HEAD)" /Users/mizzy/Developer/Trivolta/INSTRUCTIONS_F3_BLOCKER1_TEST_28_SEED.md
```

### 10. Stop. Do not push.

Mac Claude reviews the diff against the four criteria.

## Verification

Final report Claude Code returns:

- `supabase db reset` outcome from Step A.
- test_28 outcome from Step A (pass or fail; if fail, the assertion that timed out and the screen state).
- Branch taken (false positive vs real fix).
- If real fix:
  - Path to `ensure_spot_check_facts.js`.
  - The exact seed: category slug, fact text (truncated), distractor count.
  - Step D re-verification: test_28 outcome on fresh DB.
- Path to the calibration note added to `reviews/README.md`.
- Tracker entry diff.
- TypeScript pass/fail.
- Maestro count after fix (28 expected if real fix; 27 if false positive).
- Pipeline tail outputs (`simplify-and-verify.sh` and `run-review.sh` results).
- Path to this task's review file at `reviews/<latest-HEAD-sha>.md` and its YAML verdict.

After Mac Claude approves the diff, push. Tranche 1 is genuinely closed; F4 is next.

---

Read INSTRUCTIONS_F3_BLOCKER1_TEST_28_SEED.md and execute all steps exactly as written.
