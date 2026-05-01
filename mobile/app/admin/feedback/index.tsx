import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type FeedbackRow = {
  id: string
  user_id: string | null
  screen: string
  route_path: string | null
  body: string
  state_snapshot: Record<string, unknown> | null
  app_version: string | null
  platform: 'ios' | 'android' | 'web'
  created_at: string
}

const PREVIEW_MAX = 200

function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(1, Math.round((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

export default function AdminFeedbackScreen() {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('feedback_reports')
        .select('id, user_id, screen, route_path, body, state_snapshot, app_version, platform, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (cancelled) return
      if (error) {
        setError(error.message)
        return
      }
      setRows((data as FeedbackRow[]) ?? [])
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
        <Text style={styles.emptyTitle}>No feedback yet.</Text>
        <Text style={styles.emptyDesc}>Submitted feedback from the in-app FAB will appear here.</Text>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={rows}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => {
        const isOpen = !!expanded[item.id]
        const truncated = item.body.length > PREVIEW_MAX
        const preview = truncated ? item.body.slice(0, PREVIEW_MAX) + '…' : item.body
        return (
          <View style={styles.row}>
            <View style={styles.headRow}>
              <Text style={styles.timeText}>{relTime(item.created_at)}</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>{item.screen}</Text>
              </View>
            </View>
            <Text style={styles.body}>{isOpen ? item.body : preview}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {item.platform}
                {item.app_version ? ` · v${item.app_version}` : ''}
                {item.user_id ? ` · ${item.user_id.slice(0, 8)}…` : ' · (deleted user)'}
              </Text>
              <TouchableOpacity
                onPress={() => setExpanded((m) => ({ ...m, [item.id]: !m[item.id] }))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.expandText}>{isOpen ? '▾ Collapse' : '▸ Expand'}</Text>
              </TouchableOpacity>
            </View>
            {isOpen && item.state_snapshot ? (
              <View style={styles.snapshotBlock}>
                <Text style={styles.snapshotLabel}>state_snapshot</Text>
                <Text style={styles.snapshotJson}>
                  {JSON.stringify(item.state_snapshot, null, 2)}
                </Text>
              </View>
            ) : null}
            {isOpen && !item.state_snapshot ? (
              <Text style={styles.snapshotEmpty}>state_snapshot: (omitted)</Text>
            ) : null}
          </View>
        )
      }}
    />
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
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  timeText: { color: colors.textSecondary, fontSize: 12 },
  pill: {
    backgroundColor: colors.purpleDim,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  pillText: { color: colors.purplePale, fontSize: 11, fontWeight: '600' },
  body: { color: colors.textPrimary, fontSize: 14, marginBottom: spacing.sm },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaText: { color: colors.textMuted, fontSize: 11 },
  expandText: { color: colors.purpleLight, fontSize: 12, fontWeight: '600' },
  snapshotBlock: {
    marginTop: spacing.md,
    backgroundColor: colors.backgroundDeep,
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  snapshotLabel: { color: colors.textMuted, fontSize: 10, marginBottom: spacing.xs },
  snapshotJson: { color: colors.textPrimary, fontSize: 11, fontFamily: 'Courier' },
  snapshotEmpty: { color: colors.textMuted, fontSize: 11, marginTop: spacing.md },
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
