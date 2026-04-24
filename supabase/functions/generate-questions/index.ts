import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { lobby_id, category, difficulty = 'medium' } = await req.json()
    if (!lobby_id || !category) {
      return new Response(JSON.stringify({ error: 'lobby_id and category required' }), {
        status: 400, headers: corsHeaders,
      })
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const questions = []
    for (let i = 0; i < 10; i++) {
      const prompt = `Generate trivia question ${i + 1} of 10 about "${category}" at ${difficulty} difficulty.
Return ONLY valid JSON — no markdown:
{
  "question": "the question text",
  "answers": ["correct answer", "wrong 1", "wrong 2", "wrong 3"],
  "correct_index": 0,
  "explanation": "one sentence explanation",
  "difficulty": "${difficulty}",
  "category": "${category}"
}
Pre-shuffle the answers. correct_index must point to correct answer after shuffling.`

      const attempt = async () => {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          system: 'You are a trivia question generator. Return ONLY valid JSON. No markdown.',
          messages: [{ role: 'user', content: prompt }],
        })
        const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
        return JSON.parse(text.trim())
      }

      let q
      try { q = await attempt() } catch { q = await attempt() }
      questions.push(q)
    }

    const rows = questions.map((q, i) => ({
      lobby_id,
      question_index: i,
      question: q.question,
      answers: q.answers,
      correct_index: q.correct_index,
      explanation: q.explanation,
      difficulty: q.difficulty,
    }))

    const { error } = await supabase.from('lobby_questions').insert(rows)
    if (error) throw error

    return new Response(JSON.stringify({ success: true, count: questions.length }), {
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
