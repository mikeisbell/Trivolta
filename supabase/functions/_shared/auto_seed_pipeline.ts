import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
export const SONNET_MODEL = 'claude-sonnet-4-6'
const FETCH_TIMEOUT_MS = 10_000
const VALID_SOURCE_TYPES = new Set(['wikipedia', 'imdb', 'official_record', 'reference_book', 'other'])
const CONFIDENCE_THRESHOLD = 4
const AMBIGUITY_REJECT = 3
const DISTRACTOR_RETRIES = 2

type ProposedSource = {
  url: string
  source_type: string
  proposed_excerpt: string
  verified_reachable: boolean
  excerpt_match: boolean
  http_status_code: number | null
  fetch_error: string | null
  fetch_duration_ms: number | null
  inserted_into_fact_sources: boolean
}

type CrossCheckResult = {
  supported: boolean
  confidence: number
  reasoning: string
}

type Telemetry = {
  fact_id: string
  outcome: 'auto_verified' | 'needs_review' | 'failed' | null
  failure_stage: 'citation' | 'mechanical_check' | 'cross_check' | 'distractor_generation' | 'db_write' | 'unknown' | null
  failure_reason: string | null
  cross_check: CrossCheckResult | null
  cross_check_model: string | null
  citation_model: string | null
  proposed_sources: ProposedSource[]
  distractors_attempted: boolean
  distractors_succeeded: boolean
  distractors_added: number
  total_input_tokens: number
  total_output_tokens: number
  haiku_input_tokens: number
  haiku_output_tokens: number
  sonnet_input_tokens: number
  sonnet_output_tokens: number
  estimated_cost_usd: number
  start_ms: number
}

function nowMs(): number {
  return Date.now()
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

function extractJson(text: string): string | null {
  const t = text.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end < 0) return null
  return t.slice(start, end + 1)
}

function parseProposals(text: string): Array<{ url: string; source_type: string; excerpt: string }> | null {
  const json = extractJson(text)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { sources?: Array<{ url: string; source_type: string; excerpt: string }> }
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

function parseCrossCheck(text: string): CrossCheckResult | null {
  const json = extractJson(text)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { supported?: unknown; confidence?: unknown; reasoning?: unknown }
    if (typeof parsed.supported !== 'boolean') return null
    const conf = typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence)
    if (!Number.isFinite(conf) || conf < 1 || conf > 5) return null
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
    return { supported: parsed.supported, confidence: Math.round(conf), reasoning }
  } catch {
    return null
  }
}

function trackTokens(
  t: Telemetry,
  model: string,
  msg: { usage?: { input_tokens?: number; output_tokens?: number } } | null,
) {
  if (!msg?.usage) return
  const i = msg.usage.input_tokens ?? 0
  const o = msg.usage.output_tokens ?? 0
  t.total_input_tokens += i
  t.total_output_tokens += o
  if (model === HAIKU_MODEL) {
    t.haiku_input_tokens += i
    t.haiku_output_tokens += o
  } else if (model === SONNET_MODEL) {
    t.sonnet_input_tokens += i
    t.sonnet_output_tokens += o
  }
}

