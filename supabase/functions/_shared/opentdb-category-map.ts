// OpenTrivia DB category-string -> Trivolta categories.slug lookup.
//
// Unknown categories fall back to "general". Add new mappings here when the
// OpenTrivia DB taxonomy expands. Slugs must match the seeded values in
// supabase/migrations/20240106000000_fact_bank_schema.sql:
//   science, history, geography, film, music, sports, literature, art,
//   pop-culture, general

const MAP: Record<string, string> = {
  'General Knowledge': 'general',
  'Entertainment: Books': 'literature',
  'Entertainment: Film': 'film',
  'Entertainment: Music': 'music',
  'Entertainment: Television': 'film',
  'Entertainment: Video Games': 'pop-culture',
  'Entertainment: Board Games': 'pop-culture',
  'Science & Nature': 'science',
  'Science: Computers': 'science',
  'Science: Mathematics': 'science',
  'Mythology': 'history',
  'Sports': 'sports',
  'Geography': 'geography',
  'History': 'history',
  'Politics': 'general',
  'Art': 'art',
  'Celebrities': 'pop-culture',
  'Animals': 'science',
  'Vehicles': 'general',
  'Entertainment: Comics': 'pop-culture',
  'Science: Gadgets': 'science',
  'Entertainment: Japanese Anime & Manga': 'pop-culture',
  'Entertainment: Cartoon & Animations': 'film',
}

export const FALLBACK_SLUG = 'general'

export function mapOpenTdbCategory(s: string): string {
  return MAP[s] ?? FALLBACK_SLUG
}

export function isKnownOpenTdbCategory(s: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAP, s)
}
