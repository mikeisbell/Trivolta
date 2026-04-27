import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const today = new Date().toISOString().slice(0, 10)

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: challenge, error: upsertError } = await serviceClient
      .from('daily_challenges')
      .upsert({ challenge_date: today, category: 'Mixed trivia' }, { onConflict: 'challenge_date' })
      .select()
      .single()

    if (upsertError || !challenge) {
      return new Response(JSON.stringify({ error: String(upsertError) }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )

    const { data: completion } = await userClient
      .from('daily_challenge_completions')
      .select('score')
      .eq('challenge_id', challenge.id)
      .maybeSingle()

    return new Response(JSON.stringify({
      id: challenge.id,
      date: challenge.challenge_date,
      category: challenge.category,
      completed: completion !== null,
      completionScore: completion?.score ?? null,
    }), {
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
