import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const MAX_RETRIES = 2
const AMBIGUITY_REJECT = 3

function extractJson(text: string): string | null {
  const t = text.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end < 0) return null
  return t.slice(start, end + 1)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    (req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''),
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }
  if ((user.app_metadata as Record<string, unknown> | null)?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: jsonHeaders })
  }

  let body: { fact_id?: string; apply?: boolean }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }
  const factId = body?.fact_id
  if (!factId) {
    return new Response(JSON.stringify({ error: 'fact_id required' }), { status: 400, headers: jsonHeaders })
  }
  const apply = body?.apply === true

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: fact, error: factErr } = await service
    .from('facts')
    .select('id, fact_text, correct_answer, is_high_value')
    .eq('id', factId)
    .maybeSingle()
  if (factErr) {
    return new Response(JSON.stringify({ error: factErr.message }), { status: 503, headers: jsonHeaders })
  }
  if (!fact) {
    return new Response(JSON.stringify({ error: 'Fact not found' }), { status: 404, headers: jsonHeaders })
  }
  if (fact.is_high_value) {
    return new Response(
      JSON.stringify({ error: 'High-value facts are not eligible for AI-cached distractors' }),
      { status: 400, headers: jsonHeaders },
    )
  }

  if (apply) {
    const { data: existingAiCached, error: idemErr } = await service
      .from('distractors')
      .select('id')
      .eq('fact_id', factId)
      .eq('authored_by', 'ai-cached')
      .eq('is_active', true)
      .limit(1)
    if (idemErr) {
      return new Response(JSON.stringify({ error: idemErr.message }), { status: 503, headers: jsonHeaders })
    }
    if (existingAiCached && existingAiCached.length > 0) {
      return new Response(
        JSON.stringify({ ok: true, fact_id: factId, applied: false, reason: 'already_regenerated' }),
        { status: 200, headers: jsonHeaders },
      )
    }
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

  const generatePrompt = `Generate 3 plausible but incorrect answers for this trivia fact.
Fact: ${fact.fact_text}
Correct answer: ${fact.correct_answer}

Each distractor should be the same type/category as the correct answer (e.g., if the correct answer is a person, the distractors should also be people). Distractors should sound plausible but be definitively wrong.

Return ONLY JSON. No markdown. Shape:
{"distractors":["wrong 1","wrong 2","wrong 3"]}`

  const buildValidationPrompt = (distractors: string[]) => `Rate the ambiguity of these candidate distractors for the trivia fact.
Fact: ${fact.fact_text}
Correct answer: ${fact.correct_answer}
Candidate distractors:
1. ${distractors[0]}
2. ${distractors[1]}
3. ${distractors[2]}

For each distractor, rate ambiguity 1 (clearly wrong) to 5 (could arguably also be correct).

Return ONLY JSON. No markdown. Shape:
{"scores":[n,n,n]}`

  const generateDistractors = async (): Promise<string[] | null> => {
    try {
      const msg = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 400,
        system: 'You generate distractors for trivia questions. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: generatePrompt }],
      })
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const json = extractJson(text)
      if (!json) return null
      const parsed = JSON.parse(json) as { distractors?: string[] }
      if (!parsed?.distractors || parsed.distractors.length !== 3) return null
      if (!parsed.distractors.every((d) => typeof d === 'string' && d.length > 0)) return null
      return parsed.distractors
    } catch {
      return null
    }
  }

  const validateDistractors = async (distractors: string[]): Promise<number[] | null> => {
    try {
      const msg = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 200,
        system: 'You validate trivia distractors. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: buildValidationPrompt(distractors) }],
      })
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const json = extractJson(text)
      if (!json) return null
      const parsed = JSON.parse(json) as { scores?: number[] }
      if (!parsed?.scores || parsed.scores.length !== 3) return null
      if (!parsed.scores.every((n) => typeof n === 'number')) return null
      return parsed.scores
    } catch {
      return null
    }
  }

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

  let lastDistractors: string[] | null = null
  let lastScores: number[] | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const distractors = await generateDistractors()
    if (!distractors) continue
    lastDistractors = distractors
    const scores = await validateDistractors(distractors)
    if (!scores) continue
    lastScores = scores
    if (scores.every((n) => n < AMBIGUITY_REJECT)) {
      if (!apply) {
        return new Response(
          JSON.stringify({ ok: true, fact_id: factId, distractors, scores }),
          { status: 200, headers: jsonHeaders },
        )
      }

      const qualityScore = clamp(5 - Math.max(...scores), 1, 5)
      const reviewedAt = new Date().toISOString()

      const { error: deactivateErr } = await service
        .from('distractors')
        .update({ is_active: false })
        .eq('fact_id', factId)
        .eq('authored_by', 'imported')
        .eq('is_active', true)
      if (deactivateErr) {
        return new Response(
          JSON.stringify({
            ok: true,
            fact_id: factId,
            applied: false,
            reason: 'write_failed',
            error: deactivateErr.message,
            distractors,
            scores,
          }),
          { status: 200, headers: jsonHeaders },
        )
      }

      const insertRows = distractors.map((distractor_text) => ({
        fact_id: factId,
        distractor_text,
        authored_by: 'ai-cached',
        is_active: true,
        quality_score: qualityScore,
        reviewed_by: user.id,
        reviewed_at: reviewedAt,
      }))
      const { error: insertErr } = await service.from('distractors').insert(insertRows)
      if (insertErr) {
        return new Response(
          JSON.stringify({
            ok: true,
            fact_id: factId,
            applied: false,
            reason: 'write_failed',
            error: insertErr.message,
            distractors,
            scores,
          }),
          { status: 200, headers: jsonHeaders },
        )
      }

      return new Response(
        JSON.stringify({
          ok: true,
          fact_id: factId,
          applied: true,
          quality_score: qualityScore,
          distractors,
          scores,
        }),
        { status: 200, headers: jsonHeaders },
      )
    }
  }

  const failBody: Record<string, unknown> = {
    ok: false,
    fact_id: factId,
    reason: 'validation_failed',
    distractors: lastDistractors ?? [],
    scores: lastScores ?? [],
  }
  if (apply) failBody.applied = false
  return new Response(JSON.stringify(failBody), { status: 200, headers: jsonHeaders })
})
