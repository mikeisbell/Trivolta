import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: corsHeaders,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: corsHeaders,
      })
    }

    const { code } = await req.json()
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'code required' }), {
        status: 400, headers: corsHeaders,
      })
    }

    // Look up lobby by code, must be in 'waiting' state
    const { data: lobby, error: lobbyError } = await supabase
      .from('lobbies')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('status', 'waiting')
      .single()

    if (lobbyError || !lobby) {
      return new Response(JSON.stringify({ error: 'Lobby not found or already started' }), {
        status: 404, headers: corsHeaders,
      })
    }

    // Count current players
    const { count, error: countError } = await supabase
      .from('lobby_players')
      .select('*', { count: 'exact', head: true })
      .eq('lobby_id', lobby.id)

    if (countError) throw countError

    if ((count ?? 0) >= lobby.max_players) {
      return new Response(JSON.stringify({ error: 'Lobby is full' }), {
        status: 400, headers: corsHeaders,
      })
    }

    // Insert player — ignore if already joined (idempotent)
    const { error: insertError } = await supabase
      .from('lobby_players')
      .insert({ lobby_id: lobby.id, user_id: user.id })

    if (insertError && !insertError.message.includes('duplicate')) {
      throw insertError
    }

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
