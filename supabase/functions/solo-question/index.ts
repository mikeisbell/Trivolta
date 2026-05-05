import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

function difficultyFromStreak(streak: number): string {
  if (streak >= 5) return 'hard'
  if (streak >= 2) return 'medium'
  return 'easy'
}

function shuffle<T>(input: T[]): T[] {
  const arr = input.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
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
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  try {
    const { category, streak = 0, previousQuestions = [] } = await req.json()
    const difficulty = difficultyFromStreak(streak)

    // Mobile passes display labels for category cards ("Science", "Pop culture")
    // and free-form topics for custom-category ("NASA missions"). Normalize to
    // slug form; if no facts exist for the resulting slug, fall back to
    // 'general' so the player still gets a question instead of an error.
    const normalized = String(category ?? '').toLowerCase().trim().replace(/\s+/g, '-')

    const seen = new Set<string>(Array.isArray(previousQuestions) ? previousQuestions : [])

    const fetchPool = async (slug: string) => {
      const { data, error } = await userClient
        .from('facts')
        .select('id, fact_text, correct_answer, categories!inner(slug)')
        .eq('source_origin', 'opentdb_import')
        .eq('categories.slug', slug)
        .limit(200)
      return { data, error }
    }

    let { data: candidates, error: factErr } = await fetchPool(normalized)
    if (factErr) {
      return new Response(JSON.stringify({ error: String(factErr.message ?? factErr) }), { status: 503, headers: jsonHeaders })
    }
    let eligible = (candidates ?? []).filter((c) => !seen.has(c.fact_text as string))
    if (eligible.length === 0 && normalized !== 'general') {
      const fb = await fetchPool('general')
      if (fb.error) {
        return new Response(JSON.stringify({ error: String(fb.error.message ?? fb.error) }), { status: 503, headers: jsonHeaders })
      }
      eligible = (fb.data ?? []).filter((c) => !seen.has(c.fact_text as string))
    }
    if (eligible.length === 0) {
      return new Response(JSON.stringify({ error: 'no_questions_available' }), { status: 503, headers: jsonHeaders })
    }
    const fact = eligible[Math.floor(Math.random() * eligible.length)]

    const { data: distractors, error: dErr } = await userClient
      .from('distractors')
      .select('distractor_text')
      .eq('fact_id', fact.id)
      .eq('is_active', true)
      .limit(3)
    if (dErr) {
      return new Response(JSON.stringify({ error: String(dErr.message ?? dErr) }), { status: 503, headers: jsonHeaders })
    }
    if (!distractors || distractors.length < 3) {
      return new Response(
        JSON.stringify({ error: 'insufficient_distractors', fact_id: fact.id }),
        { status: 503, headers: jsonHeaders },
      )
    }

    const answers = shuffle([fact.correct_answer, ...distractors.slice(0, 3).map((d) => d.distractor_text)])
    const correct_index = answers.indexOf(fact.correct_answer)

    return new Response(
      JSON.stringify({
        question: fact.fact_text,
        answers,
        correct_index,
        explanation: '',
        difficulty,
        category,
      }),
      { status: 200, headers: jsonHeaders },
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 503,
      headers: jsonHeaders,
    })
  }
})
