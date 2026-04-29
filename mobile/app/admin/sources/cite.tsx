import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
} from 'react-native'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type PendingFact = {
  id: string
  fact_text: string
  correct_answer: string
  category_id: string
  confirmed_count: number
}

type Candidate = {
  url: string
  source_type: string
  excerpt: string
  verified_reachable: boolean
  excerpt_match: boolean
  status_code: number | null
  error: string | null
}

export default function AdminSourcesCiteScreen() {
  const [fact, setFact] = useState<PendingFact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [proposing, setProposing] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [proposalError, setProposalError] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const [crossRefBanner, setCrossRefBanner] = useState(false)

  const loadNext = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCandidates(null)
    setProposalError(null)
    setCrossRefBanner(false)
    const { data, error } = await supabase
      .from('facts')
      .select('id, fact_text, correct_answer, category_id, fact_sources(human_confirmed)')
      .eq('verification_status', 'pending')
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
      category_id: string
      fact_sources: Array<{ human_confirmed: boolean | null }> | null
    }
    const eligible = ((data ?? []) as Row[])
      .map((r) => ({
        id: r.id,
        fact_text: r.fact_text,
        correct_answer: r.correct_answer,
        category_id: r.category_id,
        confirmed_count: (r.fact_sources ?? []).filter((s) => s.human_confirmed === true).length,
      }))
      .find((r) => r.confirmed_count < 2)
    setFact(eligible ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadNext()
  }, [loadNext])

  async function getProposals() {
    if (!fact) return
    setProposing(true)
    setProposalError(null)
    setCandidates(null)
    try {
      const { data, error } = await supabase.functions.invoke<{ candidates: Candidate[]; error?: string }>(
        'fact-bank-validate-source',
        { body: { fact_id: fact.id } },
      )
      if (error) {
        setProposalError(error.message)
        return
      }
      if (data?.error) {
        setProposalError(data.error)
        setCandidates([])
        return
      }
      setCandidates(data?.candidates ?? [])
    } finally {
      setProposing(false)
    }
  }

  async function approveCandidate(c: Candidate) {
    if (!fact) return
    setApproving(c.url)
    try {
      const { error } = await supabase.from('fact_sources').insert({
        fact_id: fact.id,
        url: c.url,
        citation: c.url,
        excerpt: c.excerpt,
        source_type: c.source_type,
        verified_reachable: true,
        verified_at: new Date().toISOString(),
        added_by_ai: true,
        human_confirmed: true,
      })
      if (error) {
        setProposalError(error.message)
        return
      }
      const newCount = fact.confirmed_count + 1
      setFact({ ...fact, confirmed_count: newCount })
      if (newCount >= 2) setCrossRefBanner(true)
      setCandidates((prev) => prev?.filter((x) => x.url !== c.url) ?? null)
    } finally {
      setApproving(null)
    }
  }

  if (loading) return <Center><ActivityIndicator color={colors.purpleLight} /></Center>
  if (error) return <Center><Text style={styles.errorText}>Error: {error}</Text></Center>
  if (!fact) {
    return (
      <Center>
        <Text style={styles.emptyTitle}>No pending facts need sources.</Text>
        <Text style={styles.emptyDesc}>The queue is clear. Import more or come back after seeding.</Text>
      </Center>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {crossRefBanner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            This fact now has 2 confirmed sources. Open it in /admin/facts/{`{id}`} and click Approve to flip to verified.
          </Text>
        </View>
      ) : null}

      <Text style={styles.heading}>Fact</Text>
      <View style={styles.card}>
        <Text style={styles.factText}>{fact.fact_text}</Text>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Answer</Text><Text style={styles.kvValue}>{fact.correct_answer}</Text></View>
        <View style={styles.kvRow}><Text style={styles.kvKey}>Confirmed sources</Text><Text style={styles.kvValue}>{fact.confirmed_count} / 2</Text></View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.btn, proposing && styles.btnDisabled]}
          disabled={proposing}
          onPress={getProposals}
        >
          {proposing ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.btnText}>Get AI source proposals</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={loadNext}>
          <Text style={styles.btnSecondaryText}>Skip this fact</Text>
        </TouchableOpacity>
      </View>

      {proposalError ? <Text style={styles.errorText}>{proposalError}</Text> : null}

      {candidates && candidates.length === 0 ? (
        <Text style={styles.emptyDesc}>No candidates returned. Try again or skip.</Text>
      ) : null}

      {candidates?.map((c, i) => {
        const blocked = !c.verified_reachable || !c.excerpt_match
        return (
          <View key={`${c.url}-${i}`} style={styles.card}>
            <TouchableOpacity onPress={() => Linking.openURL(c.url)}>
              <Text style={styles.urlText} numberOfLines={2}>{c.url}</Text>
            </TouchableOpacity>
            <Text style={styles.excerptText}>"{c.excerpt}"</Text>
            <View style={styles.pillRow}>
              <Pill label={c.source_type} />
              <Pill label={`reachable: ${c.verified_reachable ? 'yes' : 'no'}`} accent={c.verified_reachable ? colors.success : colors.danger} />
              <Pill label={`excerpt match: ${c.excerpt_match ? 'yes' : 'no'}`} accent={c.excerpt_match ? colors.success : colors.danger} />
              {c.status_code !== null ? <Pill label={`HTTP ${c.status_code}`} /> : null}
            </View>
            {c.error ? <Text style={styles.errorText}>fetch error: {c.error}</Text> : null}
            <TouchableOpacity
              style={[styles.btnSmall, blocked && styles.btnDisabled]}
              disabled={blocked || approving === c.url}
              onPress={() => approveCandidate(c)}
            >
              {approving === c.url ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text style={styles.btnText}>{blocked ? 'Mechanical check failed' : 'Approve'}</Text>
              )}
            </TouchableOpacity>
          </View>
        )
      })}
    </ScrollView>
  )
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
  btnSmall: {
    marginTop: spacing.md,
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  urlText: { color: colors.purpleLight, fontSize: 12, marginBottom: 6 },
  excerptText: { color: colors.textSecondary, fontStyle: 'italic', fontSize: 12, marginBottom: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
    borderColor: colors.border,
    borderWidth: 1,
  },
  pillText: { color: colors.textPrimary, fontSize: 10, fontWeight: '600' },
  errorText: { color: colors.danger, fontSize: 12 },
  banner: {
    backgroundColor: colors.successDim,
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { color: colors.success, fontSize: 12 },
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
