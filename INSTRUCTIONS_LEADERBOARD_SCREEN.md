# INSTRUCTIONS_LEADERBOARD_SCREEN.md — Trivolta Leaderboard screen

## Task
Build the LeaderboardScreen with real data from Supabase. Shows a podium for the top 3
players, rank rows for 4-10, the current user's position highlighted, and All time /
Last week / Last month tabs. Matches the v2 premium dark design with podium treatment.

## Verifiable objective
When complete:
- `npx tsc --noEmit` exits with 0 errors
- LeaderboardScreen loads with real data from the Supabase leaderboard view
- Top 3 players shown in podium layout (2nd left, 1st center elevated, 3rd right)
- Players 4-10 shown as rank rows below the podium
- Current user's row highlighted in purple
- All time / Last week / Last month tabs switch the data period
- Loading state shown while fetching
- testID="leaderboard-screen" on root View
- All 6 Maestro tests still pass
- `git diff HEAD > ~/trivolta_diff.txt` captures all changes

## Constraints
- Read CLAUDE.md before writing a single file
- All colors from lib/theme.ts — no inline hex strings
- Real data from Supabase leaderboard view — no hardcoded players
- If fewer than 3 players exist, podium renders gracefully with empty slots
- Current user identification uses the auth session user ID
- Rank movement arrows (▲▼) are visual only for v1 — no historical data needed
- Do not add Friends tab — v1 has All time, Last week, Last month only
- Loading state must be shown while fetching

---

## Step 1 — Add leaderboard types to types.ts

Add to `mobile/lib/types.ts`:

```typescript
export type LeaderboardEntry = {
  id: string
  username: string
  avatar_url: string | null
  total_score: number
  games_played: number
  rank?: number
}

export type LeaderboardPeriod = 'alltime' | 'week' | 'month'
```

---

## Step 2 — Add leaderboard fetching to api.ts

Add to `mobile/lib/api.ts`:

```typescript
export async function fetchLeaderboard(
  period: LeaderboardPeriod
): Promise<LeaderboardEntry[]> {
  let query = supabase
    .from('scores')
    .select('user_id, profiles(id, username, avatar_url)')

  // Apply time filter
  if (period === 'week') {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('played_at', weekAgo)
  } else if (period === 'month') {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('played_at', monthAgo)
  }

  const { data: scoreRows, error } = await query

  if (error || !scoreRows) return []

  // Aggregate scores per user
  const userMap: Record<string, { username: string; avatar_url: string | null; total: number; games: number }> = {}

  for (const row of scoreRows) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    if (!profile) continue
    if (!userMap[row.user_id]) {
      userMap[row.user_id] = {
        username: profile.username,
        avatar_url: profile.avatar_url,
        total: 0,
        games: 0,
      }
    }
    userMap[row.user_id].total += (row as any).score ?? 0
    userMap[row.user_id].games += 1
  }

  // Sort and add rank
  const entries = Object.entries(userMap)
    .map(([id, data]) => ({
      id,
      username: data.username,
      avatar_url: data.avatar_url,
      total_score: data.total,
      games_played: data.games,
    }))
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 50)
    .map((entry, i) => ({ ...entry, rank: i + 1 }))

  return entries
}
```

Note: The existing leaderboard view in Supabase only covers the last 30 days. For
the "All time" tab we query scores directly. For period filters we apply date ranges.
The leaderboard view can be used for "month" as a shortcut if preferred.

---

## Step 3 — Build the LeaderboardScreen

Replace the contents of `mobile/app/(tabs)/leaderboard.tsx`:

