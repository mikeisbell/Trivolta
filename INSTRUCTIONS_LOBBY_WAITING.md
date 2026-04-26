# INSTRUCTIONS_LOBBY_WAITING.md — LobbyWaitingScreen

## Task

Build LobbyWaitingScreen — the pre-game staging area where players wait before a lobby game starts. This screen is reached from both CreateLobbyScreen (host) and JoinLobbyScreen (guest). It must:

- Show the room code prominently (for the host to share)
- Show a real-time player list using Supabase Realtime subscription on `lobby_players`
- Show each player's username (joined from `profiles`)
- Allow the host to start the game (triggers question generation, then navigates all players to LobbyGameScreen)
- Allow a guest to leave the lobby (removes them from `lobby_players`, navigates back)
- Poll `lobbies.status` via Realtime and auto-navigate guests to LobbyGameScreen when status becomes `active`

This screen does NOT build LobbyGameScreen — that is a separate INSTRUCTIONS file.

---

## Verifiable Objective

- [ ] Screen renders with room code displayed in large text — testID `lobby-waiting-code`
- [ ] Player list renders with at least one entry (the current user) — testID `lobby-waiting-player-list`
- [ ] Each player row has testID `lobby-waiting-player-{username}`
- [ ] Player count badge shows `X / 8` — testID `lobby-waiting-player-count`
- [ ] Host sees "Start game" button — testID `lobby-waiting-start`; guest does NOT see it
- [ ] Guest sees "Leave lobby" button — testID `lobby-waiting-leave`; host does NOT see it
- [ ] "Start game" is disabled when player count is < 2 — enabled at 2+
- [ ] Tapping "Start game" calls `generateLobbyQuestions`, updates `lobbies.status` to `active`, then navigates host to `/lobby/game` with `lobbyId` param
- [ ] Guests auto-navigate to `/lobby/game` when `lobbies.status` becomes `active` via Realtime
- [ ] `npx tsc --noEmit` passes with 0 errors

---

## Constraints

- Use Supabase Realtime channel subscription for `lobby_players` — do NOT poll with `setInterval`
- Use a second Realtime subscription for `lobbies` to detect status change to `active`
- Subscribe in `useEffect`, unsubscribe on cleanup (return unsubscribe function)
- Do NOT build LobbyGameScreen — navigate to `/lobby/game` as a stub route only
- Do NOT modify `create.tsx`, `join.tsx`, `api.ts` types, or any existing screen
- Do NOT use `@supabase/realtime-js` directly — use the Realtime API on the `supabase` client from `lib/supabase`
- Do NOT add a `join-lobby` Edge Function — it already exists
- The `isHost` param arrives as a string `'1'` or `'0'` from router params — convert to boolean with `isHost === '1'`
- After "Start game": call `generateLobbyQuestions` first, await completion, then update lobby status to `active`. Do not update status before questions are generated.
- Add a loading state during question generation ("Generating questions…") that disables the start button and shows an ActivityIndicator

---

## Steps

### Step 1 — Add `fetchLobbyPlayers`, `startLobbyGame`, and `leaveLobby` to `api.ts`

Append to `/Users/mizzy/Developer/Trivolta/mobile/lib/api.ts`:

```typescript
export async function fetchLobbyPlayers(
  lobbyId: string
): Promise<{ user_id: string; username: string }[]> {
  const { data, error } = await supabase
    .from('lobby_players')
    .select('user_id, profiles(username)')
    .eq('lobby_id', lobbyId)

  if (error || !data) return []

  return data.map((row: any) => ({
    user_id: row.user_id,
    username: Array.isArray(row.profiles) ? row.profiles[0]?.username : row.profiles?.username ?? 'Unknown',
  }))
}

export async function startLobbyGame(lobbyId: string): Promise<void> {
  const { error } = await supabase
    .from('lobbies')
    .update({ status: 'active' })
    .eq('id', lobbyId)

  if (error) throw new Error(error.message)
}

export async function leaveLobby(lobbyId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  const { error } = await supabase
    .from('lobby_players')
    .delete()
    .eq('lobby_id', lobbyId)
    .eq('user_id', session.user.id)

  if (error) throw new Error(error.message)
}
```

### Step 2 — Build `waiting.tsx`

Replace the contents of `/Users/mizzy/Developer/Trivolta/mobile/app/lobby/waiting.tsx` entirely:

