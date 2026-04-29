import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const FETCH_TIMEOUT_MS = 10_000
const VALID_SOURCE_TYPES = new Set(['wikipedia', 'imdb', 'official_record', 'reference_book', 'other'])

type Candidate = {
  url: string
  source_type: string
  excerpt: string
  verified_reachable: boolean
  excerpt_match: boolean
  status_code: number | null
  error: string | null
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { redirect: 'follow', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function parseProposals(text: string): Array<{ url: string; source_type: string; excerpt: string }> | null {
  try {
    const trimmed = text.trim()
    const jsonStart = trimmed.indexOf('{')
    const jsonEnd = trimmed.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < 0) return null
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as { sources?: Array<{ url: string; source_type: string; excerpt: string }> }
    if (!parsed?.sources || !Array.isArray(parsed.sources)) return null
    return parsed.sources
      .filter((s) => typeof s?.url === 'string' && typeof s?.excerpt === 'string')
      .map((s) => ({
        url: s.url,
        source_type: VALID_SOURCE_TYPES.has(s.source_type) ? s.source_type : 'other',
        excerpt: s.excerpt,
      }))
  } catch {
    return null
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
    { global: { headers: { Authorization: authHeader } } }
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
  const { data: fact, error: factErr } = await service
    .from('facts')
    .select('id, fact_text, correct_answer')
    .eq('id', factId)
    .maybeSingle()
  if (factErr) {
    return new Response(JSON.stringify({ error: factErr.message }), { status: 503, headers: jsonHeaders })
  }
  if (!fact) {
    return new Response(JSON.stringify({ error: 'Fact not found' }), { status: 404, headers: jsonHeaders })
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  const prompt = `You will propose 2 source URLs that confirm this trivia fact.
Fact: ${fact.fact_text}
Correct answer: ${fact.correct_answer}

For each source, return:
- url: a public URL where the fact can be verified
- source_type: one of "wikipedia", "imdb", "official_record", "reference_book", "other"
- excerpt: a short verbatim quote (no more than 30 words) that should appear on the fetched page

Return ONLY JSON. No markdown. Shape:
{"sources":[{"url":"...","source_type":"wikipedia","excerpt":"..."},{"url":"...","source_type":"...","excerpt":"..."}]}`

  let proposals: Array<{ url: string; source_type: string; excerpt: string }> | null = null
  let lastError: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 600,
        system: 'You propose source URLs for trivia fact verification. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const parsed = parseProposals(text)
      if (parsed && parsed.length > 0) {
        proposals = parsed.slice(0, 2)
        break
      }
      lastError = 'Anthropic response not valid JSON'
    } catch (err) {
      lastError = String((err as Error)?.message ?? err)
    }
  }

  if (!proposals) {
    return new Response(
      JSON.stringify({ fact_id: factId, candidates: [], error: lastError ?? 'Failed to obtain proposals' }),
      { status: 200, headers: jsonHeaders },
    )
  }

  const candidates: Candidate[] = await Promise.all(
    proposals.map(async (p) => {
      const candidate: Candidate = {
        url: p.url,
        source_type: p.source_type,
        excerpt: p.excerpt,
        verified_reachable: false,
        excerpt_match: false,
        status_code: null,
        error: null,
      }
      try {
        const res = await fetchWithTimeout(p.url, FETCH_TIMEOUT_MS)
        candidate.status_code = res.status
        if (res.status >= 200 && res.status < 300) {
          candidate.verified_reachable = true
          const text = await res.text()
          candidate.excerpt_match = text.toLowerCase().includes(p.excerpt.toLowerCase())
        }
      } catch (err) {
        candidate.error = String((err as Error)?.message ?? err)
      }
      return candidate
    }),
  )

  return new Response(
    JSON.stringify({ fact_id: factId, candidates }),
    { status: 200, headers: jsonHeaders },
  )
})