```typescript
import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator
} from 'react-native'
import { useAuth } from '../../lib/auth'
import { fetchLeaderboard } from '../../lib/api'
import { colors, radius, spacing } from '../../lib/theme'
import type { LeaderboardEntry, LeaderboardPeriod } from '../../lib/types'

const TABS: { label: string; value: LeaderboardPeriod }[] = [
  { label: 'All time', value: 'alltime' },
  { label: 'Last week', value: 'week' },
  { label: 'Last month', value: 'month' },
]

const AVATAR_COLORS = [
  { bg: '#422006', text: '#EF9F27' },
  { bg: '#1a2e1a', text: '#97C459' },
  { bg: '#2d1a1a', text: '#F0997B' },
  { bg: '#1e1b4b', text: '#a78bfa' },
  { bg: '#1a2535', text: '#85B7EB' },
]

function getAvatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

interface PodiumItemProps {
  entry: LeaderboardEntry | null
  position: 1 | 2 | 3
  colorIndex: number
}

function PodiumItem({ entry, position, colorIndex }: PodiumItemProps) {
  const avatarColor = getAvatarColor(colorIndex)
  const isFirst = position === 1
  const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : '🥉'

  return (
    <View style={[styles.podiumItem, isFirst && styles.podiumItemFirst]}>
      <Text style={styles.podiumMedal}>{medal}</Text>
      {entry ? (
        <>
          <View style={[
            styles.podiumAvatar,
            isFirst && styles.podiumAvatarFirst,
            { backgroundColor: avatarColor.bg, borderColor: isFirst ? colors.gold : 'transparent' },
          ]}>
            <Text style={[styles.podiumAvatarText, { color: avatarColor.text }]}>
              {initials(entry.username)}
            </Text>
          </View>
          <Text style={styles.podiumName} numberOfLines={1}>{entry.username}</Text>
          <Text style={styles.podiumScore}>{entry.total_score.toLocaleString()}</Text>
        </>
      ) : (
        <>
          <View style={[styles.podiumAvatar, { backgroundColor: colors.surface }]}>
            <Text style={{ color: colors.textHint, fontSize: 18 }}>—</Text>
          </View>
          <Text style={styles.podiumName}>—</Text>
          <Text style={styles.podiumScore}>0</Text>
        </>
      )}
    </View>
  )
}

export default function LeaderboardScreen() {
  const { user } = useAuth()
  const [period, setPeriod] = useState<LeaderboardPeriod>('alltime')
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchLeaderboard(period)
    setEntries(data)
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  const userEntry = entries.find(e => e.id === user?.id)
  const top3 = [entries[1] ?? null, entries[0] ?? null, entries[2] ?? null] // 2nd, 1st, 3rd
  const rest = entries.slice(3, 10)

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="leaderboard-screen" style={styles.root}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Leaderboard</Text>
          {userEntry && (
            <View style={styles.myRankBadge}>
              <Text style={styles.myRankText}>#{userEntry.rank} — {userEntry.total_score.toLocaleString()} pts</Text>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.value}
              testID={`leaderboard-tab-${tab.value}`}
              style={[styles.tab, period === tab.value && styles.tabActive]}
              onPress={() => setPeriod(tab.value)}
            >
              <Text style={[styles.tabText, period === tab.value && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.purple} />
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🏆</Text>
            <Text style={styles.emptyTitle}>No scores yet</Text>
            <Text style={styles.emptySubtitle}>Play some games to appear on the leaderboard</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Podium */}
            <View style={styles.podium}>
              <PodiumItem entry={top3[0]} position={2} colorIndex={1} />
              <PodiumItem entry={top3[1]} position={1} colorIndex={0} />
              <PodiumItem entry={top3[2]} position={3} colorIndex={2} />
            </View>

            {/* Rank rows 4-10 */}
            <View style={styles.rankList}>
              {rest.map((entry, i) => {
                const isCurrentUser = entry.id === user?.id
                const avatarColor = getAvatarColor(i + 3)
                return (
                  <View
                    key={entry.id}
                    testID={`leaderboard-row-${entry.rank}`}
                    style={[styles.rankRow, isCurrentUser && styles.rankRowYou]}
                  >
                    <Text style={[styles.rankNum, isCurrentUser && styles.rankNumYou]}>
                      {entry.rank}
                    </Text>
                    <View style={[styles.rankAvatar, { backgroundColor: avatarColor.bg }]}>
                      <Text style={[styles.rankAvatarText, { color: avatarColor.text }]}>
                        {initials(entry.username)}
                      </Text>
                    </View>
                    <Text style={[styles.rankName, isCurrentUser && styles.rankNameYou]}>
                      {entry.username}{isCurrentUser ? ' (you)' : ''}
                    </Text>
                    <Text style={styles.rankArrow}>▲</Text>
                    <Text style={[styles.rankScore, isCurrentUser && styles.rankScoreYou]}>
                      {entry.total_score.toLocaleString()}
                    </Text>
                  </View>
                )
              })}
            </View>

            {/* Current user if outside top 10 */}
            {userEntry && (userEntry.rank ?? 0) > 10 && (
              <View style={styles.myRankSection}>
                <View style={styles.divider} />
                <View style={[styles.rankRow, styles.rankRowYou]}>
                  <Text style={[styles.rankNum, styles.rankNumYou]}>
                    {userEntry.rank}
                  </Text>
                  <View style={[styles.rankAvatar, { backgroundColor: colors.purpleDeep }]}>
                    <Text style={[styles.rankAvatarText, { color: colors.purplePale }]}>
                      {initials(userEntry.username)}
                    </Text>
                  </View>
                  <Text style={[styles.rankName, styles.rankNameYou]}>
                    {userEntry.username} (you)
                  </Text>
                  <Text style={styles.rankArrow}>▲</Text>
                  <Text style={[styles.rankScore, styles.rankScoreYou]}>
                    {userEntry.total_score.toLocaleString()}
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },

  header: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  myRankBadge: {
    backgroundColor: colors.purpleDim,
    borderWidth: 0.5,
    borderColor: colors.purpleBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  myRankText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.purpleLight,
  },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.purple,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.textPrimary,
  },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },

  podium: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  podiumItem: {
    alignItems: 'center',
    flex: 1,
  },
  podiumItemFirst: {
    marginBottom: spacing.lg,
  },
  podiumMedal: {
    fontSize: 20,
    marginBottom: spacing.xs,
  },
  podiumAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  podiumAvatarFirst: {
    width: 56,
    height: 56,
    borderColor: colors.gold,
  },
  podiumAvatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  podiumName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  podiumScore: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },

  rankList: {
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  rankRowYou: {
    backgroundColor: colors.purpleDim,
    borderColor: colors.purpleBorder,
  },
  rankNum: {
    width: 20,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
  },
  rankNumYou: {
    color: colors.purpleLight,
  },
  rankAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rankAvatarText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rankName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rankNameYou: {
    color: colors.purpleLight,
  },
  rankArrow: {
    fontSize: 10,
    color: colors.success,
  },
  rankScore: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  rankScoreYou: {
    color: colors.purpleLight,
  },

  myRankSection: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
})
```

