# INSTRUCTIONS_LOBBY_RESULTS.md — LobbyResultsScreen

## Task

Build LobbyResultsScreen — the post-game summary for multiplayer lobbies. When a lobby game ends, all players navigate here with `lobbyId`. The screen must:

- Fetch all players' scores from `lobby_answers` (count correct answers per player)
- Join with `profiles` to get usernames
- Display a ranked leaderboard: gold/silver/bronze podium for top 3, ranked rows for the rest
- Highlight the current user's row
- Show current user's own stats: score, correct count, accuracy
- Provide "Play again" (creates new lobby with same category) and "Back to home" actions

Data source: `lobby_answers` joined to `lobby_questions` (to know the correct answer) joined to `profiles` (for usernames). All data is in Supabase — no params other than `lobbyId` are passed.

---

## Verifiable Objective

- [ ] Screen renders player rankings — testID `lobby-results-list`
- [ ] Current user's row is visually highlighted — testID `lobby-results-my-row`
- [ ] Top 3 rows show medal emoji (🥇🥈🥉) — testID `lobby-results-player-{rank}` where rank is 1, 2, 3
- [ ] Current user's score card shows correct count and accuracy — testID `lobby-results-my-score`
- [ ] "Play again" button navigates to `/lobby/create` — testID `lobby-results-play-again`
- [ ] "Back to home" button navigates to `/` — testID `lobby-results-home`
- [ ] Loading state shown while data is fetching — testID `lobby-results-loading`
- [ ] `npx tsc --noEmit` passes with 0 errors

---

## Constraints

- Do NOT pass score data as route params — compute all scores from `lobby_answers` + `lobby_questions` on this screen
- Do NOT modify `game.tsx`, `api.ts` existing functions, or any other screen
- Do NOT add new Edge Functions — query Supabase directly from the screen
- Scoring: a player's score = count of questions where their `answer_index` matches `lobby_questions.correct_index` for that `question_index`. Present as correct count and accuracy percentage only — do NOT use the point-based scoring formula (that's for solo play). Lobby results are purely correct/total.
- Style must match the existing dark theme — use `colors`, `radius`, `spacing` from `lib/theme`
- The screen must handle the case where a player answered 0 questions (e.g. disconnected) — show 0/10, 0%
- `lobby_answers` may have fewer rows than `lobby_players` if some players disconnected — handle gracefully

---

## Steps

### Step 1 — Add `fetchLobbyResults` to `api.ts`

Append to `/Users/mizzy/Developer/Trivolta/mobile/lib/api.ts`:

```typescript
export type LobbyPlayerResult = {
  user_id: string
  username: string
  correct: number
  total: number
  accuracy: number
  rank: number
  isCurrentUser: boolean
}

export async function fetchLobbyResults(lobbyId: string): Promise<LobbyPlayerResult[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const currentUserId = session?.user.id ?? ''

  // Fetch all players in this lobby
  const { data: players, error: playersError } = await supabase
    .from('lobby_players')
    .select('user_id, profiles(username)')
    .eq('lobby_id', lobbyId)

  if (playersError || !players) return []

  // Fetch all questions for this lobby (to know correct answers)
  const { data: questions, error: questionsError } = await supabase
    .from('lobby_questions')
    .select('question_index, correct_index')
    .eq('lobby_id', lobbyId)

  if (questionsError || !questions) return []

  const correctByIndex: Record<number, number> = {}
  for (const q of questions) {
    correctByIndex[q.question_index] = q.correct_index
  }
  const total = questions.length

  // Fetch all answers for this lobby
  const { data: answers, error: answersError } = await supabase
    .from('lobby_answers')
    .select('user_id, question_index, answer_index')
    .eq('lobby_id', lobbyId)

  if (answersError) return []

  // Compute correct count per player
  const correctCountByUser: Record<string, number> = {}
  for (const answer of answers ?? []) {
    const isCorrect = correctByIndex[answer.question_index] === answer.answer_index
    if (isCorrect) {
      correctCountByUser[answer.user_id] = (correctCountByUser[answer.user_id] ?? 0) + 1
    }
  }

  // Build result rows
  const rows = players.map((p: any) => {
    const username = Array.isArray(p.profiles) ? p.profiles[0]?.username : p.profiles?.username ?? 'Unknown'
    const correct = correctCountByUser[p.user_id] ?? 0
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0
    return {
      user_id: p.user_id,
      username,
      correct,
      total,
      accuracy,
      rank: 0,
      isCurrentUser: p.user_id === currentUserId,
    }
  })

  // Sort by correct count descending, assign ranks
  rows.sort((a, b) => b.correct - a.correct)
  rows.forEach((r, i) => { r.rank = i + 1 })

  return rows
}
```

### Step 2 — Build `results.tsx`

Replace the entire contents of `/Users/mizzy/Developer/Trivolta/mobile/app/lobby/results.tsx`:

