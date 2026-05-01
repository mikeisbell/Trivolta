import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

type RequestBody = {
  fact_id?: unknown
  verdict?: unknown
  note?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validate(raw: RequestBody): { ok: true; value: {
  fact_id: string
  verdict: 'correct' | 'incorrect'
  note: string | null
} } | { ok: false; field: string } {
  const factId = raw?.fact_id
  if (typeof factId !== 'string' || !UUID_RE.test(factId)) {
    return { ok: false, field: 'fact_id' }
  }

  const verdict = raw?.verdict
  if (verdict !== 'correct' && verdict !== 'incorrect') {
    return { ok: false, field: 'verdict' }
  }

  let note: string | null = null
  if (raw?.note !== undefined && raw?.note !== null) {
    if (typeof raw.note !== 'string') {
      return { ok: false, field: 'note' }
    }
    const trimmed = raw.note.trim()
    if (trimmed.length === 0) {
      // empty optional note is treated as absent
      note = null
    } else if (trimmed.length > 2000) {
      return { ok: false, field: 'note' }
    } else {
      note = raw.note
    }
  }

  return { ok: true, value: { fact_id: factId, verdict, note } }
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

  let raw: RequestBody
  try {
    raw = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }

  const result = validate(raw)
  if (!result.ok) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'validation_failed', error: result.field }),
      { status: 400, headers: jsonHeaders },
    )
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: fact, error: factErr } = await service
    .from('facts')
    .select('id, category_id, categories(slug)')
    .eq('id', result.value.fact_id)
    .maybeSingle()
  if (factErr) {
    return new Response(JSON.stringify({ error: factErr.message }), { status: 503, headers: jsonHeaders })
  }
  if (!fact) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'fact_not_found' }),
      { status: 404, headers: jsonHeaders },
    )
  }
  const categorySlug = (Array.isArray((fact as Record<string, unknown>).categories)
    ? ((fact as { categories: Array<{ slug: string }> }).categories[0]?.slug)
    : ((fact as { categories: { slug: string } | null }).categories?.slug)) ?? ''

  const { data: inserted, error: insertErr } = await service
    .from('spot_check_results')
    .insert({
      fact_id: result.value.fact_id,
      reviewer_id: user.id,
      verdict: result.value.verdict,
      note: result.value.note,
      category_slug: categorySlug,
    })
    .select('id')
    .single()

  if (insertErr) {
    if (insertErr.code === '23505') {
      return new Response(
        JSON.stringify({ ok: false, reason: 'already_reviewed' }),
        { status: 409, headers: jsonHeaders },
      )
    }
    return new Response(
      JSON.stringify({ ok: false, reason: 'insert_failed', error: insertErr.message }),
      { status: 500, headers: jsonHeaders },
    )
  }

  let factReportId: string | null = null
  let factReportError: string | null = null
  if (result.value.verdict === 'incorrect') {
    const { data: reportRow, error: reportErr } = await service
      .from('fact_reports')
      .insert({
        fact_id: result.value.fact_id,
        reported_by: user.id,
        reason: 'incorrect',
        detail: result.value.note,
        status: 'open',
      })
      .select('id')
      .single()
    if (reportErr || !reportRow) {
      factReportError = reportErr?.message ?? 'unknown'
    } else {
      factReportId = reportRow.id
    }
  }

  const responseBody: Record<string, unknown> = {
    ok: true,
    id: inserted!.id,
    fact_report_id: factReportId,
  }
  if (factReportError) responseBody.fact_report_error = factReportError

  return new Response(JSON.stringify(responseBody), { status: 200, headers: jsonHeaders })
})
