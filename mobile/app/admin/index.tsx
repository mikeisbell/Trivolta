import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { colors, radius, spacing } from '../../lib/theme'

type Counts = {
  verified: number
  pending: number
  needsReview: number
  openReports: number
}

type AutoSeed24h = {
  total: number
  autoVerified: number
  autoVerifyRate: number | null
}

const NAV_LINKS: Array<{ label: string; href: string; description: string }> = [
  { label: 'All facts', href: '/admin/facts', description: 'Browse, search, and open any fact' },
  { label: 'Review queue', href: '/admin/facts/queue', description: 'Pending facts awaiting verification' },
  { label: 'Needs review', href: '/admin/facts/needs-review', description: 'Facts the AI flagged for human eyes' },
  { label: 'Spot check', href: '/admin/facts/spot-check', description: 'Review random facts for correctness' },
  { label: 'Auto-seed', href: '/admin/facts/auto-seed', description: 'Run the AI-verifies-AI pipeline' },
  { label: 'Import', href: '/admin/facts/import', description: 'Manual OpenTrivia DB import' },
  { label: 'Source citation', href: '/admin/sources/cite', description: 'Manual AI-assisted citing' },
  { label: 'Distractor generation', href: '/admin/distractors/generate', description: 'Manual bulk distractors' },
  { label: 'Reports', href: '/admin/reports', description: 'Player-reported issues' },
  { label: 'Feedback', href: '/admin/feedback', description: 'User-submitted feedback from in-app FAB' },
  { label: 'Coverage', href: '/admin/coverage', description: 'Per-category progress to target' },
  { label: 'Telemetry', href: '/admin/telemetry', description: 'Auto-seed pipeline forensics' },
]

export default function AdminHomeScreen() {
  const router = useRouter()
  const [counts, setCounts] = useState<Counts | null>(null)
  const [auto24h, setAuto24h] = useState<AutoSeed24h | null>(null)
  const [totalCost, setTotalCost] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [verifiedRes, pendingRes, needsReviewRes, reportsRes, recent24hRes, costRes] = await Promise.all([
        supabase.from('facts').select('id', { count: 'exact', head: true }).eq('verification_status', 'verified'),
        supabase.from('facts').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending'),
        supabase.from('facts').select('id', { count: 'exact', head: true }).eq('verification_status', 'needs_review'),
        supabase.from('fact_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase
          .from('fact_auto_seed_log')
          .select('outcome')
          .gte('created_at', since24h),
        supabase
          .from('fact_auto_seed_log')
          .select('estimated_cost_usd'),
      ])
      if (cancelled) return
      const firstError =
        verifiedRes.error || pendingRes.error || needsReviewRes.error ||
        reportsRes.error || recent24hRes.error || costRes.error
      if (firstError) {
        setError(firstError.message)
        return
      }
      setCounts({
        verified: verifiedRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        needsReview: needsReviewRes.count ?? 0,
        openReports: reportsRes.count ?? 0,
      })
      const recent = (recent24hRes.data ?? []) as Array<{ outcome: string }>
      const total = recent.length
      const autoVerified = recent.filter((r) => r.outcome === 'auto_verified').length
      setAuto24h({
        total,
        autoVerified,
        autoVerifyRate: total === 0 ? null : autoVerified / total,
      })
      const allCosts = (costRes.data ?? []) as Array<{ estimated_cost_usd: number | string }>
      setTotalCost(allCosts.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0))
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
        <StatCard label="Needs review" value={counts?.needsReview} accent={colors.gold} />
        <StatCard label="Open reports" value={counts?.openReports} accent={colors.danger} />
      </View>

      <Text style={styles.heading}>Auto-seed</Text>
      <View style={styles.statsRow}>
        <StatCard label="Last 24h runs" value={auto24h?.total} accent={colors.purpleLight} />
        <StatCard
          label="Auto-verify rate (24h)"
          value={auto24h?.autoVerifyRate === null || auto24h?.autoVerifyRate === undefined
            ? undefined
            : Math.round((auto24h!.autoVerifyRate ?? 0) * 100)}
          suffix="%"
          accent={colors.success}
        />
        <StatCard
          label="Total cost"
          value={totalCost === null ? undefined : Number(totalCost.toFixed(4))}
          prefix="$"
          accent={colors.purpleLight}
        />
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

function StatCard({
  label, value, accent, prefix, suffix,
}: {
  label: string
  value: number | undefined
  accent: string
  prefix?: string
  suffix?: string
}) {
  return (
    <View style={[styles.statCard, { borderColor: accent }]}>
      <Text style={styles.statLabel}>{label}</Text>
      {value === undefined ? (
        <ActivityIndicator color={colors.purpleLight} />
      ) : (
        <Text style={[styles.statValue, { color: accent }]}>
          {prefix ?? ''}{value}{suffix ?? ''}
        </Text>
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
  statValue: { fontSize: 24, fontWeight: '800' },
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
