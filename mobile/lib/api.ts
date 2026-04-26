import { supabase } from './supabase'
import type { QuestionResponse, UserStats, LeaderboardEntry, LeaderboardPeriod } from './types'

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1'

async function callFunction(name: string, body: object): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

export async function generateSoloQuestion(
  category: string,
  streak: number,
  previousQuestions: string[] = []
): Promise<QuestionResponse> {
  const res = await callFunction('solo-question', { category, streak, previousQuestions })
  if (!res.ok) throw new Error(`Question generation failed: ${res.status}`)
  return res.json()
}

export async function createLobby(category: string) {
  const res = await callFunction('create-lobby', { category })
  if (!res.ok) throw new Error(`Create lobby failed: ${res.status}`)
  return res.json()
}

export async function generateLobbyQuestions(
  lobby_id: string,
  category: string,
  difficulty: string
) {
  const res = await callFunction('generate-questions', { lobby_id, category, difficulty })
  if (!res.ok) throw new Error(`Generate lobby questions failed: ${res.status}`)
  return res.json()
}

export async function joinLobby(code: string) {
  const res = await callFunction('join-lobby', { code })
  if (!res.ok) {
    const body = await res.json()
    throw new Error(body.error ?? `Join lobby failed: ${res.status}`)
  }
  return res.json()
}

export async function fetchUserStats(): Promise<UserStats | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null

  const userId = session.user.id

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (profileError || !profile) return null

  const { data: scores } = await supabase
    .from('scores')
    .select('score, correct_count, total_questions, best_streak')
    .eq('user_id', userId)

  const totalScore = scores?.reduce((sum, s) => sum + s.score, 0) ?? 0
  const totalCorrect = scores?.reduce((sum, s) => sum + s.correct_count, 0) ?? 0
  const totalQuestions = scores?.reduce((sum, s) => sum + s.total_questions, 0) ?? 0
  const bestStreak = scores?.reduce((max, s) => Math.max(max, s.best_streak), 0) ?? 0
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0

  const { data: leaderboard } = await supabase
    .from('leaderboard')
    .select('id')
    .order('total_score', { ascending: false })

  const rank = leaderboard
    ? leaderboard.findIndex(row => row.id === userId) + 1
    : null

  return {
    profile,
    rank: rank && rank > 0 ? rank : null,
    totalScore,
    gamesPlayed: scores?.length ?? 0,
    bestStreak,
    accuracy,
  }
}

export async function fetchLeaderboard(
  period: LeaderboardPeriod
): Promise<LeaderboardEntry[]> {
  let query = supabase
    .from('scores')
    .select('user_id, score, profiles(id, username, avatar_url)')

  if (period === 'week') {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('played_at', weekAgo)
  } else if (period === 'month') {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('played_at', monthAgo)
  }

  const { data: scoreRows, error } = await query

  if (error || !scoreRows) return []

  const userMap: Record<string, { username: string; avatar_url: string | null; total: number; games: number }> = {}

  for (const row of scoreRows) {
    const profile = Array.isArray((row as any).profiles) ? (row as any).profiles[0] : (row as any).profiles
    if (!profile) continue
    if (!userMap[row.user_id]) {
      userMap[row.user_id] = {
        username: profile.username,
        avatar_url: profile.avatar_url,
        total: 0,
        games: 0,
      }
    }
    userMap[row.user_id].total += (row as any).score ?? 0
    userMap[row.user_id].games += 1
  }

  return Object.entries(userMap)
    .map(([id, data]) => ({
      id,
      username: data.username,
      avatar_url: data.avatar_url,
      total_score: data.total,
      games_played: data.games,
    }))
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 50)
    .map((entry, i) => ({ ...entry, rank: i + 1 }))
}

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

export async function saveScore(
  category: string,
  score: number,
  correctCount: number,
  totalQuestions: number,
  bestStreak: number
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  await supabase.from('scores').insert({
    user_id: session.user.id,
    category,
    score,
    correct_count: correctCount,
    total_questions: totalQuestions,
    best_streak: bestStreak,
  })
}
