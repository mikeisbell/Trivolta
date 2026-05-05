# INSTRUCTIONS — Hide Custom-Topic Feature for Beta

## Task

Hide the "Any topic" custom-category feature from both the home screen and the lobby-create screen for beta. The feature today promises AI generation that no longer exists post solo-question DB rewrite, and shipping it would mean shipping lying UI copy. Hiding it is the cleanest path to truth-in-advertising for beta. Files for the feature stay on disk for post-beta restoration.

This clears `verify-consistency.sh` check B1, dropping the threshold from 4 to 3.

## Why

Per the Tech Debt Audit (item 1.4), `mobile/app/custom-category.tsx:127` says "AI generates your quiz in seconds" and `:184` says "plays today · AI-generated". Both are false: solo-question now reads from the `facts` table and never calls Anthropic. A user typing "NASA missions" silently gets a random general-knowledge question.

Mike has decided (this session) that the feature is hidden for beta rather than reworked, with the option to bring it back post-beta either by (a) restoring AI generation for custom-topic only or (b) limiting input to canonical categories. That decision is post-beta; the spec here is hide-only.

The lobby-create screen has the same `'custom'` card with the same free-form input, which routes through `generate-questions` (still calls Anthropic today) but will inherit the same lying-UI problem the moment the lobby DB-rewrite lands. Hiding the lobby custom card now ensures consistency between solo and lobby paths and removes one entry point from the future lobby-rewrite spec.

## Pre-flight context

**Strings, slugs, or constants this spec touches.**

- **`'custom'` category id** — defined in `mobile/app/(tabs)/index.tsx:15` (CATEGORIES const) and `mobile/app/lobby/create.tsx:14` (duplicate CATEGORIES const). Both will have the `'custom'` row removed.
- **`PLAYABLE_CATEGORIES` derived const** — `mobile/app/(tabs)/index.tsx:19`: `CATEGORIES.filter((cat) => cat.id !== 'custom')`. After the `'custom'` row is removed, this filter becomes a no-op but should remain (every CATEGORIES element is now playable). Removing the filter is out of scope — that cleanup belongs in `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md` which will fold both files into a shared module. Leave the filter in place to minimize the diff.
- **Test ID `home-category-custom`** — referenced in maestro tests 05, 08, 21. After the card is removed, this testID does not exist in the rendered UI. Tests that reference it must be skipped (option a from the planning conversation) and added to `SKIP_TESTS` in `mobile/run_tests.sh`.
- **Test ID `create-lobby-category-custom`** — referenced in maestro test 22. Same skip-via-`SKIP_TESTS` treatment.
- **AI-claim strings caught by check B1** — both live in `mobile/app/custom-category.tsx`. Hiding the screen from navigation does NOT remove the strings from disk. The `verify-consistency.sh` B1 check greps the entire mobile codebase, so the strings will continue to fail B1 until the file itself is changed. **Decision required:** see Step 3 below for two viable approaches.

**Routes or paths this spec touches.**

- `/custom-category` — Expo Router file-system route at `mobile/app/custom-category.tsx`. The route file remains on disk so it can be restored post-beta. Navigation to it is removed. **A user with deep-link knowledge could still reach it** by typing the URL — acceptable for beta because beta testers are not arbitrary users; if surfaced as a problem, a router redirect is a small post-spec fix.
- `/question?category=...` — unchanged. Solo gameplay routes that previously originated from category cards continue to work; only the `'custom'` card is removed.

**Error codes, status enums, or response shapes this spec touches.** None. The custom-category flow's network calls (`api.ts:generateSoloQuestion`, `api.ts:createLobby`) are unchanged.

**Existing shared modules that should be reused.** None directly. The future `mobile/lib/categories.ts` module (created in `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md`) does not exist yet; this spec does not create it. Keep the duplicate CATEGORIES consts in place — they will be consolidated by the next spec.

## Verifiable objective

Binary pass/fail criteria:

