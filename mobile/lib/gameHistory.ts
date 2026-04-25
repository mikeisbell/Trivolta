const categoryHistory: Record<string, string[]> = {}

export function getHistory(category: string): string[] {
  return categoryHistory[category] ?? []
}

export function addToHistory(category: string, question: string): void {
  if (!categoryHistory[category]) categoryHistory[category] = []
  categoryHistory[category].push(question)
}

export function clearSessionHistory(): void {
  Object.keys(categoryHistory).forEach(key => delete categoryHistory[key])
}
