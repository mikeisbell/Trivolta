import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../../lib/supabase'
import { colors, radius, spacing } from '../../../lib/theme'

type ImportResult = {
  imported: number
  skipped_non_multiple: number
  skipped_unknown_category: number
  failed: number
  errors: Array<{ row_index: number; message: string }>
}

export default function AdminFactsImportScreen() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function handleImport() {
    setParseError(null)
    setServerError(null)
    setResult(null)
    let parsed: { results?: unknown }
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setParseError(`Invalid JSON: ${(err as Error).message}`)
      return
    }
    if (!parsed || !Array.isArray((parsed as { results?: unknown }).results)) {
      setParseError('Expected JSON with a top-level "results" array (OpenTrivia DB shape)')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke<ImportResult>('fact-bank-import', {
        body: parsed,
      })
      if (error) {
        setServerError(error.message)
        return
      }
      setResult(data ?? null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Import OpenTrivia DB JSON</Text>
      <Text style={styles.body}>
        Paste the full {`{ results: [...] }`} response from
        https://opentdb.com/api.php?amount=N&type=multiple. Facts land in pending state.
      </Text>

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
      {serverError ? <Text style={styles.errorText}>Server error: {serverError}</Text> : null}

      <TouchableOpacity
        style={[styles.btn, (busy || !text) && styles.btnDisabled]}
        disabled={busy || !text}
        onPress={handleImport}
      >
        {busy ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.btnText}>Import</Text>}
      </TouchableOpacity>

      {result ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultHeading}>Import result</Text>
          <ResultRow label="Imported" value={result.imported} accent={colors.success} />
          <ResultRow label="Skipped (non-multiple)" value={result.skipped_non_multiple} />
          <ResultRow label="Skipped (unknown category, fell back to general)" value={result.skipped_unknown_category} />
          <ResultRow label="Failed" value={result.failed} accent={result.failed > 0 ? colors.danger : undefined} />
          {result.errors.length > 0 ? (
            <View style={styles.errorListBox}>
              <Text style={styles.errorListHead}>Errors</Text>
              {result.errors.map((e, i) => (
                <Text key={i} style={styles.errorListItem}>
                  row {e.row_index}: {e.message}
                </Text>
              ))}
            </View>
          ) : null}
          <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/admin/facts/queue')}>
            <Text style={styles.linkBtnText}>Open review queue →</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  )
}

function ResultRow({ label, value, accent }: { label: string; value: number; accent?: string }) {
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
  body: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.lg },
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
  btn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  errorText: { color: colors.danger, fontSize: 12, marginBottom: spacing.md },
  resultBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  resultHeading: { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  resultLabel: { color: colors.textSecondary, fontSize: 13 },
  resultValue: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  errorListBox: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerDim,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorListHead: { color: colors.danger, fontWeight: '700', marginBottom: spacing.xs },
  errorListItem: { color: colors.textSecondary, fontSize: 12, fontFamily: 'Menlo' },
  linkBtn: { marginTop: spacing.md, alignItems: 'flex-end' },
  linkBtnText: { color: colors.purpleLight, fontWeight: '700' },
})
