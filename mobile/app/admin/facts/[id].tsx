import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type Fact = {
  id: string
  fact_text: string
  correct_answer: string
  difficulty: number
  verification_status: string
  is_high_value: boolean
  source_origin: string
  category_id: string
}

type Source = {
  id: string
  url: string | null
  citation: string | null
  excerpt: string | null
  source_type: string
  verified_reachable: boolean
  human_confirmed: boolean
  added_by_ai: boolean
}

type Distractor = {
  id: string
  distractor_text: string
  authored_by: string
  is_active: boolean
  quality_score: number | null
}

export default function AdminFactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [fact, setFact] = useState<Fact | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [distractors, setDistractors] = useState<Distractor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [factRes, sourcesRes, distractorsRes] = await Promise.all([
        supabase.from('facts').select('id, fact_text, correct_answer, difficulty, verification_status, is_high_value, source_origin, category_id').eq('id', id).maybeSingle(),
        supabase.from('fact_sources').select('id, url, citation, excerpt, source_type, verified_reachable, human_confirmed, added_by_ai').eq('fact_id', id),
        supabase.from('distractors').select('id, distractor_text, authored_by, is_active, quality_score').eq('fact_id', id),
      ])
      if (cancelled) return
      const firstError = factRes.error || sourcesRes.error || distractorsRes.error
      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }
      setFact((factRes.data as Fact | null) ?? null)
      setSources((sourcesRes.data as Source[]) ?? [])
      setDistractors((distractorsRes.data as Distractor[]) ?? [])
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.purpleLight} />
      </View>
    )
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    )
  }
  if (!fact) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Fact not found.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Fact</Text>
      <View style={styles.card}>
        <Text style={styles.factText}>{fact.fact_text}</Text>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Answer</Text><Text style={styles.kvValue}>{fact.correct_answer}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Difficulty</Text><Text style={styles.kvValue}>{fact.difficulty}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Status</Text><Text style={styles.kvValue}>{fact.verification_status}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Origin</Text><Text style={styles.kvValue}>{fact.source_origin}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvKey}>High value</Text><Text style={styles.kvValue}>{fact.is_high_value ? 'yes' : 'no'}</Text></View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.actionBtn, styles.actionDisabled]} disabled>
          <Text style={styles.actionText}>Approve</Text>
          <Text style={styles.actionSub}>Coming in Phase 2.6.2</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.actionDisabled]} disabled>
          <Text style={styles.actionText}>Reject</Text>
          <Text style={styles.actionSub}>Coming in Phase 2.6.2</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.heading}>Sources ({sources.length})</Text>
      {sources.length === 0 ? (
        <Text style={styles.emptyInline}>No sources yet. AI-assisted citation lands in Phase 2.6.2.</Text>
      ) : (
        sources.map((s) => (
          <View key={s.id} style={styles.card}>
            <Text style={styles.kvValue}>{s.citation ?? s.url ?? '—'}</Text>
            {s.url ? <Text style={styles.urlText}>{s.url}</Text> : null}
            {s.excerpt ? <Text style={styles.excerptText}>"{s.excerpt}"</Text> : null}
            <View style={styles.pillRow}>
              <Pill label={s.source_type} />
              <Pill label={`reachable: ${s.verified_reachable ? 'yes' : 'no'}`} />
              <Pill label={`confirmed: ${s.human_confirmed ? 'yes' : 'no'}`} />
              {s.added_by_ai ? <Pill label="AI-added" /> : null}
            </View>
          </View>
        ))
      )}

      <Text style={styles.heading}>Distractors ({distractors.length})</Text>
      {distractors.length === 0 ? (
        <Text style={styles.emptyInline}>No distractors yet. Generation lands in Phase 2.6.2.</Text>
      ) : (
        distractors.map((d) => (
          <View key={d.id} style={styles.card}>
            <Text style={styles.kvValue}>{d.distractor_text}</Text>
            <View style={styles.pillRow}>
              <Pill label={d.authored_by} />
              <Pill label={d.is_active ? 'active' : 'inactive'} />
              {d.quality_score !== null ? <Pill label={`quality ${d.quality_score}`} /> : null}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  )
}

function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.lg },
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
  kvKey: { color: colors.textSecondary, fontSize: 12, width: 90 },
  kvValue: { color: colors.textPrimary, fontSize: 13, flex: 1 },
  urlText: { color: colors.purpleLight, fontSize: 11, marginTop: 4 },
  excerptText: { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
  },
  pillText: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
  emptyInline: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md },
  actionRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, marginBottom: spacing.md },
  actionBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  actionDisabled: { opacity: 0.55 },
  actionText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  actionSub: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: { color: colors.textSecondary },
  errorText: { color: colors.danger },
})
