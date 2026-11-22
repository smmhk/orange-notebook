import catalog from './data/cards.json' with { type: 'json' }

export interface Scenario {
  title: string
  prompt: string
  example: string
}

interface Source {
  page: number
  endPage?: number
  line: number
  number?: string
  text: string
}

export interface Card {
  id: string
  number?: string
  original: string
  expression: string
  meaning: string
  usage?: string
  sources: Source[]
  practice: Scenario
  transfer: Scenario
  reviews: Scenario[]
}

export const cards: readonly Card[] = catalog
const byId = new Map(cards.map(card => [card.id, card]))

export function getCard(id: unknown): Card | undefined {
  return typeof id === 'string' ? byId.get(id) : undefined
}

export function cardLabel(card: Card) {
  return card.number ? `Card ${card.number} · p. ${card.sources[0].page}` : `Bonus expression · p. ${card.sources[0].page}`
}

export function sourceLabel(card: Card) {
  return card.sources.map(source => {
    const pages = source.endPage && source.endPage !== source.page ? `pp. ${source.page}–${source.endPage}` : `p. ${source.page}`
    return source.number ? `${pages}, card ${source.number}` : pages
  }).join(', ')
}

export type SceneKey = 'practice' | 'transfer' | `review-${number}`

export function reviewKey(card: Card, round: number): SceneKey {
  return `review-${round % card.reviews.length}`
}

export function getScenario(card: Card, key: unknown): Scenario | undefined {
  if (key === 'practice' || key === 'transfer') return card[key]
  if (typeof key !== 'string' || !/^review-\d+$/.test(key)) return undefined
  return card.reviews[Number(key.slice(7))]
}
