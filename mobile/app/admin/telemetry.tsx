import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { colors, radius, spacing } from '../../lib/theme'

type LogRow = {
  id: string
  fact_id: string
  outcome: string
  failure_stage: string | null
  cross_check_confidence: number | null
  estimated_cost_usd: number | string
  created_at: string
  total_input_tokens: number
  total_output_tokens: number
}

type SourceRow = {
  url: string
  excerpt_match: boolean
  created_at: string
}

type FactPreview = {
  id: string
  fact_text: string
}

type LatestRun = LogRow & { fact_text: string }

const WINDOWS: Array<{ key: '24h' | '7d' | 'all'; label: string; ms: number | null }> = [
  { key: '24h', label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: 'Last 7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: 'All time', ms: null },
]

export default function AdminTelemetryScreen() {
  const router = useRouter()
  const [logs, setLogs] = useState<LogRow[] | null>(null)
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  const [latestRuns, setLatestRuns] = useState<LatestRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [logsRes, sourcesRes] = await Promise.all([
        supabase
          .from('fact_auto_seed_log')
          .select('id, fact_id, outcome, failure_stage, cross_check_confidence, estimated_cost_usd, created_at, total_input_tokens, total_output_tokens')
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase
          .from('fact_auto_seed_sources')
          .select('url, excerpt_match, created_at')
          .order('created_at', { ascending: false })
          .limit(2000),
      ])
      if (cancelled) return
      if (logsRes.error || sourcesRes.error) {
        setError(logsRes.error?.message || sourcesRes.error?.message || 'Unknown error')
        return
      }
      const logRows = (logsRes.data ?? []) as LogRow[]
      setLogs(logRows)
      setSources((sourcesRes.data ?? []) as SourceRow[])

      const latestIds = logRows.slice(0, 50).map((r) => r.fact_id)
      if (latestIds.length > 0) {
        const { data: facts, error: factsErr } = await supabase
          .from('facts')
          .select('id, fact_text')
          .in('id', latestIds)
        if (cancelled) return
        if (factsErr) {
          setError(factsErr.message)
          return
        }
        const map = new Map<string, string>()
        for (const f of (facts ?? []) as FactPreview[]) {
          map.set(f.id, f.fact_text)
        }
        setLatestRuns(logRows.slice(0, 50).map((r) => ({ ...r, fact_text: map.get(r.fact_id) ?? '(deleted)' })))
      } else {
        setLatestRuns([])
      }
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
  if (!logs || !sources || !latestRuns) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.purpleLight} />
      </View>
    )
  }

  const now = Date.now()
  const aggregatesByWindow = WINDOWS.map((w) => {
    const filtered = w.ms === null
      ? logs
      : logs.filter((r) => now - new Date(r.created_at).getTime() <= w.ms!)
    const counts: Record<string, number> = {}
    for (const r of filtered) {
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1
    }
    return { ...w, counts, total: filtered.length }
  })

  const autoVerifiedConfidences = logs
    .filter((r) => r.outcome === 'auto_verified' && r.cross_check_confidence !== null)
    .map((r) => r.cross_check_confidence as number)
  const needsReviewConfidences = logs
    .filter((r) => r.outcome === 'needs_review' && r.cross_check_confidence !== null)
    .map((r) => r.cross_check_confidence as number)
  const avgAutoConf = average(autoVerifiedConfidences)
  const avgNeedsConf = average(needsReviewConfidences)

  const totalCost = logs.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0)
  const avgPerFact = logs.length > 0 ? totalCost / logs.length : 0
  const autoVerifiedCount = logs.filter((r) => r.outcome === 'auto_verified').length
  const needsReviewCount = logs.filter((r) => r.outcome === 'needs_review').length
  const autoCost = logs.filter((r) => r.outcome === 'auto_verified').reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0)
  const needsCost = logs.filter((r) => r.outcome === 'needs_review').reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0)
  const avgPerAuto = autoVerifiedCount > 0 ? autoCost / autoVerifiedCount : 0
  const avgPerNeeds = needsReviewCount > 0 ? needsCost / needsReviewCount : 0

  const failingHostCounts = new Map<string, number>()
  for (const s of sources) {
    if (s.excerpt_match) continue
    const host = extractHost(s.url) || '(unparseable)'
    failingHostCounts.set(host, (failingHostCounts.get(host) ?? 0) + 1)
  }
  const topFailingHosts = Array.from(failingHostCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const failureStageCounts: Record<string, number> = {}
  for (const r of logs) {
    if (!r.failure_stage) continue
    failureStageCounts[r.failure_stage] = (failureStageCounts[r.failure_stage] ?? 0) + 1
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Auto-seed telemetry</Text>

      <Text style={styles.subheading}>Outcome counts</Text>
      <View style={styles.gridRow}>
        {aggregatesByWindow.map((w) => (
          <View key={w.key} style={styles.statCard}>
            <Text style={styles.statLabel}>{w.label}</Text>
            <Text style={styles.statValueSmall}>{w.total} runs</Text>
            <Text style={styles.statSub}>auto-verified: {w.counts.auto_verified ?? 0}</Text>
            <Text style={styles.statSub}>needs-review: {w.counts.needs_review ?? 0}</Text>
            <Text style={styles.statSub}>failed: {w.counts.failed ?? 0}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.subheading}>Cross-check confidence</Text>
      <View style={styles.gridRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Auto-verified avg</Text>
          <Text style={[styles.statValue, { color: colors.success }]}>
            {avgAutoConf === null ? '—' : avgAutoConf.toFixed(2)}
          </Text>
          <Text style={styles.statSub}>target: {'≥'} 4.0</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Needs-review avg</Text>
          <Text style={[styles.statValue, { color: colors.gold }]}>
            {avgNeedsConf === null ? '—' : avgNeedsConf.toFixed(2)}
          </Text>
          <Text style={styles.statSub}>target: {'<'} 4.0</Text>
        </View>
      </View>

      <Text style={styles.subheading}>Cost</Text>
      <View style={styles.gridRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total to date</Text>
          <Text style={styles.statValue}>${totalCost.toFixed(4)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Avg per fact</Text>
          <Text style={styles.statValueSmall}>${avgPerFact.toFixed(4)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Avg per auto-verified</Text>
          <Text style={styles.statValueSmall}>${avgPerAuto.toFixed(4)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Avg per needs-review</Text>
          <Text style={styles.statValueSmall}>${avgPerNeeds.toFixed(4)}</Text>
        </View>
      </View>

      <Text style={styles.subheading}>Top failing source domains</Text>
      {topFailingHosts.length === 0 ? (
        <Text style={styles.emptyInline}>No failed mechanical checks logged yet.</Text>
      ) : (
        <View style={styles.tableBox}>
          {topFailingHosts.map(([host, count]) => (
            <View key={host} style={styles.tableRow}>
              <Text style={styles.tableCellHost} numberOfLines={1}>{host}</Text>
              <Text style={styles.tableCellNum}>{count}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.subheading}>Failure-stage distribution</Text>
      {Object.keys(failureStageCounts).length === 0 ? (
        <Text style={styles.emptyInline}>No failures yet.</Text>
      ) : (
        <View style={styles.tableBox}>
          {Object.entries(failureStageCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([stage, count]) => (
              <View key={stage} style={styles.tableRow}>
                <Text style={styles.tableCellHost}>{stage}</Text>
                <Text style={styles.tableCellNum}>{count}</Text>
              </View>
            ))}
        </View>
      )}

      <Text style={styles.subheading}>Latest 50 runs</Text>
      {latestRuns.length === 0 ? (
        <Text style={styles.emptyInline}>No runs yet.</Text>
      ) : (
        <View style={styles.tableBox}>
          {latestRuns.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.runRow}
              onPress={() => router.push(`/admin/facts/${r.fact_id}` as never)}
            >
              <Text style={styles.runTime}>{new Date(r.created_at).toLocaleString()}</Text>
              <Text style={styles.runFact} numberOfLines={1}>{r.fact_text.slice(0, 80)}</Text>
              <View style={styles.runMeta}>
                <Pill label={r.outcome} accent={outcomeColor(r.outcome)} />
                {r.cross_check_confidence !== null ? <Pill label={`conf ${r.cross_check_confidence}`} /> : null}
                <Pill label={`$${Number(r.estimated_cost_usd ?? 0).toFixed(4)}`} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

function average(arr: number[]): number | null {
  if (arr.length === 0) return null
  return arr.reduce((s, n) => s + n, 0) / arr.length
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function outcomeColor(outcome: string): string {
  switch (outcome) {
    case 'auto_verified': return colors.success
    case 'needs_review': return colors.gold
    case 'failed': return colors.danger
    default: return colors.textSecondary
  }
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
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: spacing.lg },
  subheading: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: {
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  statLabel: { color: colors.textSecondary, fontSize: 11, marginBottom: spacing.xs },
  statValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  statValueSmall: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  statSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tableBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  tableCellHost: { flex: 1, color: colors.textPrimary, fontSize: 12 },
  tableCellNum: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  runRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  runTime: { color: colors.textMuted, fontSize: 10, marginBottom: 2 },
  runFact: { color: colors.textPrimary, fontSize: 12, marginBottom: 4 },
  runMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
    borderColor: colors.border,
    borderWidth: 1,
  },
  pillText: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
  emptyInline: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorText: { color: colors.danger },
})