- [ ] `mobile/app/(tabs)/index.tsx`: the `CATEGORIES` const has 3 entries (science, pop_culture, history). The `custom` entry is removed.
- [ ] `mobile/app/(tabs)/index.tsx`: the `onPress` of category cards no longer branches on `cat.id === 'custom'`. The conditional becomes a single-path navigation to `/question`.
- [ ] `mobile/app/lobby/create.tsx`: the `CATEGORIES` const has 3 entries. The `custom` entry is removed.
- [ ] `mobile/app/lobby/create.tsx`: the `effectiveCategory` computation no longer references `'custom'`. The custom-input rendering block is removed.
- [ ] `mobile/app/lobby/create.tsx`: `customText` state and the `setCustomText` calls are removed (dead state).
- [ ] `mobile/app/custom-category.tsx`: file remains on disk, contents unchanged from current HEAD.
- [ ] `mobile/run_tests.sh`: `SKIP_TESTS` array includes `test_05_custom_category`, `test_21_custom_category_interactions`, `test_22_create_lobby_custom_topic` in addition to the existing `test_27_feedback_submit`.
- [ ] `mobile/maestro/test_08_solo_game_loop.yaml`: rewritten to enter the question screen via `home-category-science` instead of via custom-category. Otherwise unchanged.
- [ ] `cd mobile && npx tsc --noEmit` exits 0.
- [ ] `bash verify-consistency.sh` exits 1 with **3** failures: A1, A2, C1. B1 must now pass. (See Step 3 for which approach achieves this.)
- [ ] `./run_tests.sh` reports `23 passed, 0 failed, 4 skipped`. The 4 skipped are: test_27 (existing), test_05, test_21, test_22 (new).
- [ ] `TRIVOLTA_TRACKER.md` Drift Detector threshold table has a new row showing 2026-05-04 → 3, naming B1 as cleared.
- [ ] `TRIVOLTA_TRACKER.md` Post-Beta Restoration section has a new entry tracking the hidden custom-category feature.
- [ ] `TRIVOLTA_TRACKER.md` skipped-tests entries (in the deferred items section) are added for test_05, test_21, test_22 with one-line restoration notes.

## Constraints

- **Do NOT delete `mobile/app/custom-category.tsx` or any test file.** Hiding ≠ deletion. Both must be restorable post-beta with no git archaeology.
- **Do NOT modify `mobile/app/custom-category.tsx`'s contents.** The screen is unchanged on disk; only its navigation entry points are removed. (Exception: see Step 3 — if approach (a) is chosen, the AI-claim strings must be neutralized to clear B1.)
- **Do NOT consolidate the duplicate `CATEGORIES` consts.** That cleanup belongs in `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md`, the next spec.
- **Do NOT remove the `PLAYABLE_CATEGORIES` filter in `index.tsx`** even though it becomes a no-op. Same reason as above.
- **Do NOT change any solo-gameplay or lobby-gameplay logic.** Only the entry points to the custom-topic feature are removed.
- **Do NOT touch `verify-consistency.sh`.** The drift detector itself is not modified by this spec.
- **Do NOT add a router redirect from `/custom-category` to `/`.** Acceptable risk for beta; can be added later if needed.
- **Do NOT remove `home-category-custom` or `create-lobby-category-custom` testIDs from any source file.** They naturally disappear from the rendered UI when the array entry is removed; no source-level testID hunt is needed.

## Steps

### Step 1 — Remove the custom card from the home screen

**Path:** `mobile/app/(tabs)/index.tsx`

Edit 1: remove the `'custom'` row from `CATEGORIES`. The const goes from 4 entries to 3.

Edit 2: simplify the `onPress` for category cards. Currently:
```tsx
onPress={() => cat.id === 'custom'
  ? router.push({ pathname: '/custom-category' })
  : router.push({ pathname: '/question', params: { category: cat.label } })
}
```
Becomes:
```tsx
onPress={() => router.push({ pathname: '/question', params: { category: cat.label } })}
```

Edit 3: simplify the `catCount` rendering. Currently:
```tsx
<Text style={styles.catCount}>{cat.count} {cat.id !== 'custom' ? 'questions' : ''}</Text>
```
Becomes:
```tsx
<Text style={styles.catCount}>{cat.count} questions</Text>
```