export async function runAutoSeed(
  factId: string,
  service: ReturnType<typeof createClient>,
  anthropic: Anthropic,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const t: Telemetry = {
    fact_id: factId,
    outcome: null,
    failure_stage: null,
    failure_reason: null,
    cross_check: null,
    cross_check_model: null,
    citation_model: null,
    proposed_sources: [],
    distractors_attempted: false,
    distractors_succeeded: false,
    distractors_added: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    haiku_input_tokens: 0,
    haiku_output_tokens: 0,
    sonnet_input_tokens: 0,
    sonnet_output_tokens: 0,
    estimated_cost_usd: 0,
    start_ms: nowMs(),
  }

  const { data: fact, error: factErr } = await service
    .from('facts')
    .select('id, fact_text, correct_answer, verification_status, is_high_value, category_id')
    .eq('id', factId)
    .maybeSingle()
  if (factErr) {
    t.outcome = 'failed'
    t.failure_stage = 'db_write'
    t.failure_reason = (factErr.message || 'fact lookup failed').slice(0, 500)
    await writeTelemetry(service, t)
    return { status: 503, body: buildResponse(t, factId) }
  }
  if (!fact) {
    return { status: 404, body: { error: 'Fact not found' } }
  }
  if (fact.verification_status !== 'pending') {
    return { status: 400, body: { error: 'Only pending facts are eligible for auto-seed' } }
  }

  // Citation pass via Haiku
  t.citation_model = HAIKU_MODEL
  const citePrompt = `You will propose 2 source URLs that confirm this trivia fact.
Fact: ${fact.fact_text}
Correct answer: ${fact.correct_answer}

For each source, return:
- url: a public URL where the fact can be verified
- source_type: one of "wikipedia", "imdb", "official_record", "reference_book", "other"
- excerpt: a short verbatim quote (no more than 30 words) that should appear on the fetched page

Return ONLY JSON. No markdown. Shape:
{"sources":[{"url":"...","source_type":"wikipedia","excerpt":"..."},{"url":"...","source_type":"...","excerpt":"..."}]}`

  let proposals: Array<{ url: string; source_type: string; excerpt: string }> | null = null
  let citationError: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 600,
        system: 'You propose source URLs for trivia fact verification. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: citePrompt }],
      })
      trackTokens(t, HAIKU_MODEL, msg)
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const parsed = parseProposals(text)
      if (parsed && parsed.length > 0) {
        proposals = parsed.slice(0, 2)
        break
      }
      citationError = 'Anthropic response not valid JSON'
    } catch (err) {
      citationError = String((err as Error)?.message ?? err)
    }
  }

  if (!proposals) {
    t.outcome = 'failed'
    t.failure_stage = 'citation'
    t.failure_reason = (citationError ?? 'no proposals').slice(0, 500)
    await writeTelemetry(service, t)
    return { status: 503, body: buildResponse(t, factId) }
  }

  const candidates: ProposedSource[] = await Promise.all(
    proposals.map(async (p) => {
      const candidate: ProposedSource = {
        url: p.url,
        source_type: p.source_type,
        proposed_excerpt: p.excerpt,
        verified_reachable: false,
        excerpt_match: false,
        http_status_code: null,
        fetch_error: null,
        fetch_duration_ms: null,
        inserted_into_fact_sources: false,
      }
      const fetchStart = nowMs()
      try {
        const res = await fetchWithTimeout(p.url, FETCH_TIMEOUT_MS)
        candidate.http_status_code = res.status
        if (res.status >= 200 && res.status < 300) {
          candidate.verified_reachable = true
          const text = await res.text()
          candidate.excerpt_match = text.toLowerCase().includes(p.excerpt.toLowerCase())
        }
      } catch (err) {
        candidate.fetch_error = String((err as Error)?.message ?? err).slice(0, 500)
      } finally {
        candidate.fetch_duration_ms = nowMs() - fetchStart
      }
      return candidate
    }),
  )
  t.proposed_sources = candidates

  const passed = candidates.filter((c) => c.verified_reachable && c.excerpt_match)

  if (passed.length < 2) {
    t.outcome = 'needs_review'
    t.failure_stage = 'mechanical_check'
    t.failure_reason = 'insufficient_mechanical_sources'
    await writeNeedsReview(service, fact.id as string, candidates, t)
    await writeTelemetry(service, t)
    return { status: 200, body: buildResponse(t, factId) }
  }

  t.cross_check_model = SONNET_MODEL
  const excerptList = passed
    .map((c, i) => `Source ${i + 1} (${c.source_type}): "${c.proposed_excerpt}"`)
    .join('\n')
  const crossPrompt = `Given this trivia fact, the stated correct answer, and these source excerpts, decide whether the correct answer is supported by the sources.
Fact: ${fact.fact_text}
Stated correct answer: ${fact.correct_answer}

Source excerpts (already verified to appear on public web pages):
${excerptList}

Rate confidence 1 (clearly unsupported) to 5 (clearly supported). Be conservative: if the excerpts do not directly state or imply the correct answer, mark supported=false even if the answer is plausibly true.

Return ONLY JSON. No markdown. Shape:
{"supported": true|false, "confidence": 1-5, "reasoning": "<one short paragraph>"}`

  let cross: CrossCheckResult | null = null
  let crossError: string | null = null
  try {
    const msg = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 500,
      system: 'You verify whether trivia answers are supported by their cited source excerpts. Be conservative. Return ONLY valid JSON. No markdown.',
      messages: [{ role: 'user', content: crossPrompt }],
    })
    trackTokens(t, SONNET_MODEL, msg)
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    cross = parseCrossCheck(text)
    if (!cross) crossError = 'cross-check JSON parse failed'
  } catch (err) {
    crossError = String((err as Error)?.message ?? err)
  }

  if (!cross) {
    t.outcome = 'failed'
    t.failure_stage = 'cross_check'
    t.failure_reason = (crossError ?? 'cross_check_no_response').slice(0, 500)
    await writeTelemetry(service, t)
    return { status: 503, body: buildResponse(t, factId) }
  }

  t.cross_check = cross

  if (cross.supported && cross.confidence >= CONFIDENCE_THRESHOLD) {
    const insertOk = await writeAutoVerify(service, fact.id as string, candidates, t)
    if (!insertOk) {
      t.outcome = 'failed'
      t.failure_stage = 'db_write'
      t.failure_reason = (t.failure_reason ?? 'fact_sources insert failed').slice(0, 500)
      await writeTelemetry(service, t)
      return { status: 503, body: buildResponse(t, factId) }
    }

    if (!fact.is_high_value) {
      await maybeGenerateDistractors(service, anthropic, {
        id: fact.id as string,
        fact_text: fact.fact_text as string,
        correct_answer: fact.correct_answer as string,
      }, t)
    }

    const { error: updErr } = await service
      .from('facts')
      .update({
        verification_status: 'verified',
        verified_at: new Date().toISOString(),
      })
      .eq('id', fact.id)
    if (updErr) {
      t.outcome = 'failed'
      t.failure_stage = 'db_write'
      t.failure_reason = (updErr.message || 'verified flip failed').slice(0, 500)
      await writeTelemetry(service, t)
      return { status: 503, body: buildResponse(t, factId) }
    }

    t.outcome = 'auto_verified'
    await writeTelemetry(service, t)
    return { status: 200, body: buildResponse(t, factId) }
  }

  t.outcome = 'needs_review'
  t.failure_stage = 'cross_check'
  t.failure_reason = cross.supported ? 'cross_check_low_confidence' : 'cross_check_unsupported'
  await writeNeedsReview(service, fact.id as string, candidates, t)
  await writeTelemetry(service, t)
  return { status: 200, body: buildResponse(t, factId) }
}

