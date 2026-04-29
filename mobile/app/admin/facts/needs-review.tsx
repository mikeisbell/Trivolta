import { useEffect, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type Row = {
  id: string
  fact_text: string
  correct_answer: string
  difficulty: number
  created_at: string
  latest: {
    cross_check_confidence: number | null
    cross_check_reasoning: string | null
    failure_stage: string | null
    failure_reason: string | null
  } | null
}

export default function AdminFactsNeedsReviewScreen() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: facts, error: factsErr } = await supabase
        .from('facts')
        .select('id, fact_text, correct_answer, difficulty, created_at')
        .eq('verification_status', 'needs_review')
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (factsErr) {
        setError(factsErr.message)
        return
      }
      const typedFacts = (facts ?? []) as Array<{
        id: string
        fact_text: string
        correct_answer: string
        difficulty: number
        created_at: string
      }>

      if (typedFacts.length === 0) {
        setRows([])
        return
      }

      const { data: logs, error: logsErr } = await supabase
        .from('fact_auto_seed_log')
        .select('fact_id, cross_check_confidence, cross_check_reasoning, failure_stage, failure_reason, created_at')
        .in('fact_id', typedFacts.map((f) => f.id))
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (logsErr) {
        setError(logsErr.message)
        return
      }

      const latestByFact = new Map<string, Row['latest']>()
      for (const l of (logs ?? []) as Array<{
        fact_id: string
        cross_check_confidence: number | null
        cross_check_reasoning: string | null
        failure_stage: string | null
        failure_reason: string | null
      }>) {
        if (!latestByFact.has(l.fact_id)) {
          latestByFact.set(l.fact_id, {
            cross_check_confidence: l.cross_check_confidence,
            cross_check_reasoning: l.cross_check_reasoning,
            failure_stage: l.failure_stage,
            failure_reason: l.failure_reason,
          })
        }
      }

      setRows(typedFacts.map((f) => ({ ...f, latest: latestByFact.get(f.id) ?? null })))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    )
  }
  if (!rows) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.purpleLight} />
      </View>
    )
  }
  if (rows.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No facts need review.</Text>
        <Text style={styles.emptyDesc}>The auto-seed pipeline hasn{"'"}t flagged anything yet.</Text>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push(`/admin/facts/${item.id}` as never)}
        >
          <Text style={styles.factText} numberOfLines={2}>{item.fact_text}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Answer:</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{item.correct_answer}</Text>
          </View>
          <View style={styles.pillRow}>
            {item.latest?.cross_check_confidence !== null && item.latest?.cross_check_confidence !== undefined ? (
              <Pill label={`confidence ${item.latest.cross_check_confidence} / 5`} accent={colors.gold} />
            ) : null}
            {item.latest?.failure_stage ? (
              <Pill label={`stage: ${item.latest.failure_stage}`} accent={colors.danger} />
            ) : null}
            {item.latest?.failure_reason ? (
              <Pill label={item.latest.failure_reason} />
            ) : null}
            <Pill label={`difficulty ${item.difficulty}`} />
          </View>
          {item.latest?.cross_check_reasoning ? (
            <Text style={styles.reasoningText} numberOfLines={3}>
              {item.latest.cross_check_reasoning}
            </Text>
          ) : null}
        </TouchableOpacity>
      )}
    />
  )
}

function Pill({ label, accent }: { label: string; accent?: string }) {
  return (
    <View style={[styles.pill, accent ? { backgroundColor: accent + '22', borderColor: accent } : null]}>
      <Text style={[styles.pillText, accent ? { color: accent } : null]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.lg },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  factText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  metaLabel: { color: colors.textSecondary, fontSize: 11 },
  metaValue: { color: colors.textPrimary, fontSize: 12, flexShrink: 1 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
    borderColor: colors.border,
    borderWidth: 1,
  },
  pillText: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
  reasoningText: { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: spacing.sm },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  emptyDesc: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  errorText: { color: colors.danger },
})