The `catCardAI`, `catBadgeAI`, `catBadgeAIText`, `catNameAI` style branches are now unreachable. **Leave them in the StyleSheet** — they'll be useful when the feature returns. Out of scope to delete.

### Step 2 — Remove the custom card from the lobby-create screen

**Path:** `mobile/app/lobby/create.tsx`

Edit 1: remove the `'custom'` row from `CATEGORIES` (4 entries → 3).

Edit 2: simplify `effectiveCategory`. Currently:
```tsx
const effectiveCategory =
  selected === 'custom'
    ? customText.trim()
    : selected
      ? CATEGORIES.find(c => c.id === selected)!.label
      : ''
```
Becomes:
```tsx
const effectiveCategory = selected
  ? CATEGORIES.find(c => c.id === selected)!.label
  : ''
```

Edit 3: remove the entire `{selected === 'custom' && (...)}` block that renders the `TextInput`.

Edit 4: remove `const [customText, setCustomText] = useState('')` and any remaining references to `customText` / `setCustomText`.

Edit 5: simplify the `<TouchableOpacity>` style array for category cards. Remove the `isCustom && styles.catCardCustom` and `isCustom && isSelected && styles.catCardCustomSelected` entries. Remove the `isCustom` const since it's no longer needed.

Style entries `catCardCustom`, `catCardCustomSelected` and the `customInput` style become unreachable. **Leave them in the StyleSheet** — restoration material.

### Step 3 — Resolve the B1 verify-consistency.sh check

The `verify-consistency.sh` B1 check greps the entire mobile codebase for `AI generates|AI-generated|AI-powered`. Both strings live in `mobile/app/custom-category.tsx`, which Step 1 hides from navigation but does not delete.

**The check will continue to fail unless the strings are dealt with.** Two viable approaches:

**Approach (a) — Comment out the AI-claim strings in `custom-category.tsx`.** Two single-line edits inside the file:
- Line 127 currently reads (approximately): `<Text style={...}>AI generates your quiz in seconds</Text>`. Change to: `<Text style={...}>{/* AI generates your quiz in seconds — restored post-beta */}Generate a quiz on any topic</Text>` or similar non-AI-claiming copy.
- Line 184 currently reads (approximately): `... AI-generated`. Same treatment.

The screen is unreachable for beta, so the user-visible text is irrelevant. The grep stops matching, B1 passes.

**Approach (b) — Whitelist `mobile/app/custom-category.tsx` in `verify-consistency.sh` check B1.**

Add a one-line carve-out to the B1 check that excludes `mobile/app/custom-category.tsx` from the grep, with a tracker entry under "Whitelist entries" explaining: "Custom-category screen is hidden from navigation for beta but kept on disk for post-beta restoration. The AI-claim strings inside it are not user-visible during beta."

**Recommendation: approach (a).** It does NOT modify `custom-category.tsx`'s function — the strings stay in comments — and it's a tighter contract. Approach (b) is an honest whitelist but creates a "trust me, it's hidden" exception that future-Claude has to verify is still true. The audit's whole point was that hidden-but-not-deleted code drifts; a whitelist makes that drift invisible to the detector.

**Implementer: use approach (a).**

Specifically: locate the two strings in `mobile/app/custom-category.tsx`. Wrap each in `{/* ... */}` JSX comment form with the original text preserved as the comment, and place a beta-appropriate replacement string adjacent. The screen does not render in the beta build but still type-checks.

### Step 4 — Skip the affected Maestro tests

**Path:** `mobile/run_tests.sh`

Edit: extend the `SKIP_TESTS` array.

Currently:
```bash
SKIP_TESTS=("test_27_feedback_submit")
```

Becomes:
```bash
SKIP_TESTS=(
  "test_27_feedback_submit"
  "test_05_custom_category"
  "test_21_custom_category_interactions"
  "test_22_create_lobby_custom_topic"
)
```

### Step 5 — Rewrite test_08 to use a non-custom entry point

**Path:** `mobile/maestro/test_08_solo_game_loop.yaml`

