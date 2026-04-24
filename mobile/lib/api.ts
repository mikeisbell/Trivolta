import { supabase } from './supabase'
import type { QuestionResponse } from './types'

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
  streak: number
): Promise<QuestionResponse> {
  const res = await callFunction('solo-question', { category, streak })
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
