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
    <div className="section-head"><h2 id="catalog-heading">카드 찾기</h2><span>{results.length.toLocaleString('ko-KR')}개</span></div>
    <label className="eyebrow" htmlFor="card-search">문장 번호 또는 영어 표현</label>
    <input id="card-search" type="search" value={query} placeholder="예: 607, make it up"
      onChange={event => { setQuery(event.target.value); setVisible(batchSize) }} />
    {results.length ? <ul className="catalog-list">
      {results.slice(0, visible).map(card => <li key={card.id}>
        <button className="catalog-card" onClick={() => onSelect(card)}>
          <span className="eyebrow">{cardLabel(card)}</span><strong lang="en">{card.expression}</strong>
          <span>{card.meaning}</span>
        </button>
      </li>)}
    </ul> : <p className="muted">일치하는 카드가 없어요.</p>}
    {visible < results.length && <button className="button secondary" onClick={() => setVisible(visible + batchSize)}>카드 더 보기</button>}
  </section>
}