Replace the custom-category entry sequence:
```yaml
- tapOn:
    id: "home-category-custom"
- waitForAnimationToEnd
- assertVisible:
    id: "custom-category-input"
- tapOn:
    id: "custom-category-prompt-nasa-missions"
- tapOn:
    id: "custom-category-submit"
```

With a direct science-card entry:
```yaml
- tapOn:
    id: "home-category-science"
```

The rest of the test (10 questions, results screen) is unchanged.

**Verify the rewrite by running just test_08:** `./run_tests.sh test_08_solo_game_loop.yaml`. It should pass cleanly.

### Step 6 — Update TRIVOLTA_TRACKER.md

Three edits, all via `Filesystem:edit_file`:

**Edit A — Drift Detector threshold table.** Add a new row to the table in the "Expected-failure threshold" section:

```
| 2026-05-04 | 3 (A1, A2, C1) | B1 cleared by `INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md`. AI-claim strings in `custom-category.tsx` neutralized to JSX comments; screen hidden from navigation. |
```

The existing row stays; this is an additional row showing the threshold step-down.

**Edit B — Post-Beta Restoration entry.** Append a new bullet under the Post-Beta Restoration section:

```
- **Custom-topic feature hidden for beta.** `INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md` removed the "Any topic" card from `mobile/app/(tabs)/index.tsx` and `mobile/app/lobby/create.tsx`. The `mobile/app/custom-category.tsx` screen remains on disk; its two AI-claim strings have been replaced with non-AI-claiming copy and the originals preserved as JSX comments for restoration. Decision deferred: post-beta either (a) restore AI generation for the custom-topic path only (single Anthropic-calling Edge Function for free-form topics) or (b) repurpose the screen for canonical-only topic selection. Tests skipped: test_05, test_21, test_22. Test_08 rewritten to enter via `home-category-science` instead.
```

**Edit C — Skipped-tests deferred-items section.** Find the existing block that documents `test_27` and the other manual/skipped tests (the bullet points starting "test_18 manual-only", "test_27 non-automatable", "lobby/results play-again not fully tested"). Add three new bullets:

```
- **test_05_custom_category skipped** — Custom-category screen is hidden from beta navigation. Test exercises the hidden screen and has no UI to drive. Restore when the custom-topic feature returns post-beta.
- **test_21_custom_category_interactions skipped** — Same reason as test_05. Restore alongside.
- **test_22_create_lobby_custom_topic skipped** — Custom-topic card removed from lobby create. Restore when the lobby custom-topic feature returns post-beta (likely after lobby DB-rewrite + custom-topic restoration).
```

## Sites this affects

**Modified:**

- `mobile/app/(tabs)/index.tsx` — `CATEGORIES` const trimmed to 3 entries; category-card `onPress` simplified; `catCount` text simplified.
- `mobile/app/lobby/create.tsx` — `CATEGORIES` const trimmed; `effectiveCategory` simplified; custom-input render block removed; `customText` state removed; `isCustom` style branches removed.
- `mobile/app/custom-category.tsx` — two AI-claim strings replaced with non-AI-claiming copy; originals preserved as JSX comments. No other functional change.
- `mobile/run_tests.sh` — `SKIP_TESTS` array extended with three entries.
- `mobile/maestro/test_08_solo_game_loop.yaml` — entry sequence rewritten to use `home-category-science`.
- `TRIVOLTA_TRACKER.md` — threshold-table row added (3); Post-Beta Restoration bullet added; three skipped-test bullets added.

**Intentionally unchanged:**

- `mobile/app/custom-category.tsx` — file remains, screen remains routable via deep link, contents unchanged except the two strings in Step 3. Restoration target.
- `mobile/maestro/test_05_custom_category.yaml`, `test_21_custom_category_interactions.yaml`, `test_22_create_lobby_custom_topic.yaml` — files remain on disk; only `run_tests.sh` skip-list changes.
- `mobile/lib/api.ts` `generateSoloQuestion` and `createLobby` signatures — unchanged. The category-string contract drift exists but is the next spec's problem.
- `verify-consistency.sh` — unchanged. B1 will pass naturally once the AI-claim strings are gone from the grep target.
- `WORKFLOW.md`, `CLAUDE.md` — unchanged.
- All Edge Functions — unchanged.
- All other tests (test_01–04, test_06–07, test_09–17, test_19–20, test_23–26, test_28) — unchanged.