---

## Step 4 — Add Maestro test for Leaderboard screen

Create `mobile/maestro/test_07_leaderboard_screen.yaml`:

```yaml
appId: com.mikeisbell.trivolta
---
# test_07: Leaderboard screen loads

- clearState
- launchApp:
    clearState: true

# Sign in
- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "testuser_maestro_02@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn:
    text: "Not Now"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 15000

# Navigate to Leaderboard via home avatar then tab
- tapOn:
    id: "home-avatar"

# Navigate back to home
- tapOn:
    id: "profile-back"
    optional: true
- extendedWaitUntil:
    visible:
      id: "home-screen"
    timeout: 5000

# Tap Ranks tab
- tapOn:
    id: "tab-ranks"
    optional: true

# Leaderboard screen should be visible
- extendedWaitUntil:
    visible:
      id: "leaderboard-screen"
    timeout: 10000

# Tabs should be visible
- assertVisible:
    id: "leaderboard-tab-alltime"
```

Add to `mobile/package.json` scripts:
```json
"test:e2e:07": "maestro test maestro/test_07_leaderboard_screen.yaml"
```

---

## Verification

```bash
# 1. TypeScript
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Launch and confirm visually
# - Ranks tab shows leaderboard
# - If no data: empty state with trophy icon
# - If data: podium + rank rows visible
# - Tabs switch between periods

# 3. Run all 7 Maestro tests
export PATH="$HOME/.maestro/bin:$PATH"
maestro test maestro/

# 4. Diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report:
- TypeScript: PASS/FAIL
- Visual: describe what leaderboard shows (empty state or player data)
- test_01 through test_07: PASS/FAIL each

Do not report success until TypeScript passes and all 7 tests pass.