```typescript
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, FlatList, Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { colors, radius, spacing } from '../../lib/theme'
import {
  fetchLobbyPlayers,
  generateLobbyQuestions,
  startLobbyGame,
  leaveLobby,
} from '../../lib/api'

type Player = { user_id: string; username: string }

export default function LobbyWaitingScreen() {
  const { lobbyId, isHost: isHostParam } = useLocalSearchParams<{ lobbyId: string; isHost: string }>()
  const isHost = isHostParam === '1'
  const router = useRouter()

  const [players, setPlayers] = useState<Player[]>([])
  const [roomCode, setRoomCode] = useState('')
  const [category, setCategory] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const playersChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const lobbyChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Load lobby details (code + category)
  useEffect(() => {
    async function loadLobby() {
      const { data } = await supabase
        .from('lobbies')
        .select('code, category')
        .eq('id', lobbyId)
        .single()
      if (data) {
        setRoomCode(data.code)
        setCategory(data.category)
      }
    }
    loadLobby()
  }, [lobbyId])

  // Initial player load
  useEffect(() => {
    fetchLobbyPlayers(lobbyId).then(setPlayers)
  }, [lobbyId])

  // Realtime: player list
  useEffect(() => {
    const channel = supabase
      .channel(`lobby-players-${lobbyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${lobbyId}` },
        () => { fetchLobbyPlayers(lobbyId).then(setPlayers) }
      )
      .subscribe()

    playersChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [lobbyId])

  // Realtime: lobby status — guests navigate when host starts game
  useEffect(() => {
    if (isHost) return

    const channel = supabase
      .channel(`lobby-status-${lobbyId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` },
        (payload) => {
          if ((payload.new as any)?.status === 'active') {
            router.replace({ pathname: '/lobby/game', params: { lobbyId } })
          }
        }
      )
      .subscribe()

    lobbyChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [lobbyId, isHost])

  async function handleStart() {
    if (players.length < 2) return
    setGenerating(true)
    setError('')
    try {
      await generateLobbyQuestions(lobbyId, category, 'medium')
      await startLobbyGame(lobbyId)
      router.replace({ pathname: '/lobby/game', params: { lobbyId, isHost: '1' } })
    } catch (err: any) {
      setError(err.message ?? 'Failed to start game')
      setGenerating(false)
    }
  }

  async function handleLeave() {
    Alert.alert('Leave lobby', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leaveLobby(lobbyId)
          router.replace('/')
        },
      },
    ])
  }

  const canStart = players.length >= 2 && !generating

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        {/* Header */}
        <Text style={styles.title}>Waiting for players</Text>
        <Text style={styles.categoryLabel}>{category}</Text>

        {/* Room code */}
        <View style={styles.codeCard}>
          <Text style={styles.codeHint}>Room code</Text>
          <Text testID="lobby-waiting-code" style={styles.code}>
            {roomCode}
          </Text>
          <Text style={styles.codeHint}>Share this with your friends</Text>
        </View>

        {/* Player count */}
        <View style={styles.playerHeader}>
          <Text style={styles.playerTitle}>Players</Text>
          <Text testID="lobby-waiting-player-count" style={styles.playerCount}>
            {players.length} / 8
          </Text>
        </View>

        {/* Player list */}
        <FlatList
          testID="lobby-waiting-player-list"
          data={players}
          keyExtractor={(item) => item.user_id}
          style={styles.list}
          renderItem={({ item, index }) => (
            <View
              testID={`lobby-waiting-player-${item.username}`}
              style={styles.playerRow}
            >
              <View style={styles.avatarBadge}>
                <Text style={styles.avatarText}>{item.username[0]?.toUpperCase()}</Text>
              </View>
              <Text style={styles.playerName}>{item.username}</Text>
              {index === 0 && (
                <View style={styles.hostBadge}>
                  <Text style={styles.hostBadgeText}>Host</Text>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Loading players…</Text>
          }
        />

        {/* Error */}
        {error !== '' && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        {/* CTA */}
        {isHost ? (
          <TouchableOpacity
            testID="lobby-waiting-start"
            style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
            activeOpacity={canStart ? 0.85 : 1}
            onPress={handleStart}
            disabled={!canStart}
          >
            {generating ? (
              <View style={styles.generatingRow}>
                <ActivityIndicator color={colors.textPrimary} style={{ marginRight: 8 }} />
                <Text style={styles.startBtnText}>Generating questions…</Text>
              </View>
            ) : (
              <Text style={styles.startBtnText}>
                {players.length < 2 ? 'Waiting for players…' : 'Start game'}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            testID="lobby-waiting-leave"
            style={styles.leaveBtn}
            activeOpacity={0.85}
            onPress={handleLeave}
          >
            <Text style={styles.leaveBtnText}>Leave lobby</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  categoryLabel: {
    fontSize: 13,
    color: colors.purpleLight,
    fontWeight: '600',
    marginBottom: spacing.xl,
    textTransform: 'capitalize',
  },
  codeCard: {
    backgroundColor: colors.purpleDim,
    borderWidth: 1,
    borderColor: colors.purpleBorder,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  codeHint: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  code: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.purpleLight,
    letterSpacing: 8,
    marginVertical: 8,
  },
  playerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  playerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  playerCount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  list: {
    flex: 1,
    marginBottom: spacing.lg,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  avatarBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.purpleDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.purpleLight,
  },
  playerName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  hostBadge: {
    backgroundColor: colors.goldDim,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  hostBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.goldText,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  startBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnDisabled: { opacity: 0.4 },
  startBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  generatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaveBtn: {
    backgroundColor: colors.dangerDim,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  leaveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.danger,
  },
})
```

### Step 3 — Add stub `/lobby/game` route

Create `/Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx` with a minimal stub so navigation doesn't crash:

```typescript
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'

export default function LobbyGameScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>LobbyGameScreen — coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textSecondary, fontSize: 15 },
})
```

### Step 4 — Update TRIVOLTA_TRACKER.md

Mark `LobbyWaitingScreen` as ✅ Done. Add `INSTRUCTIONS_LOBBY_WAITING.md` to the INSTRUCTIONS Files Written section.

---

## Verification

Run in order. Do not report success until all pass.

```bash
# 1. TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Confirm files exist
ls /Users/mizzy/Developer/Trivolta/mobile/app/lobby/waiting.tsx
ls /Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx

# 3. Confirm testIDs present in waiting.tsx
grep -c "testID" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/waiting.tsx

# 4. Confirm Realtime subscriptions present
grep "postgres_changes" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/waiting.tsx

# 5. Confirm cleanup on unmount
grep "removeChannel" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/waiting.tsx

# 6. Capture diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report results for each check. Do not commit — Mac Claude reviews the diff first.