**Deferred:**

- Duplicate `CATEGORIES` consts across `index.tsx` and `lobby/create.tsx` — consolidation belongs to `INSTRUCTIONS_CATEGORY_TYPE_CONTRACT.md` (next spec). Tracker entry already exists under audit item 1.1 in `TECH_DEBT_AUDIT_2026_05_04.md`.
- The unreachable AI-themed StyleSheet entries in both files (`catCardAI`, `catBadgeAI`, `catCardCustom`, `customInput`, etc.) — left in place for restoration. No tracker entry needed; their existence is documented by the Post-Beta Restoration entry above.
- Router redirect for direct `/custom-category` deep-link access — out of scope for beta. If a beta tester reports the deep link as a problem, fix is a one-line redirect in the route's `_layout.tsx` or a `<Redirect>` at the top of `custom-category.tsx`.
- `mobile/app/custom-category.tsx` itself (the file) — kept on disk per the hide-not-delete strategy. The "Trending categories from real play data" code path inside it (`fetchTrendingCategories`) and the example-prompt grid will need re-evaluation when the screen returns; tracked under audit item 2.3.

## Verification

Run in order. Do not report success until all pass.

```bash
# 1. Type check
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit
# Expected: exit 0.

# 2. Drift detector — B1 must now pass
cd /Users/mizzy/Developer/Trivolta && bash verify-consistency.sh
# Expected: exit 1 with exactly 3 failures: A1, A2, C1. B1 passes.
# If B1 still fails, the AI-claim strings in custom-category.tsx have not been neutralized.

# 3. Verify the home screen renders without the custom card
# Manual: launch the app, confirm the 4-tile category grid is now a 3-tile grid.
# Confirm tapping any tile opens the question screen.
# (Native build: cd mobile && npx expo run:ios)

# 4. Verify the lobby create screen renders without the custom card
# Manual: navigate to Play tab → Create lobby. Confirm 3 tiles, no "Any topic", no custom input field.

# 5. Maestro suite
cd /Users/mizzy/Developer/Trivolta/mobile && ./run_tests.sh
# Expected: 23 passed, 0 failed, 4 skipped.
# Skipped: test_27 (existing), test_05, test_21, test_22 (new).
# Test_08 must pass with the new entry sequence.

# 6. Confirm files we said we wouldn't touch are unchanged
cd /Users/mizzy/Developer/Trivolta
git diff --stat HEAD -- mobile/maestro/test_05_custom_category.yaml mobile/maestro/test_21_custom_category_interactions.yaml mobile/maestro/test_22_create_lobby_custom_topic.yaml
# Expected: empty output (no changes to those test files).
git diff --stat HEAD -- verify-consistency.sh WORKFLOW.md CLAUDE.md
# Expected: empty output.

# 7. Capture diff for review
git diff HEAD > ~/trivolta_diff.txt
```

After all verification passes, the implementer ALWAYS runs, in order:

```
IMPL_SHA="$(git rev-parse HEAD)"
bash simplify-and-verify.sh
bash run-review.sh "$IMPL_SHA" INSTRUCTIONS_HIDE_CUSTOM_CATEGORY_FOR_BETA.md
```

Note: `IMPL_SHA` is captured BEFORE `simplify-and-verify.sh` per `WORKFLOW.md`. The reviewer must run against the implementation commit, not any chore commit landed on top.

The implementer does not return control to Mike until run-review.sh exits 0.

## Stop conditions

Stop and ask Mike if any of these happen:

- `verify-consistency.sh` post-implementation reports anything other than exactly 3 failures (A1, A2, C1). More than 3 means new drift was introduced. Fewer than 3 means a check unexpectedly passed and the script's expectation needs investigation.
- Any test other than test_05, test_21, test_22, or test_27 ends up in the failed or skipped column.
- `tsc` reports any error after Step 2 — likely means a `'custom'` reference was missed somewhere.
- The `git diff --stat` check in Verification step 6 shows changes to files outside the Modified list above.
