# INSTRUCTIONS_LOBBY_CREATE_JOIN.md

## Task

Build the lobby creation and join flows: a new `join-lobby` Edge Function, the Play tab as a lobby hub, CreateLobbyScreen with a category picker, and JoinLobbyScreen with a 4-character room code input. On success both screens navigate to `/lobby/waiting` — which remains a stub.

---

## Verifiable objective

- [ ] `supabase/functions/join-lobby/index.ts` exists and is valid TypeScript
- [ ] Joining a lobby that doesn't exist returns HTTP 404
- [ ] Joining a full lobby (8 players) returns HTTP 400
- [ ] `mobile/app/(tabs)/play.tsx` renders two buttons: "Create a lobby" and "Join a lobby"
- [ ] Tapping "Create a lobby" navigates to `/lobby/create`
- [ ] Tapping "Join a lobby" navigates to `/lobby/join`
- [ ] `mobile/app/lobby/create.tsx` renders a 2×2 category grid matching HomeScreen categories
- [ ] Tapping Science, Pop Culture, or History on CreateLobbyScreen selects it (highlighted state)
- [ ] Tapping "Any topic" on CreateLobbyScreen reveals a TextInput beneath the grid
- [ ] "Create lobby" button on CreateLobbyScreen is disabled until a category is selected (or custom text entered)
- [ ] Tapping "Create lobby" calls `createLobby(category)` and navigates to `/lobby/waiting?lobbyId=X&isHost=1`
- [ ] `mobile/app/lobby/join.tsx` renders four individual character boxes for the room code
- [ ] Each box auto-advances focus to the next on character entry
- [ ] "Join" button on JoinLobbyScreen is disabled until all 4 boxes are filled
- [ ] Tapping "Join" calls `joinLobby(code)` and navigates to `/lobby/waiting?lobbyId=X&isHost=0`
- [ ] API errors on both screens display an inline error message (not a native alert)
- [ ] `npx tsc --noEmit` passes with zero errors

---

## Constraints

- Do NOT modify `app/lobby/waiting.tsx`, `app/lobby/game.tsx`, `app/lobby/results.tsx`
- Do NOT add `start-game` or `submit-answer` Edge Functions — those are a future INSTRUCTIONS file
- Do NOT use `Alert.alert` for errors — render error text inline in the UI
- Do NOT shuffle or transform the category string — pass it as-is to the Edge Function
- `isHost` must be passed as the string `'1'` or `'0'` (Expo Router params are always strings)
- The `join-lobby` function must use `SUPABASE_ANON_KEY` with the user's auth header (not service role)
- Category grid on CreateLobbyScreen must use the same 4 entries as HomeScreen: Science, Pop Culture, History, Any topic — with the same emojis
- Do NOT add any new columns to the database schema
- Do NOT create a new migration file

---

## Steps

### 1. Edge Function — `join-lobby`

Create `supabase/functions/join-lobby/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: corsHeaders,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: corsHeaders,
      })
    }

    const { code } = await req.json()
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'code required' }), {
        status: 400, headers: corsHeaders,
      })
    }

    // Look up lobby by code, must be in 'waiting' state
    const { data: lobby, error: lobbyError } = await supabase
      .from('lobbies')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('status', 'waiting')
      .single()

    if (lobbyError || !lobby) {
      return new Response(JSON.stringify({ error: 'Lobby not found or already started' }), {
        status: 404, headers: corsHeaders,
      })
    }

    // Count current players
    const { count, error: countError } = await supabase
      .from('lobby_players')
      .select('*', { count: 'exact', head: true })
      .eq('lobby_id', lobby.id)

    if (countError) throw countError

    if ((count ?? 0) >= lobby.max_players) {
      return new Response(JSON.stringify({ error: 'Lobby is full' }), {
        status: 400, headers: corsHeaders,
      })
    }

    // Insert player — ignore if already joined (idempotent)
    const { error: insertError } = await supabase
      .from('lobby_players')
      .insert({ lobby_id: lobby.id, user_id: user.id })

    if (insertError && !insertError.message.includes('duplicate')) {
      throw insertError
    }

    return new Response(JSON.stringify({ lobby }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

### 2. Add `joinLobby` to `mobile/lib/api.ts`

Append after the `generateLobbyQuestions` function:

```typescript
export async function joinLobby(code: string) {
  const res = await callFunction('join-lobby', { code })
  if (!res.ok) {
    const body = await res.json()
    throw new Error(body.error ?? `Join lobby failed: ${res.status}`)
  }
  return res.json()
}
```

### 3. Play tab — `mobile/app/(tabs)/play.tsx`

Replace the entire file:

```tsx
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { useRouter } from 'expo-router'
import { colors, radius, spacing } from '../../lib/theme'

export default function PlayScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="play-screen" style={styles.root}>
        <Text style={styles.title}>Play with friends</Text>
        <Text style={styles.sub}>Create a lobby and invite up to 7 friends, or join one with a room code.</Text>

        <TouchableOpacity
          testID="play-create-lobby"
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/lobby/create')}
        >
          <Text style={styles.primaryBtnText}>🎮  Create a lobby</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="play-join-lobby"
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/lobby/join')}
        >
          <Text style={styles.secondaryBtnText}>🔑  Join a lobby</Text>
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
    paddingTop: 64,
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  sub: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 48,
    maxWidth: 280,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
})
```

### 4. CreateLobbyScreen — `mobile/app/lobby/create.tsx`

Replace the entire file:

```tsx
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
```

### 5. JoinLobbyScreen — `mobile/app/lobby/join.tsx`

Replace the entire file:

```tsx
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
```

---

## Verification

Run these commands in order. Report each result. Do not declare success until all pass.

```bash
# 1. TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile && npx tsc --noEmit

# 2. Confirm join-lobby function file exists
ls /Users/mizzy/Developer/Trivolta/supabase/functions/join-lobby/index.ts

# 3. Confirm no unintended files were modified
cd /Users/mizzy/Developer/Trivolta && git diff --name-only
```

Expected files changed:
- `supabase/functions/join-lobby/index.ts` (new)
- `mobile/lib/api.ts`
- `mobile/app/(tabs)/play.tsx`
- `mobile/app/lobby/create.tsx`
- `mobile/app/lobby/join.tsx`

No other files should appear in the diff.
