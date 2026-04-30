import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import { mapOpenTdbCategory, isKnownOpenTdbCategory } from '../_shared/opentdb-category-map.ts'
import { mapTriviaApiCategory, isKnownTriviaApiCategory, FALLBACK_SLUG } from '../_shared/trivia-api-category-map.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

type OpenTdbRow = {
  category: string
  type: string
  difficulty: string
  question: string
  correct_answer: string
  incorrect_answers: string[]
}

type TriviaApiRow = {
  category: string
  tags?: string[]
  difficulty?: string
  question: { text: string } | string
  correctAnswer: string
  incorrectAnswers: string[]
}

type SourceKind = 'opentdb' | 'trivia_api'
type SourceOrigin = 'opentdb_import' | 'trivia_api_import'

type NormalisedRow = {
  slug: string
  factText: string
  correctAnswer: string
  incorrectAnswers: string[]
  difficulty: number
  sourceOrigin: SourceOrigin
}

type AdaptResult =
  | { kind: 'row'; row: NormalisedRow; unknownCategory: boolean }
  | { kind: 'skip_non_multiple' }
  | { kind: 'error'; message: string }

const DIFFICULTY_MAP: Record<string, number> = { easy: 2, medium: 3, hard: 4 }

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&eacute;': 'é',
  '&Eacute;': 'É',
  '&ouml;': 'ö',
  '&uuml;': 'ü',
  '&auml;': 'ä',
  '&ntilde;': 'ñ',
}

function decodeEntities(input: string): string {
  let s = input
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v)
  s = s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)))
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  return s
}

function stripNbsp(s: string): string {
  return s.replace(/ /g, ' ').trim()
}

function adaptOpenTdb(row: OpenTdbRow): AdaptResult {
  if (row.type !== 'multiple') return { kind: 'skip_non_multiple' }
  const unknownCategory = !isKnownOpenTdbCategory(row.category)
  const slug = mapOpenTdbCategory(row.category)
  const difficulty = DIFFICULTY_MAP[row.difficulty] ?? 3
  const factText = decodeEntities(row.question)
  const correctAnswer = decodeEntities(row.correct_answer)
  const incorrectAnswers = (row.incorrect_answers || []).map(decodeEntities)
  return {
    kind: 'row',
    unknownCategory,
    row: {
      slug,
      factText,
      correctAnswer,
      incorrectAnswers,
      difficulty,
      sourceOrigin: 'opentdb_import',
    },
  }
}