async function writeAutoVerify(
  service: ReturnType<typeof createClient>,
  factId: string,
  candidates: ProposedSource[],
  t: Telemetry,
): Promise<boolean> {
  const passed = candidates.filter((c) => c.verified_reachable && c.excerpt_match)
  const rows = passed.map((c) => ({
    fact_id: factId,
    url: c.url,
    citation: c.url,
    excerpt: c.proposed_excerpt,
    source_type: c.source_type,
    verified_reachable: true,
    verified_at: new Date().toISOString(),
    added_by_ai: true,
    human_confirmed: true,
  }))
  if (rows.length === 0) return true
  const { error } = await service.from('fact_sources').insert(rows)
  if (error) {
    t.failure_reason = error.message.slice(0, 500)
    return false
  }
  for (const c of candidates) {
    if (c.verified_reachable && c.excerpt_match) c.inserted_into_fact_sources = true
  }
  return true
}

async function writeNeedsReview(
  service: ReturnType<typeof createClient>,
  factId: string,
  candidates: ProposedSource[],
  t: Telemetry,
): Promise<void> {
  const passed = candidates.filter((c) => c.verified_reachable && c.excerpt_match)
  if (passed.length > 0) {
    const rows = passed.map((c) => ({
      fact_id: factId,
      url: c.url,
      citation: c.url,
      excerpt: c.proposed_excerpt,
      source_type: c.source_type,
      verified_reachable: true,
      verified_at: new Date().toISOString(),
      added_by_ai: true,
      human_confirmed: false,
    }))
    const { error } = await service.from('fact_sources').insert(rows)
    if (error) {
      console.error('needs_review fact_sources insert failed:', error.message)
    } else {
      for (const c of candidates) {
        if (c.verified_reachable && c.excerpt_match) c.inserted_into_fact_sources = true
      }
    }
  }
  const { error: updErr } = await service
    .from('facts')
    .update({ verification_status: 'needs_review' })
    .eq('id', factId)
  if (updErr) {
    console.error('needs_review status update failed:', updErr.message)
    if (!t.failure_reason) t.failure_reason = updErr.message.slice(0, 500)
  }
}

