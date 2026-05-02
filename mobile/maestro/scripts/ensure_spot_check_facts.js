// ensure_spot_check_facts.js
//
// Idempotently seeds the minimum data required by test_28_spot_check.yaml:
// one category, three pending facts in that category, and three active
// distractors per fact. Required because supabase/seed.sql is empty;
// without this, get_next_spot_check_fact() returns no rows on a fresh
// `supabase db reset` and the spot-check screen renders the empty state
// instead of the fact-under-review.
//
// Why three facts and not one (per the INSTRUCTIONS): test_28 submits a
// "correct" verdict and then an "incorrect" verdict, so the spot-check
// screen must load a SECOND fact after the first verdict. With only one
// seeded fact the second-fact load returns null, the screen flips to the
// empty state, and the next assertion (`spot-check-incorrect-btn`)
// fails. Three facts gives one buffer for repeat invocations against the
// same DB.
//
// Pattern from ensure_test_user_02.js: Maestro's runScript runtime
// provides the http object (not Node fetch). Service-role REST calls
// only — no psql, no docker exec.
//
// Env vars consumed:
//   SUPABASE_URL          local Supabase project URL
//   SUPABASE_SERVICE_KEY  service-role secret key
//
// Idempotency: each insert is preceded by a "does it already exist?"
// query. Re-runs are safe and a no-op when the seed is already present.

var HEADERS = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
}

var CATEGORY_SLUG = 'spot-check-test'
var CATEGORY_DISPLAY = 'Spot Check Test'
var SOURCE_ORIGIN = 'spot_check_maestro_seed'

var SEED_FACTS = [
  {
    fact: 'What is the capital of France?',
    answer: 'Paris',
    distractors: ['Lyon', 'Marseille', 'Nice']
  },
  {
    fact: 'Who wrote Hamlet?',
    answer: 'William Shakespeare',
    distractors: ['Christopher Marlowe', 'Ben Jonson', 'John Webster']
  },
  {
    fact: 'What is the chemical symbol for gold?',
    answer: 'Au',
    distractors: ['Ag', 'Gd', 'Go']
  }
]

// 1. Ensure the test category exists.
var catList = http.get(
  SUPABASE_URL + '/rest/v1/categories?slug=eq.' + CATEGORY_SLUG + '&select=id',
  { headers: HEADERS }
)
var existingCats = JSON.parse(catList.body)
var categoryId
if (existingCats && existingCats.length > 0) {
  categoryId = existingCats[0].id
} else {
  var catCreate = http.post(SUPABASE_URL + '/rest/v1/categories', {
    headers: HEADERS,
    body: JSON.stringify({
      slug: CATEGORY_SLUG,
      display_name: CATEGORY_DISPLAY,
      verification_standard: 'self-asserted'
    })
  })
  var created = JSON.parse(catCreate.body)
  categoryId = (created && created[0] && created[0].id) ? created[0].id : null
  if (!categoryId) {
    output.spotCheckSeed = 'failed: category insert returned no id'
    throw new Error(output.spotCheckSeed)
  }
}

// 2. Ensure each seed fact exists with 3 active distractors.
var createdFacts = 0
var createdDistractors = 0

for (var i = 0; i < SEED_FACTS.length; i++) {
  var seed = SEED_FACTS[i]
  var encodedFactText = encodeURIComponent(seed.fact)
  var factList = http.get(
    SUPABASE_URL +
      '/rest/v1/facts?category_id=eq.' +
      categoryId +
      '&fact_text=eq.' +
      encodedFactText +
      '&select=id',
    { headers: HEADERS }
  )
  var existingFacts = JSON.parse(factList.body)
  var factId
  if (existingFacts && existingFacts.length > 0) {
    factId = existingFacts[0].id
  } else {
    var factCreate = http.post(SUPABASE_URL + '/rest/v1/facts', {
      headers: HEADERS,
      body: JSON.stringify({
        category_id: categoryId,
        fact_text: seed.fact,
        correct_answer: seed.answer,
        difficulty: 2,
        verification_status: 'pending',
        source_origin: SOURCE_ORIGIN
      })
    })
    var newFact = JSON.parse(factCreate.body)
    factId = (newFact && newFact[0] && newFact[0].id) ? newFact[0].id : null
    if (!factId) {
      output.spotCheckSeed = 'failed: fact insert returned no id for "' + seed.fact + '"'
      throw new Error(output.spotCheckSeed)
    }
    createdFacts += 1
  }

  // Count active distractors for this fact.
  var distList = http.get(
    SUPABASE_URL +
      '/rest/v1/distractors?fact_id=eq.' +
      factId +
      '&is_active=eq.true&select=id',
    { headers: HEADERS }
  )
  var existingDistractors = JSON.parse(distList.body)
  var have = existingDistractors ? existingDistractors.length : 0
  var need = 3 - have
  if (need > 0) {
    var rows = []
    for (var d = 0; d < need; d++) {
      rows.push({
        fact_id: factId,
        distractor_text: seed.distractors[d],
        authored_by: 'imported',
        is_active: true
      })
    }
    http.post(SUPABASE_URL + '/rest/v1/distractors', {
      headers: HEADERS,
      body: JSON.stringify(rows)
    })
    createdDistractors += need
  }
}

if (createdFacts === 0 && createdDistractors === 0) {
  output.spotCheckSeed = 'spot-check seed: ok'
} else {
  output.spotCheckSeed =
    'spot-check seed: created ' +
    createdFacts +
    ' fact(s), ' +
    createdDistractors +
    ' distractor(s)'
}
console.log(output.spotCheckSeed)
