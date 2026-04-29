import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'
import { mapOpenTdbCategory, isKnownOpenTdbCategory } from '../_shared/opentdb-category-map.ts'

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

  let body: { results?: OpenTdbRow[] }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }
  const rows = body?.results
  if (!Array.isArray(rows)) {
    return new Response(JSON.stringify({ error: 'Body must contain a results array' }), { status: 400, headers: jsonHeaders })
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
  let failed = 0
  const errors: Array<{ row_index: number; message: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      if (row.type !== 'multiple') {
        skipped_non_multiple++
        continue
      }
      if (!isKnownOpenTdbCategory(row.category)) {
        skipped_unknown_category++
      }
      const slug = mapOpenTdbCategory(row.category)
      const categoryId = slugToId.get(slug)
      if (!categoryId) {
        failed++
        errors.push({ row_index: i, message: `No category row for slug ${slug}` })
        continue
      }
      const difficulty = DIFFICULTY_MAP[row.difficulty] ?? 3
      const factText = decodeEntities(row.question)
      const correct = decodeEntities(row.correct_answer)
      const wrongs = (row.incorrect_answers || []).map(decodeEntities)

      const { data: factInsert, error: factErr } = await service
        .from('facts')
        .insert({
          category_id: categoryId,
          fact_text: factText,
          correct_answer: correct,
          difficulty,
          is_high_value: false,
          verification_status: 'pending',
          source_origin: 'opentdb_import',
          created_by: user.id,
        })
        .select('id')
        .single()

      if (factErr || !factInsert) {
        failed++
        errors.push({ row_index: i, message: `fact insert failed: ${factErr?.message ?? 'no row returned'}` })
        continue
      }

      const distractorRows = wrongs.map((text) => ({
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
    } catch (err) {
      failed++
      errors.push({ row_index: i, message: String((err as Error)?.message ?? err) })
    }
  }

  return new Response(
    JSON.stringify({ imported, skipped_non_multiple, skipped_unknown_category, failed, errors }),
    { status: 200, headers: jsonHeaders },
  )
})
