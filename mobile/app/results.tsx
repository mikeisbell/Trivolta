import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { colors, radius, spacing } from '../lib/theme'

function gradeLabel(pct: number): string {
  if (pct >= 90) return 'Outstanding! 🏆'
  if (pct >= 70) return 'Excellent! 🎯'
  if (pct >= 50) return 'Good effort 👍'
  return 'Keep practicing 💪'
}

export default function ResultScreen() {
  const router = useRouter()
  const { category, score, correctCount, totalQuestions, bestStreak } =
    useLocalSearchParams<{
      category: string
      score: string
      correctCount: string
      totalQuestions: string
      bestStreak: string
    }>()

  const correct = parseInt(correctCount ?? '0')
  const total = parseInt(totalQuestions ?? '10')
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="results-screen" style={styles.root}>

        {/* Trophy + grade */}
        <View style={styles.hero}>
          <Text style={styles.trophy}>
            {pct >= 70 ? '🏆' : pct >= 50 ? '🎯' : '💪'}
          </Text>
          <Text style={styles.grade}>{gradeLabel(pct)}</Text>
          <Text style={styles.detail}>
            {category} · {correct}/{total} correct · {pct}% accuracy
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{parseInt(score ?? '0').toLocaleString()}</Text>
            <Text style={styles.statLabel}>Score</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{bestStreak}x</Text>
            <Text style={styles.statLabel}>Best streak</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{pct}%</Text>
            <Text style={styles.statLabel}>Accuracy</Text>
          </View>
        </View>

        {/* XP bar */}
        <View style={styles.xpWrap}>
          <View style={styles.xpLabels}>
            <Text style={styles.xpLabel}>Level 1</Text>
            <Text style={styles.xpLabel}>+{Math.round(parseInt(score ?? '0') / 10)} XP earned</Text>
          </View>
          <View style={styles.xpTrack}>
            <View style={[styles.xpFill, { width: `${Math.min(pct, 100)}%` }]} />
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            testID="results-play-again"
            style={styles.primaryBtn}
            onPress={() => router.replace({
              pathname: '/question',
              params: { category },
            })}
          >
            <Text style={styles.primaryText}>Play again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="results-home"
            style={styles.ghostBtn}
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
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xxl },

  hero: { alignItems: 'center', paddingTop: 48, paddingBottom: spacing.xl },
  trophy: { fontSize: 56, marginBottom: spacing.md },
  grade: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  detail: { fontSize: 12, color: colors.textMuted, textAlign: 'center', textTransform: 'capitalize' },

  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  statNum: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },

  xpWrap: { marginBottom: spacing.xl },
  xpLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  xpLabel: { fontSize: 10, color: colors.textMuted },
  xpTrack: { height: 6, backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden' },
  xpFill: { height: 6, backgroundColor: colors.purple, borderRadius: 3 },

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