async function maybeGenerateDistractors(
  service: ReturnType<typeof createClient>,
  anthropic: Anthropic,
  fact: { id: string; fact_text: string; correct_answer: string },
  t: Telemetry,
): Promise<void> {
  const { data: existing, error: existingErr } = await service
    .from('distractors')
    .select('id')
    .eq('fact_id', fact.id)
    .eq('is_active', true)
  if (existingErr) {
    console.error('distractor lookup failed:', existingErr.message)
    return
  }
  if ((existing?.length ?? 0) >= 3) return

  t.distractors_attempted = true

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

  for (let attempt = 0; attempt <= DISTRACTOR_RETRIES; attempt++) {
    let distractors: string[] | null = null
    try {
      const msg = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 400,
        system: 'You generate distractors for trivia questions. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: generatePrompt }],
      })
      trackTokens(t, HAIKU_MODEL, msg)
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const json = extractJson(text)
      if (json) {
        const parsed = JSON.parse(json) as { distractors?: string[] }
        if (parsed?.distractors && parsed.distractors.length === 3 && parsed.distractors.every((d) => typeof d === 'string' && d.length > 0)) {
          distractors = parsed.distractors
        }
      }
    } catch {
      // retry
    }
    if (!distractors) continue

    let scores: number[] | null = null
    try {
      const msg = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 200,
        system: 'You validate trivia distractors. Return ONLY valid JSON. No markdown.',
        messages: [{ role: 'user', content: buildValidationPrompt(distractors) }],
      })
      trackTokens(t, HAIKU_MODEL, msg)
      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const json = extractJson(text)
      if (json) {
        const parsed = JSON.parse(json) as { scores?: number[] }
        if (parsed?.scores && parsed.scores.length === 3 && parsed.scores.every((n) => typeof n === 'number')) {
          scores = parsed.scores
        }
      }
    } catch {
      // retry
    }

    if (!scores) continue

    if (scores.every((n) => n < AMBIGUITY_REJECT)) {
      const rows = distractors.map((text, i) => ({
        fact_id: fact.id,
        distractor_text: text,
        authored_by: 'ai-cached',
        is_active: true,
        quality_score: ambiguityToQuality(scores![i] ?? 3),
      }))
      const { error: insertErr } = await service.from('distractors').insert(rows)
      if (!insertErr) {
        t.distractors_succeeded = true
        t.distractors_added = rows.length
      }
      return
    }
  }
}

function ambiguityToQuality(score: number): number {
  const inverted = Math.round(6 - score)
  return Math.max(1, Math.min(5, inverted))
}

