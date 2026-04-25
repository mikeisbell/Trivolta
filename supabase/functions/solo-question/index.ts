import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function difficultyFromStreak(streak: number): string {
  if (streak >= 5) return 'hard'
  if (streak >= 2) return 'medium'
  return 'easy'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { category, streak = 0, previousQuestions = [] } = await req.json()
    const difficulty = difficultyFromStreak(streak)
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

    const avoidClause = previousQuestions.length > 0
      ? `\nDo NOT repeat any of these questions already asked this session:\n${previousQuestions.join('\n')}`
      : ''

    const prompt = `Generate a trivia question about "${category}" at ${difficulty} difficulty.
Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
  "question": "the question text",
  "answers": ["correct answer", "wrong 1", "wrong 2", "wrong 3"],
  "correct_index": 0,
  "explanation": "one sentence explanation",
  "difficulty": "${difficulty}",
  "category": "${category}"
}
Pre-shuffle the answers array. correct_index must point to the correct answer after shuffling.${avoidClause}`

    const attempt = async () => {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: 'You are a trivia question generator. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      return JSON.parse(text.trim())
    }

    let result
    try { result = await attempt() } catch { result = await attempt() }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
