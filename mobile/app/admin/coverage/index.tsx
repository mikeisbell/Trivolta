import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type Category = { id: string; slug: string; display_name: string }
type CoverageRow = { id: string; slug: string; displayName: string; verified: number; target: number; percent: number }

const TARGET_PER_CATEGORY = 150

export default function AdminCoverageScreen() {
  const [rows, setRows] = useState<CoverageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: cats, error: catErr } = await supabase
        .from('categories')
        .select('id, slug, display_name')
        .eq('is_active', true)
        .order('display_name', { ascending: true })
      if (cancelled) return
      if (catErr) {
        setError(catErr.message)
        return
      }
      const counts = await Promise.all(
        (cats as Category[]).map(async (cat) => {
          const { count, error } = await supabase
            .from('facts')
            .select('id', { count: 'exact', head: true })
            .eq('category_id', cat.id)
            .eq('verification_status', 'verified')
          if (error) throw error
          const verified = count ?? 0
          const percent = Math.min(100, Math.round((verified / TARGET_PER_CATEGORY) * 100))
          return {
            id: cat.id,
            slug: cat.slug,
            displayName: cat.display_name,
            verified,
            target: TARGET_PER_CATEGORY,
            percent,
          }
        }),
      )
      if (cancelled) return
      setRows(counts)
    }
    load().catch((e) => setError((e as Error).message))
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

  const totalVerified = rows.reduce((sum, r) => sum + r.verified, 0)
  const totalTarget = TARGET_PER_CATEGORY * rows.length

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Coverage</Text>
      <Text style={styles.subhead}>
        {totalVerified} / {totalTarget} verified facts ({Math.round((totalVerified / totalTarget) * 100)}%)
      </Text>

      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <View style={styles.headRow}>
            <Text style={styles.catName}>{row.displayName}</Text>
            <Text style={styles.catCount}>
              {row.verified} / {row.target}
            </Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${row.percent}%` }]} />
          </View>
          <Text style={styles.percentText}>{row.percent}%</Text>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: spacing.xs },
  subhead: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  catName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  catCount: { color: colors.textSecondary, fontSize: 12 },
  barTrack: {
    height: 8,
    backgroundColor: colors.surfaceBright,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.purple,
    borderRadius: radius.full,
  },
  percentText: { color: colors.textMuted, fontSize: 11 },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorText: { color: colors.danger },
})