function adaptTriviaApi(row: TriviaApiRow): AdaptResult {
  let questionText: string
  if (typeof row.question === 'string') {
    questionText = row.question
  } else if (row.question && typeof row.question === 'object' && typeof row.question.text === 'string') {
    questionText = row.question.text
  } else {
    return { kind: 'error', message: 'Trivia API row missing question text' }
  }
  const tags = Array.isArray(row.tags) ? row.tags : []
  const slug = mapTriviaApiCategory(row.category, tags)
  // Unknown-category counter: only count when the slug fell through to the
  // fallback AND the category is not one of the two known fallback cases
  // ("General Knowledge", "Food & Drink"), to avoid double-counting expected
  // fall-throughs as unknown.
  const unknownCategory =
    slug === FALLBACK_SLUG &&
    !isKnownTriviaApiCategory(row.category)
  const difficulty = DIFFICULTY_MAP[row.difficulty ?? ''] ?? 3
  const factText = decodeEntities(stripNbsp(questionText))
  const correctAnswer = decodeEntities(stripNbsp(row.correctAnswer ?? ''))
  const incorrectAnswers = (row.incorrectAnswers || []).map((s) => decodeEntities(stripNbsp(s)))
  return {
    kind: 'row',
    unknownCategory,
    row: {
      slug,
      factText,
      correctAnswer,
      incorrectAnswers,
      difficulty,
      sourceOrigin: 'trivia_api_import',
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
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }
  if ((user.app_metadata as Record<string, unknown> | null)?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: jsonHeaders })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }

  let source: SourceKind
  let rows: unknown[]
  if (Array.isArray(body)) {
    source = 'trivia_api'
    rows = body
  } else if (body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)) {
    source = 'opentdb'
    rows = (body as { results: unknown[] }).results
  } else {
    return new Response(
      JSON.stringify({ error: 'Body must be either { results: [...] } (OpenTrivia DB) or [...] (Trivia API)' }),
      { status: 400, headers: jsonHeaders },
    )
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: catRows, error: catErr } = await service
    .from('categories')
    .select('id, slug')
  if (catErr || !catRows) {
    return new Response(JSON.stringify({ error: 'Failed to load categories: ' + String(catErr) }), { status: 503, headers: jsonHeaders })
  }
  const slugToId = new Map<string, string>(catRows.map((r) => [r.slug as string, r.id as string]))

  let imported = 0
  let skipped_non_multiple = 0
  let skipped_unknown_category = 0
  let skipped_duplicate = 0
  let failed = 0
  const errors: Array<{ row_index: number; message: string }> = []
  const imported_ids: string[] = []

  // Per-category fact_text Set: existing DB rows + texts inserted in this batch.
  // Lazily populated the first time we encounter a categoryId — at most one
  // `select fact_text from facts where category_id = $1` per category per batch.
  const factTextsByCategory = new Map<string, Set<string>>()

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    try {
      const adapted: AdaptResult = source === 'opentdb'
        ? adaptOpenTdb(raw as OpenTdbRow)
        : adaptTriviaApi(raw as TriviaApiRow)

      if (adapted.kind === 'skip_non_multiple') {
        skipped_non_multiple++
        continue
      }
      if (adapted.kind === 'error') {
        failed++
        errors.push({ row_index: i, message: adapted.message })
        continue
      }

      const { row, unknownCategory } = adapted
      if (unknownCategory) skipped_unknown_category++

      const categoryId = slugToId.get(row.slug)
      if (!categoryId) {
        failed++
        errors.push({ row_index: i, message: `No category row for slug ${row.slug}` })
        continue
      }

      let knownTexts = factTextsByCategory.get(categoryId)
      if (!knownTexts) {
        const { data: existing, error: existingErr } = await service
          .from('facts')
          .select('fact_text')
          .eq('category_id', categoryId)
        if (existingErr) {
          failed++
          errors.push({ row_index: i, message: `failed to load existing facts: ${existingErr.message}` })
          continue
        }
        knownTexts = new Set((existing ?? []).map((r) => r.fact_text as string))
        factTextsByCategory.set(categoryId, knownTexts)
      }

      if (knownTexts.has(row.factText)) {
        skipped_duplicate++
        continue
      }

      const { data: factInsert, error: factErr } = await service
        .from('facts')
        .insert({
          category_id: categoryId,
          fact_text: row.factText,
          correct_answer: row.correctAnswer,
          difficulty: row.difficulty,
          is_high_value: false,
          verification_status: 'pending',
          source_origin: row.sourceOrigin,
          created_by: user.id,
        })
        .select('id')
        .single()

      if (factErr || !factInsert) {
        failed++
        errors.push({ row_index: i, message: `fact insert failed: ${factErr?.message ?? 'no row returned'}` })
        continue
      }

      const distractorRows = row.incorrectAnswers.map((text) => ({
        fact_id: factInsert.id,
        distractor_text: text,
        authored_by: 'imported',
        is_active: true,
      }))
      if (distractorRows.length > 0) {
        const { error: dErr } = await service.from('distractors').insert(distractorRows)
        if (dErr) {
          failed++
          errors.push({ row_index: i, message: `distractor insert failed: ${dErr.message}` })
          continue
        }
      }
      imported++
      imported_ids.push(factInsert.id as string)
      knownTexts.add(row.factText)
    } catch (err) {
      failed++
      errors.push({ row_index: i, message: String((err as Error)?.message ?? err) })
    }
  }

  return new Response(
    JSON.stringify({ source, imported, imported_ids, skipped_non_multiple, skipped_duplicate, skipped_unknown_category, failed, errors }),
    { status: 200, headers: jsonHeaders },
  )
})
