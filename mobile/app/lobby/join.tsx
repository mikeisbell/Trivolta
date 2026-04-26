import { useRef, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, NativeSyntheticEvent, TextInputKeyPressEventData,
} from 'react-native'
import { useRouter } from 'expo-router'
import { colors, radius, spacing } from '../../lib/theme'
import { joinLobby } from '../../lib/api'

const CODE_LENGTH = 4

export default function JoinLobbyScreen() {
  const router = useRouter()
  const [chars, setChars] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRefs = useRef<(TextInput | null)[]>([])

  const code = chars.join('')
  const canJoin = code.length === CODE_LENGTH && chars.every(c => c !== '')

  function handleChange(text: string, index: number) {
    const char = text.toUpperCase().slice(-1)
    const next = [...chars]
    next[index] = char
    setChars(next)
    setError('')
    if (char && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) {
    if (e.nativeEvent.key === 'Backspace' && chars[index] === '' && index > 0) {
      const next = [...chars]
      next[index - 1] = ''
      setChars(next)
      inputRefs.current[index - 1]?.focus()
    }
  }

  async function handleJoin() {
    if (!canJoin) return
    setLoading(true)
    setError('')
    try {
      const { lobby } = await joinLobby(code)
      router.push({ pathname: '/lobby/waiting', params: { lobbyId: lobby.id, isHost: '0' } })
    } catch (err: any) {
      setError(err.message ?? 'Failed to join lobby')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        {/* Header */}
        <TouchableOpacity testID="join-lobby-back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Join a lobby</Text>
        <Text style={styles.sub}>Enter the 4-character room code from your host.</Text>

        {/* Code boxes */}
        <View testID="join-lobby-code-input" style={styles.codeRow}>
          {chars.map((char, i) => (
            <TextInput
              key={i}
              ref={el => { inputRefs.current[i] = el }}
              testID={`join-lobby-code-box-${i}`}
              style={[styles.codeBox, char !== '' && styles.codeBoxFilled]}
              value={char}
              onChangeText={t => handleChange(t, i)}
              onKeyPress={e => handleKeyPress(e, i)}
              maxLength={1}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              returnKeyType={i === CODE_LENGTH - 1 ? 'done' : 'next'}
              onSubmitEditing={() => {
                if (i < CODE_LENGTH - 1) inputRefs.current[i + 1]?.focus()
                else if (canJoin) handleJoin()
              }}
            />
          ))}
        </View>

        {/* Error */}
        {error !== '' && (
          <Text testID="join-lobby-error" style={styles.errorText}>{error}</Text>
        )}

        {/* Join button */}
        <TouchableOpacity
          testID="join-lobby-submit"
          style={[styles.joinBtn, !canJoin && styles.joinBtnDisabled]}
          activeOpacity={canJoin ? 0.85 : 1}
          onPress={handleJoin}
          disabled={!canJoin || loading}
        >
          {loading
            ? <ActivityIndicator color={colors.textPrimary} />
            : <Text style={styles.joinBtnText}>Join lobby</Text>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
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
    marginBottom: 40,
  },

  codeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    marginBottom: 32,
  },
  codeBox: {
    width: 60,
    height: 72,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  codeBoxFilled: {
    borderColor: colors.purple,
    backgroundColor: colors.purpleDim,
  },

  errorText: {
    fontSize: 13,
    color: colors.danger,
    marginBottom: spacing.md,
    textAlign: 'center',
  },

  joinBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinBtnDisabled: { opacity: 0.35 },
  joinBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
})
