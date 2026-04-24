import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const { category } = await req.json()
    if (!category) {
      return new Response(JSON.stringify({ error: 'category required' }), { status: 400, headers: corsHeaders })
    }

    // Generate unique room code
    let code = generateRoomCode()
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase.from('lobbies').select('id').eq('code', code).single()
      if (!existing) break
      code = generateRoomCode()
    }

    const { data: lobby, error: lobbyError } = await supabase
      .from('lobbies')
      .insert({ code, host_id: user.id, category, max_players: 8 })
      .select()
      .single()

    if (lobbyError) throw lobbyError

    // Add host as first player
    await supabase.from('lobby_players').insert({ lobby_id: lobby.id, user_id: user.id })

    return new Response(JSON.stringify({ lobby }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
