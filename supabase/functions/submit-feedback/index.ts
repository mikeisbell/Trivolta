import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const PLATFORMS = ['ios', 'android', 'web'] as const
type Platform = typeof PLATFORMS[number]

type RequestBody = {
  screen?: unknown
  route_path?: unknown
  platform?: unknown
  app_version?: unknown
  state_snapshot?: unknown
  body?: unknown
}

function validate(body: RequestBody): { ok: true; value: {
  screen: string
  route_path: string | null
  platform: Platform
  app_version: string | null
  state_snapshot: Record<string, unknown> | null
  body: string
} } | { ok: false; field: string } {
  const screen = body?.screen
  if (typeof screen !== 'string' || screen.length < 1 || screen.length > 120) {
    return { ok: false, field: 'screen' }
  }

  let route_path: string | null = null
  if (body?.route_path !== undefined && body?.route_path !== null) {
    if (typeof body.route_path !== 'string' || body.route_path.length > 500) {
      return { ok: false, field: 'route_path' }
    }
    route_path = body.route_path
  }

  const platform = body?.platform
  if (typeof platform !== 'string' || !PLATFORMS.includes(platform as Platform)) {
    return { ok: false, field: 'platform' }
  }

  let app_version: string | null = null
  if (body?.app_version !== undefined && body?.app_version !== null) {
    if (typeof body.app_version !== 'string' || body.app_version.length > 40) {
      return { ok: false, field: 'app_version' }
    }
    app_version = body.app_version
  }

  let state_snapshot: Record<string, unknown> | null = null
  if (body?.state_snapshot !== undefined && body?.state_snapshot !== null) {
    if (typeof body.state_snapshot !== 'object' || Array.isArray(body.state_snapshot)) {
      return { ok: false, field: 'state_snapshot' }
    }
    const serialized = JSON.stringify(body.state_snapshot)
    if (serialized.length > 16384) {
      return { ok: false, field: 'state_snapshot' }
    }
    state_snapshot = body.state_snapshot as Record<string, unknown>
  }

  const rawBody = body?.body
  if (typeof rawBody !== 'string') {
    return { ok: false, field: 'body' }
  }
  const trimmed = rawBody.trim()
  if (trimmed.length < 1 || trimmed.length > 4000) {
    return { ok: false, field: 'body' }
  }

  return {
    ok: true,
    value: {
      screen,
      route_path,
      platform: platform as Platform,
      app_version,
      state_snapshot,
      body: rawBody,
    },
  }
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

  const { data: inserted, error: insertErr } = await service
    .from('feedback_reports')
    .insert({
      user_id: user.id,
      screen: result.value.screen,
      route_path: result.value.route_path,
      app_version: result.value.app_version,
      platform: result.value.platform,
      state_snapshot: result.value.state_snapshot,
      body: result.value.body,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'insert_failed', error: insertErr?.message ?? 'unknown' }),
      { status: 500, headers: jsonHeaders },
    )
  }

  return new Response(
    JSON.stringify({ ok: true, id: inserted.id }),
    { status: 200, headers: jsonHeaders },
  )
})
