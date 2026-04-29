import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'
import { runAutoSeed } from '../_shared/auto_seed_pipeline.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// Pipeline models — citation uses Haiku, cross-check uses Sonnet.
// Defined in ../_shared/auto_seed_pipeline.ts; mirrored here for grep-based audits.
const _CITATION_MODEL = 'claude-haiku-4-5-20251001'
const _CROSS_CHECK_MODEL = 'claude-sonnet-4-6'
void _CITATION_MODEL
void _CROSS_CHECK_MODEL

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
  if ((user.app_metadata as Record<string, unknown> | null)?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: jsonHeaders })
  }

  let body: { fact_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }
  const factId = body?.fact_id
  if (!factId) {
    return new Response(JSON.stringify({ error: 'fact_id required' }), { status: 400, headers: jsonHeaders })
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

  try {
    const result = await runAutoSeed(factId, service, anthropic)
    return new Response(JSON.stringify(result.body), { status: result.status, headers: jsonHeaders })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message ?? err) }),
      { status: 503, headers: jsonHeaders },
    )
  }
})
