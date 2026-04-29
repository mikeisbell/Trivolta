import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type EligibleFact = {
  id: string
  fact_text: string
  correct_answer: string
  active_count: number
}

type GenerationResult = {
  ok: boolean
  fact_id: string
  distractors: string[]
  scores: number[]
  reason?: string
}

const MAX_AMBIGUITY = 5

export default function AdminDistractorsGenerateScreen() {
  const [fact, setFact] = useState<EligibleFact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const loadNext = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setGenError(null)
    const { data, error } = await supabase
      .from('facts')
      .select('id, fact_text, correct_answer, is_high_value, distractors(is_active)')
      .eq('is_high_value', false)
      .order('created_at', { ascending: true })
      .limit(50)
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    type Row = {
      id: string
      fact_text: string
      correct_answer: string
      is_high_value: boolean
      distractors: Array<{ is_active: boolean | null }> | null
    }
    const eligible = ((data ?? []) as Row[])
      .map((r) => ({
        id: r.id,
        fact_text: r.fact_text,
        correct_answer: r.correct_answer,
        active_count: (r.distractors ?? []).filter((d) => d.is_active === true).length,
      }))
      .find((r) => r.active_count < 3)
    setFact(eligible ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadNext()
  }, [loadNext])

  async function generate() {
    if (!fact) return
    setGenerating(true)
    setGenError(null)
    setResult(null)
    try {
      const { data, error } = await supabase.functions.invoke<GenerationResult>(
        'fact-bank-generate-distractors',
        { body: { fact_id: fact.id } },
      )
      if (error) {
        setGenError(error.message)
        return
      }
      setResult(data ?? null)
    } finally {
      setGenerating(false)
    }
  }

  async function approveAll() {
    if (!fact || !result || !result.ok) return
    setApproving(true)
    try {
      const rows = result.distractors.map((text, i) => ({
        fact_id: fact.id,
        distractor_text: text,
        authored_by: 'ai-cached',
        is_active: true,
        quality_score: ambiguityToQuality(result.scores[i] ?? 3),
      }))
      const { error } = await supabase.from('distractors').insert(rows)
      if (error) {
        setGenError(error.message)
        return
      }
      await loadNext()
    } finally {
      setApproving(false)
    }
  }

  if (loading) return <Center><ActivityIndicator color={colors.purpleLight} /></Center>
  if (error) return <Center><Text style={styles.errorText}>Error: {error}</Text></Center>
  if (!fact) {
    return (
      <Center>
        <Text style={styles.emptyTitle}>No long-tail facts need distractors.</Text>
        <Text style={styles.emptyDesc}>Every eligible fact already has 3 active distractors.</Text>
      </Center>
    )
  }

  const validation = result && !result.ok

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Fact</Text>
      <View style={styles.card}>
        <Text style={styles.factText}>{fact.fact_text}</Text>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Answer</Text><Text style={styles.kvValue}>{fact.correct_answer}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Active distractors</Text><Text style={styles.kvValue}>{fact.active_count} / 3</Text></View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.btn, generating && styles.btnDisabled]}
          disabled={generating}
          onPress={generate}
        >
          {generating ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.btnText}>Generate AI distractors</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={loadNext}>
          <Text style={styles.btnSecondaryText}>Skip this fact</Text>
        </TouchableOpacity>
      </View>

      {genError ? <Text style={styles.errorText}>{genError}</Text> : null}

      {result?.ok ? (
        <View>
          <Text style={styles.heading}>Proposed distractors</Text>
          {result.distractors.map((d, i) => (
            <View key={`${i}-${d}`} style={styles.card}>
              <Text style={styles.distractorText}>{d}</Text>
              <Text style={styles.scoreText}>
                ambiguity: {result.scores[i] ?? '—'} / {MAX_AMBIGUITY}
              </Text>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.btn, approving && styles.btnDisabled]}
            disabled={approving}
            onPress={approveAll}
          >
            {approving ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.btnText}>Approve all 3</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {validation ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Validation failed</Text>
          <Text style={styles.bodySmall}>
            The validator scored at least one distractor as ambiguous (≥3) on every retry.
          </Text>
          <View style={styles.scoresRow}>
            {result?.scores.map((s, i) => (
              <Pill key={i} label={`${i + 1}: ${s}`} accent={s >= 3 ? colors.danger : colors.success} />
            ))}
          </View>
          <TouchableOpacity style={styles.btn} onPress={generate}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  )
}

function ambiguityToQuality(score: number): number {
  const inverted = Math.round(MAX_AMBIGUITY + 1 - score)
  return Math.max(1, Math.min(5, inverted))
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>
}

function Pill({ label, accent }: { label: string; accent?: string }) {
  return (
    <View style={[styles.pill, accent ? { backgroundColor: accent + '22', borderColor: accent } : null]}>
      <Text style={[styles.pillText, accent ? { color: accent } : null]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  factText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: spacing.md },
  kvRow: { flexDirection: 'row', marginBottom: spacing.xs, alignItems: 'flex-start' },
  kvKey: { color: colors.textSecondary, fontSize: 12, width: 140 },
  kvValue: { color: colors.textPrimary, fontSize: 13, flex: 1 },
  actionRow: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.md, flexWrap: 'wrap' },
  btn: {
    flex: 1,
    minWidth: 200,
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: { color: colors.textSecondary, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  distractorText: { color: colors.textPrimary, fontSize: 14, marginBottom: 4 },
  scoreText: { color: colors.textMuted, fontSize: 11 },
  bodySmall: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.sm },
  scoresRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
    borderColor: colors.border,
    borderWidth: 1,
  },
  pillText: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
  errorText: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  emptyDesc: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
})
