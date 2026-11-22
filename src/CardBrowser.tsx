import { useState } from 'react'
import { cardLabel, cards } from './cards'
import type { Card } from './cards'

const batchSize = 20

export function CardBrowser({ onSelect }: { onSelect: (card: Card) => void }) {
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(batchSize)
  const term = query.trim().toLowerCase().replace(/[’‘]/g, "'")
  const numberQuery = term.match(/^#?(\d+)\s*번?$/)?.[1]
  const results = term ? cards.filter(card => numberQuery
    ? card.number === numberQuery || Boolean(card.number && Number(card.number) === Number(numberQuery))
    : [card.expression, card.original, card.meaning].some(value => value.toLowerCase().replace(/[’‘]/g, "'").includes(term))
  ) : cards

  return <section className="catalog" aria-labelledby="catalog-heading">
    <div className="section-head"><h2 id="catalog-heading">Find a card</h2><span>{results.length.toLocaleString('en')}</span></div>
    <label className="eyebrow" htmlFor="card-search">Card number or English expression</label>
    <input id="card-search" type="search" value={query} placeholder="e.g. 607, make it up"
      onChange={event => { setQuery(event.target.value); setVisible(batchSize) }} />
    {results.length ? <ul className="catalog-list">
      {results.slice(0, visible).map(card => <li key={card.id}>
        <button className="catalog-card" onClick={() => onSelect(card)}>
          <span className="eyebrow">{cardLabel(card)}</span><strong lang="en">{card.expression}</strong>
          <span lang="ko">{card.meaning}</span>
        </button>
      </li>)}
    </ul> : <p className="muted">No matching cards.</p>}
    {visible < results.length && <button className="button secondary" onClick={() => setVisible(visible + batchSize)}>Show more cards</button>}
  </section>
}
