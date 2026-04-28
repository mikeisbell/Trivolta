import { useEffect, useState } from 'react'
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function LobbyWaitingScreen() {
  const { lobbyId, isHost: isHostParam } = useLocalSearchParams<{ lobbyId: string; isHost: string }>()
  const isHost = isHostParam === '1'
  const router = useRouter()
  const isValidLobbyId = typeof lobbyId === 'string' && UUID_REGEX.test(lobbyId)

  const [players, setPlayers] = useState<Player[]>([])
  const [roomCode, setRoomCode] = useState('')
  const [category, setCategory] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  // Load lobby details (code + category)
  useEffect(() => {
    if (!isValidLobbyId) return
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
  }, [lobbyId, isValidLobbyId])

  // Initial player load
  useEffect(() => {
    if (!isValidLobbyId) return
    fetchLobbyPlayers(lobbyId).then(setPlayers)
  }, [lobbyId, isValidLobbyId])

  // Realtime: player list
  useEffect(() => {
    if (!isValidLobbyId) return
    const channel = supabase
      .channel(`lobby-players-${lobbyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${lobbyId}` },
        () => { fetchLobbyPlayers(lobbyId).then(setPlayers) }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [lobbyId, isValidLobbyId])

  // Realtime: lobby status — guests navigate when host starts game
  useEffect(() => {
    if (!isValidLobbyId || isHost) return

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

    return () => { supabase.removeChannel(channel) }
  }, [lobbyId, isHost, isValidLobbyId])

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

  if (!isValidLobbyId) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={styles.errorText}>Invalid lobby link.</Text>
        </View>
      </SafeAreaView>
    )
  }

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
