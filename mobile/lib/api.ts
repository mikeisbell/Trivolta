import { supabase } from './supabase'
import type { QuestionResponse, UserStats } from './types'

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
