import { useEffect, useState } from 'react'
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type Report = {
  id: string
  fact_id: string
  reason: string
  detail: string | null
  status: string
  created_at: string
}

export default function AdminReportsScreen() {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('fact_reports')
        .select('id, fact_id, reason, detail, status, created_at')
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        setError(error.message)
        return
      }
      setReports((data as Report[]) ?? [])
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
  if (!reports) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.purpleLight} />
      </View>
    )
  }
  if (reports.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No reports yet.</Text>
        <Text style={styles.emptyDesc}>
          Player-reported issues will land here once the in-game report flow ships in Phase 2.6.5.
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={reports}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.headRow}>
            <Text style={styles.reason}>{item.reason}</Text>
            <View style={[styles.pill, statusStyle(item.status)]}>
              <Text style={styles.pillText}>{item.status}</Text>
            </View>
          </View>
          <Text style={styles.detail}>{item.detail ?? '—'}</Text>
          <Text style={styles.factRef}>fact_id: {item.fact_id.slice(0, 8)}…</Text>
        </View>
      )}
    />
  )
}

function statusStyle(status: string) {
  switch (status) {
    case 'open':
      return { backgroundColor: colors.goldDim }
    case 'resolved':
      return { backgroundColor: colors.successDim }
    case 'dismissed':
      return { backgroundColor: colors.surfaceBright }
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
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  reason: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  detail: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.xs },
  factRef: { color: colors.textMuted, fontSize: 10 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  pillText: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
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
