import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/auth'
import { submitSpotCheck } from '../../../lib/api'
import { colors, radius, spacing } from '../../../lib/theme'

type SpotCheckFact = {
  id: string
  fact_text: string
  correct_answer: string
  difficulty: number
  category_slug: string
  category_display_name: string
  distractors: string[]
}

type Mode = 'idle' | 'note' | 'submitting'

const TARGET_REVIEWS = 50

export default function AdminFactsSpotCheckScreen() {
  const { user } = useAuth()
  const [fact, setFact] = useState<SpotCheckFact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [note, setNote] = useState('')
  const [reviewedToday, setReviewedToday] = useState(0)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const loadCount = useCallback(async () => {
    if (!user) return
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('spot_check_results')
      .select('id', { count: 'exact', head: true })
      .eq('reviewer_id', user.id)
      .gte('reviewed_at', since)
    setReviewedToday(count ?? 0)
  }, [user])

  const loadNext = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMode('idle')
    setNote('')
    const { data, error: rpcErr } = await supabase.rpc('get_next_spot_check_fact')
    if (rpcErr) {
      setError(rpcErr.message)
      setFact(null)
      setLoading(false)
      return
    }
    const rows = (data ?? []) as SpotCheckFact[]
    setFact(rows.length > 0 ? rows[0] : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadNext()
    loadCount()
  }, [loadNext, loadCount])

  const showConfirmation = useCallback((label: string) => {
    setConfirmation(label)
    setTimeout(() => setConfirmation(null), 1500)
  }, [])

  const submit = useCallback(
    async (verdict: 'correct' | 'incorrect', noteValue: string | null) => {
      if (!fact) return
      setMode('submitting')
      setError(null)
      try {
        const res = await submitSpotCheck({
          fact_id: fact.id,
          verdict,
          note: noteValue && noteValue.trim().length > 0 ? noteValue : undefined,
        })
        if (!res.ok && res.reason === 'already_reviewed') {
          await loadNext()
          await loadCount()
          return
        }
        showConfirmation(verdict === 'correct' ? 'Recorded as correct' : 'Reported')
        await loadCount()
        await loadNext()
      } catch {
        setError("Couldn't save. Try again.")
        setMode('idle')
      }
    },
    [fact, loadCount, loadNext, showConfirmation],
  )

  const onCorrect = () => submit('correct', null)
  const onIncorrect = () => setMode('note')
  const onSubmitIncorrect = () => submit('incorrect', note)
  const onCancelIncorrect = () => {
    setMode('idle')
    setNote('')
  }

  const onSkip = () => {
    loadNext()
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.purpleLight} />
      </View>
    )
  }

  if (!fact) {
    return (
      <View style={styles.center} testID="spot-check-empty-state">
        <Text style={styles.emptyTitle}>All caught up.</Text>
        <Text style={styles.emptyDesc}>
          You{"'"}ve spot-checked every eligible fact. Reviewed {reviewedToday} in the last 24h.
        </Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.progressRow}>
        <View style={styles.progressChip} testID="spot-check-progress">
          <Text style={styles.progressText}>
            Reviewed {reviewedToday} of {TARGET_REVIEWS} today
          </Text>
        </View>
        <View style={[styles.progressChip, styles.categoryChip]}>
          <Text style={styles.progressText}>
            {fact.category_display_name} · {fact.category_slug}
          </Text>
        </View>
      </View>

      <Text style={styles.factText} testID="spot-check-fact-text">
        {fact.fact_text}
      </Text>

      <Text style={styles.correctText} testID="spot-check-correct">
        Correct: {fact.correct_answer}
      </Text>

      <View style={styles.distractorsBlock}>
        <Text style={styles.distractorsLabel}>Distractors</Text>
        {fact.distractors.map((d, i) => (
          <Text key={`${i}-${d}`} style={styles.distractor} testID={`spot-check-distractor-${i}`}>
            • {d}
          </Text>
        ))}
      </View>

      {confirmation ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{confirmation}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {mode === 'note' ? (
        <View style={styles.noteBlock}>
          <TextInput
            testID="spot-check-note-input"
            style={styles.noteInput}
            placeholder="What's wrong? (optional)"
            placeholderTextColor={colors.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={2000}
            textAlignVertical="top"
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              testID="spot-check-cancel-incorrect"
              onPress={onCancelIncorrect}
              style={[styles.btn, styles.btnSecondary]}
              activeOpacity={0.8}
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="spot-check-submit-incorrect"
              onPress={onSubmitIncorrect}
              style={[styles.btn, styles.btnDanger]}
              activeOpacity={0.8}
            >
              <Text style={styles.btnDangerText}>Submit report</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              testID="spot-check-correct-btn"
              onPress={onCorrect}
              disabled={mode === 'submitting'}
              style={[styles.btn, styles.btnSuccess, mode === 'submitting' ? styles.btnDisabled : null]}
              activeOpacity={0.8}
            >
              <Text style={styles.btnSuccessText}>Looks correct</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="spot-check-incorrect-btn"
              onPress={onIncorrect}
              disabled={mode === 'submitting'}
              style={[styles.btn, styles.btnDanger, mode === 'submitting' ? styles.btnDisabled : null]}
              activeOpacity={0.8}
            >
              <Text style={styles.btnDangerText}>Report incorrect</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            testID="spot-check-skip"
            onPress={onSkip}
            disabled={mode === 'submitting'}
            style={styles.skipBtn}
            activeOpacity={0.6}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  progressRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  progressChip: {
    backgroundColor: colors.purpleDim,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.purpleBorder,
  },
  categoryChip: {
    backgroundColor: colors.surfaceBright,
    borderColor: colors.border,
  },
  progressText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  factText: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: spacing.lg,
  },
  correctText: {
    color: colors.success,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.lg,
  },
  distractorsBlock: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  distractorsLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  distractor: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  banner: {
    backgroundColor: colors.successDim,
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  bannerText: { color: colors.success, fontSize: 13, fontWeight: '700' },
  errorText: { color: colors.danger, marginBottom: spacing.md },
  noteBlock: { gap: spacing.md },
  noteInput: {
    minHeight: 120,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  btnSuccess: { backgroundColor: colors.success },
  btnSuccessText: { color: colors.textPrimary, fontWeight: '700' },
  btnDanger: { backgroundColor: colors.danger },
  btnDangerText: { color: colors.textPrimary, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: colors.surfaceBright,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: { color: colors.textPrimary, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  skipBtn: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  skipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  emptyDesc: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
})