async function writeTelemetry(
  service: ReturnType<typeof createClient>,
  t: Telemetry,
): Promise<void> {
  try {
    const cost = await computeCost(service, t)
    t.estimated_cost_usd = cost
    const totalDuration = nowMs() - t.start_ms
    const sourcesAttempted = t.proposed_sources.length
    const sourcesConfirmed = t.proposed_sources.filter((c) => c.verified_reachable && c.excerpt_match).length
    const { data: logRow, error: logErr } = await service
      .from('fact_auto_seed_log')
      .insert({
        fact_id: t.fact_id,
        outcome: t.outcome,
        failure_stage: t.failure_stage,
        failure_reason: t.failure_reason,
        cross_check_confidence: t.cross_check?.confidence ?? null,
        cross_check_reasoning: t.cross_check?.reasoning ?? null,
        cross_check_supported: t.cross_check?.supported ?? null,
        cross_check_model: t.cross_check_model,
        citation_model: t.citation_model,
        sources_attempted: sourcesAttempted,
        sources_confirmed: sourcesConfirmed,
        distractors_attempted: t.distractors_attempted,
        distractors_succeeded: t.distractors_succeeded,
        total_input_tokens: t.total_input_tokens,
        total_output_tokens: t.total_output_tokens,
        estimated_cost_usd: cost,
        total_duration_ms: totalDuration,
      })
      .select('id')
      .single()
    if (logErr || !logRow) {
      console.error('fact_auto_seed_log insert failed:', logErr?.message ?? 'no row returned')
      return
    }
    if (t.proposed_sources.length > 0) {
      const sourceRows = t.proposed_sources.map((p) => ({
        auto_seed_log_id: logRow.id,
        fact_id: t.fact_id,
        url: p.url,
        source_type: p.source_type,
        proposed_excerpt: p.proposed_excerpt,
        verified_reachable: p.verified_reachable,
        excerpt_match: p.excerpt_match,
        http_status_code: p.http_status_code,
        fetch_error: p.fetch_error,
        fetch_duration_ms: p.fetch_duration_ms,
        inserted_into_fact_sources: p.inserted_into_fact_sources,
      }))
      const { error: srcErr } = await service.from('fact_auto_seed_sources').insert(sourceRows)
      if (srcErr) {
        console.error('fact_auto_seed_sources insert failed:', srcErr.message)
      }
    }
  } catch (err) {
    console.error('telemetry write threw:', String((err as Error)?.message ?? err))
  }
}

async function computeCost(
  service: ReturnType<typeof createClient>,
  t: Telemetry,
): Promise<number> {
  let total = 0
  if (t.haiku_input_tokens || t.haiku_output_tokens) {
    const { data } = await service.rpc('estimate_anthropic_cost', {
      model: HAIKU_MODEL,
      input_tokens: t.haiku_input_tokens,
      output_tokens: t.haiku_output_tokens,
    })
    total += Number(data ?? 0)
  }
  if (t.sonnet_input_tokens || t.sonnet_output_tokens) {
    const { data } = await service.rpc('estimate_anthropic_cost', {
      model: SONNET_MODEL,
      input_tokens: t.sonnet_input_tokens,
      output_tokens: t.sonnet_output_tokens,
    })
    total += Number(data ?? 0)
  }
  return total
}

function buildResponse(t: Telemetry, factId: string): Record<string, unknown> {
  const sourcesAttempted = t.proposed_sources.length
  const sourcesConfirmed = t.proposed_sources.filter((c) => c.verified_reachable && c.excerpt_match).length
  return {
    fact_id: factId,
    outcome: t.outcome,
    confidence: t.cross_check?.confidence ?? null,
    reasoning: t.cross_check?.reasoning ?? null,
    sources_attempted: sourcesAttempted,
    sources_confirmed: sourcesConfirmed,
    distractors_added: t.distractors_added,
    input_tokens: t.total_input_tokens,
    output_tokens: t.total_output_tokens,
    estimated_cost_usd: t.estimated_cost_usd ?? 0,
    duration_ms: nowMs() - t.start_ms,
    failure_stage: t.failure_stage,
    failure_reason: t.failure_reason,
  }
}
