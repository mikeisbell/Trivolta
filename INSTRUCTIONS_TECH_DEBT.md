# INSTRUCTIONS_TECH_DEBT.md

## Task

Fix four pieces of hardcoded UI on HomeScreen that will confuse beta testers. Each currently shows fake data. Replace each with real data from Supabase or remove it cleanly.

The four items:
1. **Coin balance** — hardcoded "1.23k" — remove the coin badge entirely (coins are not implemented)
2. **HomeScreen streak** — not present as a standalone element but `home-quick-play` picks randomly from CATEGORIES which includes `custom` — this can route to CustomCategoryScreen instead of QuestionScreen, which is wrong
3. **XP bar on ResultScreen** — decorative, shows fake data — remove it cleanly
4. **Trending categories on CustomCategoryScreen** — hardcoded array — replace with real data from a Supabase query on the `scores` table (top 8 categories by play count in the last 30 days), falling back to the current hardcoded list if the query returns fewer than 4 results

---

## Verifiable Objective

- [ ] Coin badge (`coinBadge`, `coinCircle`, `coinIcon`, `coinValue` styles + JSX) removed from HomeScreen — no visible coin element
- [ ] `home-quick-play` button only picks from the three fixed categories (Science, Pop culture, History) — never routes to CustomCategoryScreen or `/custom-category`
- [ ] XP section (`xpWrap`, `xpLabels`, `xpLabel`, `xpTrack`, `xpFill` styles + JSX) removed from ResultScreen — the results layout still shows trophy, grade, stats row, and action buttons
- [ ] CustomCategoryScreen trending section shows real categories from Supabase on mount — fetched from `scores` table grouped by `category`, ordered by count descending, limit 8, last 30 days
- [ ] If Supabase query returns fewer than 4 results, the hardcoded `TRENDING` array is used as fallback
- [ ] Trending items still navigate to `/question` with the category label as param
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] All 15 existing Maestro tests still pass — `./run_tests.sh`
- [ ] `TRIVOLTA_TRACKER.md` updated — coin, streak, XP tech debt items removed from Known Issues; trending categories marked ✅
- [ ] `INSTRUCTIONS_TECH_DEBT.md` added to INSTRUCTIONS Files Written in tracker

---

## Constraints

- Do NOT remove the `home-screen` testID or any other testID used by tests 01–15
- Do NOT remove the `results-screen` testID
- Do NOT change the ResultScreen stats row (score, best streak, accuracy cards) — only the XP section is removed
- Do NOT change the ResultScreen action buttons (`results-play-again`, `results-home`)
- The trending query must be non-blocking — fetch on mount, show hardcoded fallback until data arrives, then update
- Do NOT add a loading spinner for trending — just show hardcoded items initially, swap in real data when ready
- Trending items must keep their `custom-category-trending-{id}` testID pattern — use the category string slugified as the id (lowercase, spaces replaced with underscores, max 20 chars)
- Do NOT modify any lobby screens, question screen, or auth screen

---

## Steps

### Step 1 — Remove coin badge from HomeScreen

In `mobile/app/(tabs)/index.tsx`:

Remove the `coinBadge` JSX block entirely from the header row (the `<View style={styles.coinBadge}>` and all its children).

Remove the corresponding styles: `coinBadge`, `coinCircle`, `coinIcon`, `coinValue`.

The header row will then only contain `headerLeft` (avatar + greeting).

### Step 2 — Fix quick-play random category

In `mobile/app/(tabs)/index.tsx`:

The `home-quick-play` button currently picks randomly from all 4 `CATEGORIES` entries including `custom`. `custom` has `label: 'Any topic'` and the question screen would receive category `'Any topic'` which is meaningless, or worse the nav goes to `/custom-category`.

Fix: define a separate constant `PLAYABLE_CATEGORIES` containing only the three fixed categories (Science, Pop culture, History). Use this array in the `home-quick-play` `onPress` handler instead of `CATEGORIES`.

### Step 3 — Remove XP section from ResultScreen

In `mobile/app/results.tsx`:

Remove the `xpWrap` JSX block (the `<View style={styles.xpWrap}>` and all its children including the two label texts and the track/fill views).

Remove the corresponding styles: `xpWrap`, `xpLabels`, `xpLabel`, `xpTrack`, `xpFill`.

The layout order after removal: hero section → stats row → action buttons.

### Step 4 — Real trending categories on CustomCategoryScreen

In `mobile/app/custom-category.tsx`:

Add `useState` and `useEffect` imports if not already present. Add a Supabase import.

Add state: `trendingCategories` typed as an array matching the shape of `TRENDING` items, initialised to the hardcoded `TRENDING` array.

On mount, query the `scores` table: select `category`, count rows, group by `category`, filter `played_at >= now() - 30 days`, order by count descending, limit 8. Use the Supabase client directly (not an Edge Function).

Map the results into the same shape as `TRENDING` items. Assign a simple emoji per category using a lookup — if the category matches a known label (Science, Pop culture, History, etc.) use its existing emoji; otherwise use `'🎯'` as default. Set `plays` to the count formatted as a string (e.g. `'42'`). Set `id` to the category slugified (lowercase, spaces to underscores, max 20 chars).

If the query returns 4 or more results, replace `trendingCategories` state with the real data. If fewer than 4, keep the hardcoded fallback.

Render using `trendingCategories` state instead of the hardcoded `TRENDING` constant.

The `TRENDING` constant remains in the file as the fallback — do not delete it.

### Step 5 — Update TRIVOLTA_TRACKER.md

In the Known Issues section, remove or mark resolved:
- "Coin balance on HomeScreen is hardcoded — needs real implementation"
- "Streak display on HomeScreen is hardcoded — needs real data from Supabase"
- "XP and level system not yet implemented — ResultScreen XP bar is decorative"

Update "Trending categories from real play data (currently hardcoded)" to ✅ in Core Features.

Add `INSTRUCTIONS_TECH_DEBT.md` to the INSTRUCTIONS Files Written section.

---

## Verification

```bash
# TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit

# Full Maestro suite
./run_tests.sh

# Manual checks in simulator
# 1. HomeScreen — no coin badge visible in header
# 2. Tap "Quick play" multiple times — always lands on question screen (never custom category screen)
# 3. Complete a quiz — results screen shows no XP bar between stats row and action buttons
# 4. CustomCategoryScreen — trending section loads (may show hardcoded items first, then real data after mount)

# Diff for Mac Claude review
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Do not report done until all 15 tests pass and manual checks are confirmed. Do not commit — Mac Claude reviews the diff first.
