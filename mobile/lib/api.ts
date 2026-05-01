import { supabase } from './supabase'
import type { QuestionResponse, UserStats, LeaderboardEntry, LeaderboardPeriod, DailyChallenge } from './types'

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

  const [profileRes, scoresRes, leaderboardRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('scores').select('score, correct_count, total_questions, best_streak').eq('user_id', userId),
    supabase.from('leaderboard').select('id').order('total_score', { ascending: false }),
  ])

  if (profileRes.error || !profileRes.data) return null
  const profile = profileRes.data
  const scores = scoresRes.data
  const leaderboard = leaderboardRes.data

  const totalScore = scores?.reduce((sum, s) => sum + s.score, 0) ?? 0
  const totalCorrect = scores?.reduce((sum, s) => sum + s.correct_count, 0) ?? 0
  const totalQuestions = scores?.reduce((sum, s) => sum + s.total_questions, 0) ?? 0
  const bestStreak = scores?.reduce((max, s) => Math.max(max, s.best_streak), 0) ?? 0
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0

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
  const { data, error } = await supabase.rpc('get_leaderboard', { period })
  if (error || !data) return []

  return (data as Array<{
    id: string
    username: string
    avatar_url: string | null
    total_score: number
    games_played: number
    rank: number
  }>).map(row => ({
    id: row.id,
    username: row.username,
    avatar_url: row.avatar_url,
    total_score: Number(row.total_score),
    games_played: Number(row.games_played),
    rank: Number(row.rank),
  }))
}

export async function fetchLobbyPlayers(
  lobbyId: string
): Promise<{ user_id: string; username: string }[]> {
  const { data, error } = await supabase
    .from('lobby_players')
    .select('user_id, profiles(username)')
    .eq('lobby_id', lobbyId)
    .order('joined_at', { ascending: true })

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

export async function fetchLobbyQuestion(
  lobbyId: string,
  questionIndex: number
): Promise<{ question: string; answers: string[]; correct_index: number; explanation: string; difficulty: string } | null> {
  const { data, error } = await supabase
    .from('lobby_questions')
    .select('question, answers, correct_index, explanation, difficulty')
    .eq('lobby_id', lobbyId)
    .eq('question_index', questionIndex)
    .single()

  if (error || !data) return null
  return data as any
}

export async function fetchGameSession(
  lobbyId: string,
  questionIndex: number
): Promise<{ starts_at: string } | null> {
  const { data, error } = await supabase
    .from('game_sessions')
    .select('starts_at')
    .eq('lobby_id', lobbyId)
    .eq('question_index', questionIndex)
    .single()

  if (error || !data) return null
  return data
}

export async function createGameSession(
  lobbyId: string,
  questionIndex: number
): Promise<void> {
  const { error } = await supabase.rpc('create_game_session', {
    p_lobby_id: lobbyId,
    p_question_index: questionIndex,
  })
  if (error) throw new Error(error.message)
}

export async function submitLobbyAnswer(
  lobbyId: string,
  questionIndex: number,
  answerIndex: number,
  score: number
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  const { error } = await supabase
    .from('lobby_answers')
    .insert({
      lobby_id: lobbyId,
      user_id: session.user.id,
      question_index: questionIndex,
      answer_index: answerIndex,
      score,
    })

  // Ignore duplicate key error (23505) — answer already submitted
  if (error && error.code !== '23505') {
    throw new Error(error.message)
  }
}

export async function finishLobbyGame(lobbyId: string): Promise<void> {
  const { error } = await supabase
    .from('lobbies')
    .update({ status: 'finished' })
    .eq('id', lobbyId)

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

export type LobbyPlayerResult = {
  user_id: string
  username: string
  correct: number
  total: number
  accuracy: number
  score: number
  rank: number
  isCurrentUser: boolean
}

export type FeedbackPayload = {
  screen: string
  route_path?: string | null
  platform: 'ios' | 'android' | 'web'
  app_version?: string | null
  state_snapshot?: Record<string, unknown>
  body: string
}

export async function submitFeedback(payload: FeedbackPayload): Promise<{ ok: true; id: string }> {
  const res = await callFunction('submit-feedback', payload)
  if (!res.ok) throw new Error(`submit-feedback failed: ${res.status}`)
  return res.json()
}

export async function fetchDailyChallenge(): Promise<DailyChallenge | null> {
  try {
    const res = await callFunction('daily-challenge', {})
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function saveDailyChallengeCompletion(
  challengeId: string,
  score: number,
  correctCount: number,
  totalQuestions: number,
  bestStreak: number
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await supabase.from('daily_challenge_completions').insert({
      challenge_id: challengeId,
      user_id: session.user.id,
      score,
      correct_count: correctCount,
      total_questions: totalQuestions,
      best_streak: bestStreak,
    })
  } catch {
    // silently ignore all errors including duplicate key (23505)
  }
}

export async function fetchLobbyResults(lobbyId: string): Promise<LobbyPlayerResult[]> {
  const { data: { session } } = await supabase.auth.getSession()
  const currentUserId = session?.user.id ?? ''

  // Fetch all players in this lobby
  const { data: players, error: playersError } = await supabase
    .from('lobby_players')
    .select('user_id, profiles(username)')
    .eq('lobby_id', lobbyId)

  if (playersError || !players) return []

  // Fetch all questions for this lobby (to know correct answers)
  const { data: questions, error: questionsError } = await supabase
    .from('lobby_questions')
    .select('question_index, correct_index')
    .eq('lobby_id', lobbyId)

  if (questionsError || !questions) return []

  const correctByIndex: Record<number, number> = {}
  for (const q of questions) {
    correctByIndex[q.question_index] = q.correct_index
  }
  const total = questions.length

  // Fetch all answers for this lobby
  const { data: answers, error: answersError } = await supabase
    .from('lobby_answers')
    .select('user_id, question_index, answer_index, score')
    .eq('lobby_id', lobbyId)

  if (answersError) return []

  // Compute correct count and total score per player
  const correctCountByUser: Record<string, number> = {}
  const scoreByUser: Record<string, number> = {}
  for (const answer of answers ?? []) {
    const isCorrect = correctByIndex[answer.question_index] === answer.answer_index
    if (isCorrect) {
      correctCountByUser[answer.user_id] = (correctCountByUser[answer.user_id] ?? 0) + 1
    }
    scoreByUser[answer.user_id] = (scoreByUser[answer.user_id] ?? 0) + (answer.score ?? 0)
  }

  // Build result rows
  const rows = players.map((p: any) => {
    const username = Array.isArray(p.profiles) ? p.profiles[0]?.username : p.profiles?.username ?? 'Unknown'
    const correct = correctCountByUser[p.user_id] ?? 0
    const score = scoreByUser[p.user_id] ?? 0
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0
    return {
      user_id: p.user_id,
      username,
      correct,
      total,
      accuracy,
      score,
      rank: 0,
      isCurrentUser: p.user_id === currentUserId,
    }
  })

  // Sort by score descending, assign ranks
  rows.sort((a, b) => b.score - a.score)
  rows.forEach((r, i) => { r.rank = i + 1 })

  return rows
}