```typescript
import { useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, FlatList,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { colors, radius, spacing } from '../../lib/theme'
import { fetchLobbyResults } from '../../lib/api'
import type { LobbyPlayerResult } from '../../lib/api'

const MEDALS = ['🥇', '🥈', '🥉']

export default function LobbyResultsScreen() {
  const { lobbyId } = useLocalSearchParams<{ lobbyId: string }>()
  const router = useRouter()
  const [results, setResults] = useState<LobbyPlayerResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLobbyResults(lobbyId).then(data => {
      setResults(data)
      setLoading(false)
    })
  }, [lobbyId])

  const myResult = results.find(r => r.isCurrentUser)

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View testID="lobby-results-loading" style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.purple} />
          <Text style={styles.loadingText}>Calculating results…</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        {/* Header */}
        <Text style={styles.title}>Game over!</Text>
        <Text style={styles.sub}>Final standings</Text>

        {/* My stats card */}
        {myResult && (
          <View testID="lobby-results-my-score" style={styles.myCard}>
            <View style={styles.myCardInner}>
              <View style={styles.myStat}>
                <Text style={styles.myStatNum}>{myResult.correct}/{myResult.total}</Text>
                <Text style={styles.myStatLabel}>Correct</Text>
              </View>
              <View style={styles.myStatDivider} />
              <View style={styles.myStat}>
                <Text style={styles.myStatNum}>{myResult.accuracy}%</Text>
                <Text style={styles.myStatLabel}>Accuracy</Text>
              </View>
              <View style={styles.myStatDivider} />
              <View style={styles.myStat}>
                <Text style={styles.myStatNum}>#{myResult.rank}</Text>
                <Text style={styles.myStatLabel}>Your rank</Text>
              </View>
            </View>
          </View>
        )}

        {/* Rankings */}
        <FlatList
          testID="lobby-results-list"
          data={results}
          keyExtractor={(item) => item.user_id}
          style={styles.list}
          renderItem={({ item }) => {
            const medal = item.rank <= 3 ? MEDALS[item.rank - 1] : null
            return (
              <View
                testID={item.rank <= 3 ? `lobby-results-player-${item.rank}` : item.isCurrentUser ? 'lobby-results-my-row' : undefined}
                style={[
                  styles.playerRow,
                  item.isCurrentUser && styles.playerRowMe,
                ]}
              >
                <Text style={styles.rankText}>
                  {medal ?? `#${item.rank}`}
                </Text>
                <Text style={[styles.playerName, item.isCurrentUser && styles.playerNameMe]}>
                  {item.username}{item.isCurrentUser ? ' (you)' : ''}
                </Text>
                <Text style={styles.playerScore}>
                  {item.correct}/{item.total}
                </Text>
                <Text style={styles.playerAccuracy}>
                  {item.accuracy}%
                </Text>
              </View>
            )
          }}
        />

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            testID="lobby-results-play-again"
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={() => router.replace('/lobby/create')}
          >
            <Text style={styles.primaryText}>Play again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="lobby-results-home"
            style={styles.ghostBtn}
            activeOpacity={0.85}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.ghostText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.xl, paddingBottom: 32 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  loadingText: { color: colors.textSecondary, fontSize: 14 },

  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  sub: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },

  myCard: {
    backgroundColor: colors.purpleDim,
    borderWidth: 1,
    borderColor: colors.purpleBorder,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  myCardInner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  myStat: { alignItems: 'center' },
  myStatNum: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.purpleLight,
  },
  myStatLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  myStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.purpleBorder,
  },

  list: {
    flex: 1,
    marginBottom: spacing.lg,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  playerRowMe: {
    backgroundColor: colors.purpleDim,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 0,
    marginBottom: 1,
  },
  rankText: {
    fontSize: 16,
    width: 32,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  playerName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  playerNameMe: {
    color: colors.purpleLight,
  },
  playerScore: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    width: 40,
    textAlign: 'right',
  },
  playerAccuracy: {
    fontSize: 12,
    color: colors.textMuted,
    width: 36,
    textAlign: 'right',
  },

  actions: { gap: spacing.sm },
  primaryBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  ghostBtn: {
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
})
```

### Step 3 — Update TRIVOLTA_TRACKER.md

Mark `LobbyResultScreen` as ✅ Done. Mark `Real-time lobby synchronisation` as ✅ (all lobby Realtime work is now complete). Add `INSTRUCTIONS_LOBBY_RESULTS.md` to INSTRUCTIONS Files Written. Mark `Lobby question generation (all 10 before game start)` as ✅.

---

## Verification

Run in order. Do not report success until all pass.

```bash
# 1. TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Confirm results.tsx rebuilt
grep -c "testID" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/results.tsx

# 3. Confirm fetchLobbyResults exported from api.ts
grep "fetchLobbyResults" /Users/mizzy/Developer/Trivolta/mobile/lib/api.ts

# 4. Confirm LobbyPlayerResult type exported
grep "LobbyPlayerResult" /Users/mizzy/Developer/Trivolta/mobile/lib/api.ts

# 5. Capture diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each check result. Do not commit — Mac Claude reviews the diff first.
