import { useEffect, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type FactRow = {
  id: string
  fact_text: string
  correct_answer: string
  difficulty: number
  verification_status: string
  created_at: string
}

export default function AdminFactsListScreen() {
  return <FactsList filter="all" />
}

export function FactsList({ filter }: { filter: 'all' | 'pending' }) {
  const router = useRouter()
  const [facts, setFacts] = useState<FactRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let query = supabase
        .from('facts')
        .select('id, fact_text, correct_answer, difficulty, verification_status, created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      if (filter === 'pending') {
        query = query.eq('verification_status', 'pending')
      }
      const { data, error } = await query
      if (cancelled) return
      if (error) {
        setError(error.message)
        return
      }
      setFacts(data as FactRow[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [filter])

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    )
  }
  if (!facts) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.purpleLight} />
      </View>
    )
  }
  if (facts.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>
          {filter === 'pending' ? 'Review queue is empty.' : 'No facts yet.'}
        </Text>
        <Text style={styles.emptyDesc}>
          {filter === 'pending'
            ? 'Pending facts will appear here once Phase 2.6.2 imports begin.'
            : 'Use Import to bring in OpenTrivia DB rows or hand-author facts (Phase 2.6.2).'}
        </Text>
        {filter !== 'pending' && (
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/admin/facts/import')}>
            <Text style={styles.emptyBtnText}>Open import</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={facts}
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
          <View style={styles.metaRow}>
            <View style={[styles.pill, statusPillStyle(item.verification_status)]}>
              <Text style={styles.pillText}>{item.verification_status}</Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillText}>difficulty {item.difficulty}</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    />
  )
}

function statusPillStyle(status: string) {
  switch (status) {
    case 'verified':
      return { backgroundColor: colors.successDim }
    case 'pending':
      return { backgroundColor: colors.goldDim }
    case 'rejected':
      return { backgroundColor: colors.dangerDim }
    case 'flagged':
      return { backgroundColor: colors.dangerDim }
    default:
      return { backgroundColor: colors.surfaceBright }
  }
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
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
  },
  pillText: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  emptyDesc: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  emptyBtn: {
    backgroundColor: colors.purple,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  emptyBtnText: { color: colors.textPrimary, fontWeight: '700' },
  errorText: { color: colors.danger },
})
