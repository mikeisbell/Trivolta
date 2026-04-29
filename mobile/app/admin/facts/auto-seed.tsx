import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/auth'
import { colors, radius, spacing } from '../../../lib/theme'

type Mode = 'paste' | 'category'

type Category = { id: string; slug: string; display_name: string }

type ImportResult = {
  imported: number
  skipped_non_multiple: number
  skipped_unknown_category: number
  failed: number
  errors: Array<{ row_index: number; message: string }>
}

type SingleResult = {
  fact_id: string
  outcome: string
  confidence: number | null
  reasoning: string | null
  sources_attempted: number
  sources_confirmed: number
  estimated_cost_usd: number
  duration_ms: number
  failure_stage: string | null
  failure_reason: string | null
}

type BatchResult = {
  processed: number
  auto_verified: number
  needs_review: number
  failed: number
  total_input_tokens: number
  total_output_tokens: number
  total_estimated_cost_usd: number
  duration_ms: number
  results: SingleResult[]
}

const ESTIMATED_COST_PER_FACT = 0.02
const CONFIRM_THRESHOLD = 20
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export default function AdminFactsAutoSeedScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [mode, setMode] = useState<Mode>('category')
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [limitText, setLimitText] = useState(String(DEFAULT_LIMIT))
  const [busy, setBusy] = useState(false)
  const [progressNote, setProgressNote] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, display_name')
        .eq('is_active', true)
        .order('display_name', { ascending: true })
      if (cancelled) return
      if (error) {
        setServerError(error.message)
        return
      }
      setCategories(data as Category[])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const parsedLimit = (() => {
    const n = parseInt(limitText, 10)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
    return Math.min(MAX_LIMIT, n)
  })()

  function confirmIfLarge(count: number, estCost: number): boolean {
    if (count <= CONFIRM_THRESHOLD) return true
    const msg =
      `Process ${count} facts with the AI cross-check pipeline?\n\n` +
      `Estimated cost: ~$${estCost.toFixed(2)} USD\n\n` +
      `Click OK to proceed, Cancel to abort.`
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(msg)
    }
    return true
  }

  async function runPasteMode() {
    setParseError(null)
    setServerError(null)
    setImportResult(null)
    setBatchResult(null)

    let parsed: { results?: unknown }
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setParseError(`Invalid JSON: ${(err as Error).message}`)
      return
    }
    const rowsArr = (parsed as { results?: unknown }).results
    if (!Array.isArray(rowsArr)) {
      setParseError('Expected JSON with a top-level "results" array (OpenTrivia DB shape)')
      return
    }
    const expected = rowsArr.length
    const estCost = expected * ESTIMATED_COST_PER_FACT
    if (!confirmIfLarge(expected, estCost)) return

    setBusy(true)
    setProgressNote(`Importing ${expected} facts...`)
    try {
      const importRes = await supabase.functions.invoke<ImportResult>('fact-bank-import', { body: parsed })
      if (importRes.error) {
        setServerError(importRes.error.message)
        return
      }
      const ir = importRes.data
      if (!ir) {
        setServerError('Import returned no data')
        return
      }
      setImportResult(ir)

      if (ir.imported === 0) {
        setProgressNote(null)
        return
      }

      // Look up fact_ids that the current user just imported (created_at within
      // the last 90 seconds, status pending). Bound by ir.imported.
      const since = new Date(Date.now() - 90_000).toISOString()
      const { data: idRows, error: idErr } = await supabase
        .from('facts')
        .select('id')
        .eq('verification_status', 'pending')
        .eq('created_by', user?.id ?? '')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(ir.imported)
      if (idErr) {
        setServerError(`Could not look up imported fact ids: ${idErr.message}`)
        return
      }
      const factIds = (idRows ?? []).map((r) => r.id as string)

      setProgressNote(`Auto-seeding ${factIds.length} facts (this may take a few minutes)...`)
      const batchRes = await supabase.functions.invoke<BatchResult>('fact-bank-batch-seed', {
        body: { fact_ids: factIds },
      })
      if (batchRes.error) {
        setServerError(batchRes.error.message)
        return
      }
      setBatchResult(batchRes.data ?? null)
    } finally {
      setBusy(false)
      setProgressNote(null)
    }
  }

  async function runCategoryMode() {
    setParseError(null)
    setServerError(null)
    setBatchResult(null)
    const estCost = parsedLimit * ESTIMATED_COST_PER_FACT
    if (!confirmIfLarge(parsedLimit, estCost)) return

    setBusy(true)
    setProgressNote(`Auto-seeding up to ${parsedLimit} facts...`)
    try {
      const body: Record<string, unknown> = { limit: parsedLimit }
      if (selectedSlug) body.category_slug = selectedSlug
      const batchRes = await supabase.functions.invoke<BatchResult>('fact-bank-batch-seed', { body })
      if (batchRes.error) {
        setServerError(batchRes.error.message)
        return
      }
      setBatchResult(batchRes.data ?? null)
    } finally {
      setBusy(false)
      setProgressNote(null)
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Auto-seed pipeline</Text>
      <Text style={styles.body}>
        Cite sources via Haiku, mechanically check each URL, then verify with an
        independent Sonnet pass. Facts that pass cross-check (confidence {'≥'} 4)
        flip to verified automatically. Anything else lands in the needs-review queue.
      </Text>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, mode === 'category' && styles.tabActive]}
          onPress={() => setMode('category')}
        >
          <Text style={[styles.tabText, mode === 'category' && styles.tabTextActive]}>Existing pending</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === 'paste' && styles.tabActive]}
          onPress={() => setMode('paste')}
        >
          <Text style={[styles.tabText, mode === 'paste' && styles.tabTextActive]}>Import + auto-seed</Text>
        </TouchableOpacity>
      </View>

      {mode === 'category' ? (
        <View style={styles.formBlock}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, selectedSlug === '' && styles.chipActive]}
              onPress={() => setSelectedSlug('')}
            >
              <Text style={[styles.chipText, selectedSlug === '' && styles.chipTextActive]}>All</Text>
            </TouchableOpacity>
            {(categories ?? []).map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, selectedSlug === c.slug && styles.chipActive]}
                onPress={() => setSelectedSlug(c.slug)}
              >
                <Text style={[styles.chipText, selectedSlug === c.slug && styles.chipTextActive]}>
                  {c.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Limit (max {MAX_LIMIT})</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={limitText}
            onChangeText={setLimitText}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.estCost}>
            Estimated cost: ~${(parsedLimit * ESTIMATED_COST_PER_FACT).toFixed(2)} USD
          </Text>

          <TouchableOpacity
            style={[styles.btn, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={runCategoryMode}
          >
            {busy ? <ActivityIndicator color={colors.textPrimary} /> : (
              <Text style={styles.btnText}>Auto-seed {parsedLimit} facts</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.formBlock}>
          <Text style={styles.label}>OpenTrivia DB JSON</Text>
          <TextInput
            style={styles.textarea}
            multiline
            placeholder='{"results":[{"category":"...","type":"multiple",...}]}'
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {parseError ? <Text style={styles.errorText}>{parseError}</Text> : null}
          <TouchableOpacity
            style={[styles.btn, (busy || !text) && styles.btnDisabled]}
            disabled={busy || !text}
            onPress={runPasteMode}
          >
            {busy ? <ActivityIndicator color={colors.textPrimary} /> : (
              <Text style={styles.btnText}>Import + auto-seed</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {progressNote ? (
        <View style={styles.banner}>
          <ActivityIndicator color={colors.purpleLight} />
          <Text style={styles.bannerText}>{progressNote}</Text>
        </View>
      ) : null}

      {serverError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Server error: {serverError}</Text>
        </View>
      ) : null}

      {importResult ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultHeading}>Import result</Text>
          <Row label="Imported" value={String(importResult.imported)} accent={colors.success} />
          <Row label="Skipped (non-multiple)" value={String(importResult.skipped_non_multiple)} />
          <Row label="Skipped (unknown category)" value={String(importResult.skipped_unknown_category)} />
          <Row label="Failed" value={String(importResult.failed)} accent={importResult.failed > 0 ? colors.danger : undefined} />
        </View>
      ) : null}

      {batchResult ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultHeading}>Batch result</Text>
          <Row label="Processed" value={String(batchResult.processed)} />
          <Row label="Auto-verified" value={String(batchResult.auto_verified)} accent={colors.success} />
          <Row label="Needs review" value={String(batchResult.needs_review)} accent={colors.gold} />
          <Row label="Failed" value={String(batchResult.failed)} accent={batchResult.failed > 0 ? colors.danger : undefined} />
          <Row label="Total cost" value={`$${batchResult.total_estimated_cost_usd.toFixed(4)} USD`} />
          <Row label="Duration" value={`${(batchResult.duration_ms / 1000).toFixed(1)}s`} />

          <View style={styles.linksRow}>
            <TouchableOpacity onPress={() => router.push('/admin/facts/needs-review')}>
              <Text style={styles.linkText}>Open needs-review queue {'→'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/admin/telemetry')}>
              <Text style={styles.linkText}>Open telemetry {'→'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </ScrollView>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={[styles.resultValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
  body: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.lg, lineHeight: 18 },
  tabRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.purple },
  tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: colors.textPrimary },
  formBlock: { marginBottom: spacing.lg },
  label: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.xs, marginTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.purpleDim, borderColor: colors.purpleBorder },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: colors.purpleLight },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  textarea: {
    minHeight: 220,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    color: colors.textPrimary,
    fontFamily: 'Menlo',
    fontSize: 12,
    marginBottom: spacing.md,
    textAlignVertical: 'top',
  },
  estCost: { color: colors.textMuted, fontSize: 11, marginBottom: spacing.sm },
  btn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  banner: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.purpleDim,
    borderColor: colors.purpleBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { color: colors.purpleLight, fontSize: 13 },
  errorBanner: {
    backgroundColor: colors.dangerDim,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorBannerText: { color: colors.danger, fontSize: 12 },
  errorText: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  resultBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  resultHeading: { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  resultLabel: { color: colors.textSecondary, fontSize: 13 },
  resultValue: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  linksRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, flexWrap: 'wrap' },
  linkText: { color: colors.purpleLight, fontWeight: '700', fontSize: 12 },
})
