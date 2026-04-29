import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { colors, radius, spacing } from '../../lib/theme'

type Counts = { verified: number; pending: number; openReports: number }

const NAV_LINKS: Array<{ label: string; href: string; description: string }> = [
  { label: 'All facts', href: '/admin/facts', description: 'Browse, search, and open any fact' },
  { label: 'Review queue', href: '/admin/facts/queue', description: 'Pending facts awaiting verification' },
  { label: 'Import', href: '/admin/facts/import', description: 'Bulk upload (Phase 2.6.2)' },
  { label: 'Source citation', href: '/admin/sources/cite', description: 'AI-assisted citing (Phase 2.6.2)' },
  { label: 'Distractor generation', href: '/admin/distractors/generate', description: 'Bulk distractors (Phase 2.6.2)' },
  { label: 'Reports', href: '/admin/reports', description: 'Player-reported issues' },
  { label: 'Coverage', href: '/admin/coverage', description: 'Per-category progress to target' },
]

export default function AdminHomeScreen() {
  const router = useRouter()
  const [counts, setCounts] = useState<Counts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [verifiedRes, pendingRes, reportsRes] = await Promise.all([
        supabase.from('facts').select('id', { count: 'exact', head: true }).eq('verification_status', 'verified'),
        supabase.from('facts').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending'),
        supabase.from('fact_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      ])
      if (cancelled) return
      const firstError = verifiedRes.error || pendingRes.error || reportsRes.error
      if (firstError) {
        setError(firstError.message)
        return
      }
      setCounts({
        verified: verifiedRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        openReports: reportsRes.count ?? 0,
      })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Fact bank</Text>
      <View style={styles.statsRow}>
        <StatCard label="Verified" value={counts?.verified} accent={colors.success} />
        <StatCard label="Pending" value={counts?.pending} accent={colors.gold} />
        <StatCard label="Open reports" value={counts?.openReports} accent={colors.danger} />
      </View>
      {error ? <Text style={styles.errorText}>Error loading counts: {error}</Text> : null}

      <Text style={styles.heading}>Navigate</Text>
      <View style={styles.linksWrap}>
        {NAV_LINKS.map((link) => (
          <TouchableOpacity
            key={link.href}
            style={styles.linkRow}
            onPress={() => router.push(link.href as never)}
          >
            <Text style={styles.linkLabel}>{link.label}</Text>
            <Text style={styles.linkDesc}>{link.description}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number | undefined; accent: string }) {
  return (
    <View style={[styles.statCard, { borderColor: accent }]}>
      <Text style={styles.statLabel}>{label}</Text>
      {value === undefined ? (
        <ActivityIndicator color={colors.purpleLight} />
      ) : (
        <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl },
  heading: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
    flexWrap: 'wrap',
  },
  statCard: {
    flexGrow: 1,
    minWidth: 120,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  statLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.xs },
  statValue: { fontSize: 28, fontWeight: '800' },
  linksWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  linkRow: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  linkLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  linkDesc: { color: colors.textSecondary, fontSize: 12 },
  errorText: { color: colors.danger, marginBottom: spacing.lg },
})
