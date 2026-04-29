import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'
import { runAutoSeed } from '../_shared/auto_seed_pipeline.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

type SingleResult = {
  fact_id: string
  outcome: string
  confidence: number | null
  reasoning: string | null
  sources_attempted: number
  sources_confirmed: number
  estimated_cost_usd: number
  duration_ms: number
  failure_stage: string | null
  failure_reason: string | null
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
  if ((user.app_metadata as Record<string, unknown> | null)?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: jsonHeaders })
  }

  let body: { category_slug?: string; limit?: number; fact_ids?: string[] }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }

  const requestedLimit = typeof body.limit === 'number' ? body.limit : DEFAULT_LIMIT
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(requestedLimit)))

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

  // Resolve which fact IDs to process
  let factIds: string[] = []
  if (Array.isArray(body.fact_ids) && body.fact_ids.length > 0) {
    factIds = body.fact_ids.slice(0, MAX_LIMIT)
  } else {
    let categoryId: string | null = null
    if (body.category_slug) {
      const { data: cat, error: catErr } = await service
        .from('categories')
        .select('id')
        .eq('slug', body.category_slug)
        .maybeSingle()
      if (catErr) {
        return new Response(
          JSON.stringify({ error: `Failed to resolve category: ${catErr.message}` }),
          { status: 503, headers: jsonHeaders },
        )
      }
      if (!cat) {
        return new Response(
          JSON.stringify({ error: `Unknown category_slug: ${body.category_slug}` }),
          { status: 400, headers: jsonHeaders },
        )
      }
      categoryId = cat.id as string
    }

    let q = service
      .from('facts')
      .select('id')
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit)
    if (categoryId) q = q.eq('category_id', categoryId)
    const { data: rows, error: rowsErr } = await q
    if (rowsErr) {
      return new Response(
        JSON.stringify({ error: `Failed to enumerate facts: ${rowsErr.message}` }),
        { status: 503, headers: jsonHeaders },
      )
    }
    factIds = (rows ?? []).map((r) => r.id as string)
  }

  const start = Date.now()
  const results: SingleResult[] = []
  let auto_verified = 0
  let needs_review = 0
  let failed = 0
  let total_input_tokens = 0
  let total_output_tokens = 0
  let total_estimated_cost_usd = 0

  for (const factId of factIds) {
    try {
      const r = await runAutoSeed(factId, service, anthropic)
      const b = r.body as Record<string, unknown>
      const outcome = String(b.outcome ?? 'failed')
      const single: SingleResult = {
        fact_id: String(b.fact_id ?? factId),
        outcome,
        confidence: (b.confidence as number | null) ?? null,
        reasoning: (b.reasoning as string | null) ?? null,
        sources_attempted: Number(b.sources_attempted ?? 0),
        sources_confirmed: Number(b.sources_confirmed ?? 0),
        estimated_cost_usd: Number(b.estimated_cost_usd ?? 0),
        duration_ms: Number(b.duration_ms ?? 0),
        failure_stage: (b.failure_stage as string | null) ?? null,
        failure_reason: (b.failure_reason as string | null) ?? null,
      }
      results.push(single)
      if (outcome === 'auto_verified') auto_verified++
      else if (outcome === 'needs_review') needs_review++
      else failed++
      total_input_tokens += Number(b.input_tokens ?? 0)
      total_output_tokens += Number(b.output_tokens ?? 0)
      total_estimated_cost_usd += single.estimated_cost_usd
    } catch (err) {
      failed++
      results.push({
        fact_id: factId,
        outcome: 'failed',
        confidence: null,
        reasoning: null,
        sources_attempted: 0,
        sources_confirmed: 0,
        estimated_cost_usd: 0,
        duration_ms: 0,
        failure_stage: 'unknown',
        failure_reason: String((err as Error)?.message ?? err).slice(0, 500),
      })
    }
  }

  return new Response(
    JSON.stringify({
      processed: results.length,
      auto_verified,
      needs_review,
      failed,
      total_input_tokens,
      total_output_tokens,
      total_estimated_cost_usd,
      duration_ms: Date.now() - start,
      results,
    }),
    { status: 200, headers: jsonHeaders },
  )
})
