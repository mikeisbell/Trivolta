import { useState } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  SafeAreaView, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { colors, radius, spacing } from '../../lib/theme'
import { createLobby } from '../../lib/api'

const CATEGORIES = [
  { id: 'science',     label: 'Science',     emoji: '🔬' },
  { id: 'pop_culture', label: 'Pop culture', emoji: '🎬' },
  { id: 'history',     label: 'History',     emoji: '🏛️' },
  { id: 'custom',      label: 'Any topic',   emoji: '✨' },
] as const

type CategoryId = typeof CATEGORIES[number]['id']

export default function CreateLobbyScreen() {
  const router = useRouter()
  const [selected, setSelected] = useState<CategoryId | null>(null)
  const [customText, setCustomText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const effectiveCategory =
    selected === 'custom'
      ? customText.trim()
      : selected
        ? CATEGORIES.find(c => c.id === selected)!.label
        : ''

  const canCreate = effectiveCategory.length > 0

  async function handleCreate() {
    if (!canCreate) return
    setLoading(true)
    setError('')
    try {
      const { lobby } = await createLobby(effectiveCategory)
      router.push({ pathname: '/lobby/waiting', params: { lobbyId: lobby.id, isHost: '1' } })
    } catch (err: any) {
      setError(err.message ?? 'Failed to create lobby')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <TouchableOpacity testID="create-lobby-back" onPress={() => router.back()} style={styles.back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Create a lobby</Text>
          <Text style={styles.sub}>Pick a category for your game. All players answer the same questions.</Text>

          {/* Category grid */}
          <View style={styles.grid}>
            {CATEGORIES.map((cat) => {
              const isSelected = selected === cat.id
              const isCustom = cat.id === 'custom'
              return (
                <TouchableOpacity
                  key={cat.id}
                  testID={`create-lobby-category-${cat.id}`}
                  style={[
                    styles.catCard,
                    isSelected && styles.catCardSelected,
                    isCustom && styles.catCardCustom,
                    isCustom && isSelected && styles.catCardCustomSelected,
                  ]}
                  activeOpacity={0.8}
                  onPress={() => {
                    setSelected(cat.id)
                    setError('')
                  }}
                >
                  <Text style={styles.catEmoji}>{cat.emoji}</Text>
                  <Text style={[styles.catLabel, isSelected && styles.catLabelSelected]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Custom topic input — only shown when 'Any topic' is selected */}
          {selected === 'custom' && (
            <TextInput
              testID="create-lobby-custom-input"
              style={styles.customInput}
              placeholder="e.g. 90s video games, marine biology…"
              placeholderTextColor={colors.textMuted}
              value={customText}
              onChangeText={t => { setCustomText(t); setError('') }}
              autoFocus
              returnKeyType="done"
              maxLength={60}
            />
          )}

          {/* Error */}
          {error !== '' && (
            <Text testID="create-lobby-error" style={styles.errorText}>{error}</Text>
          )}

          {/* Create button */}
          <TouchableOpacity
            testID="create-lobby-submit"
            style={[styles.createBtn, !canCreate && styles.createBtnDisabled]}
            activeOpacity={canCreate ? 0.85 : 1}
            onPress={handleCreate}
            disabled={!canCreate || loading}
          >
            {loading
              ? <ActivityIndicator color={colors.textPrimary} />
              : <Text style={styles.createBtnText}>Create lobby</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: 40,
  },
  back: { marginBottom: spacing.xl },
  backText: { fontSize: 14, color: colors.purpleLight, fontWeight: '600' },

  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sub: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.xxl,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  catCard: {
    width: '47.5%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  catCardSelected: {
    borderColor: colors.purple,
    backgroundColor: colors.purpleDim,
  },
  catCardCustom: {
    borderColor: colors.purpleBorder,
    backgroundColor: colors.purpleDim,
  },
  catCardCustomSelected: {
    borderColor: colors.purple,
  },
  catEmoji: { fontSize: 22, marginBottom: spacing.sm },
  catLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  catLabelSelected: { color: colors.purplePale },

  customInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.purpleBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },

  errorText: {
    fontSize: 13,
    color: colors.danger,
    marginBottom: spacing.md,
    textAlign: 'center',
  },

  createBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  createBtnDisabled: {
    opacity: 0.35,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
})
