// The Trivia API (the-trivia-api.com) category + tag -> Trivolta slug lookup.
//
// The Trivia API has 10 top-level categories. Some map directly to Trivolta
// slugs; others need tag-level disambiguation. Unknown categories fall back
// to "general".
//
// Trivolta slugs: science, history, geography, film, music, sports,
//                 literature, art, pop-culture, general

// Top-level category -> slug (used when no tag disambiguation applies)
const CATEGORY_MAP: Record<string, string> = {
  'Geography': 'geography',
  'History': 'history',
  'Science': 'science',
  'Music': 'music',
  'Film & TV': 'film',
  'Sport & Leisure': 'sports',
  'General Knowledge': 'general',
  'Society & Culture': 'pop-culture',
  // Arts & Literature splits into art vs literature via tags (see below)
  'Arts & Literature': 'literature', // default; overridden by tags
  // Food & Drink has no Trivolta category — fall back to general
  'Food & Drink': 'general',
}

// Tag-level overrides — checked BEFORE the category-level mapping.
// First matching tag wins. Tags come from the API's `tags` array field.
const TAG_OVERRIDES: Record<string, string> = {
  // Arts & Literature disambiguation
  'arts': 'art',
  'fine_arts': 'art',
  'painting': 'art',
  'sculpture': 'art',
  'architecture': 'art',
  'literature': 'literature',
  'novels': 'literature',
  'poetry': 'literature',
  'books': 'literature',
  'authors': 'literature',
  // Society & Culture sub-tags that map more specifically
  'celebrities': 'pop-culture',
  'pop_culture': 'pop-culture',
  'movies': 'film',
  'television': 'film',
  'tv': 'film',
}

export const FALLBACK_SLUG = 'general'

/**
 * Maps a Trivia API category + tags to a Trivolta category slug.
 * @param category  The top-level category string (e.g. "Arts & Literature")
 * @param tags      The tags array from the API response (e.g. ["arts", "painting"])
 */
export function mapTriviaApiCategory(category: string, tags: string[] = []): string {
  // Check tag overrides first
  for (const tag of tags) {
    const override = TAG_OVERRIDES[tag.toLowerCase()]
    if (override) return override
  }
  // Fall back to top-level category mapping
  return CATEGORY_MAP[category] ?? FALLBACK_SLUG
}

export function isKnownTriviaApiCategory(category: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, category)
}
