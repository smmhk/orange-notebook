import { useEffect, useState } from 'react'
import { cardLabel, getCard } from './cards'
import { ratingLabels } from './feedback'
import type { Feedback } from './feedback'
import type { Recording } from './recordings'

export function AudioPlayer({ audio }: { audio: Blob }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(audio)
    setUrl(objectUrl)
    setError(false)
    return () => URL.revokeObjectURL(objectUrl)
  }, [audio])
  return <>
    {url && <audio controls preload="metadata" aria-label="Play your recording" src={url} onError={() => setError(true)} />}
    {error && <p role="alert">Could not play the recording. Try the browser you recorded it in.</p>}
  </>
}

export function FeedbackView({ feedback, expression }: { feedback: Feedback; expression: string }) {
  const scores = [
    ['How you answered', feedback.delivery],
    ['Target expression', feedback.target],
    ['Natural phrasing', feedback.naturalness],
  ] as const
  const correction = { grammar: 'Grammar', style: 'Optional style improvement', practice: 'Next step' }[feedback.correctionType]
  return <div className="feedback">
    <h2>AI feedback</h2>
    <dl className="scores">{scores.map(([label, rating]) => <div key={label}>
      <dt>{label}</dt><dd data-rating={rating}>{ratingLabels[rating]}</dd>
    </div>)}</dl>
    <div className="feedback-notes">
      <p><strong>What worked</strong>{feedback.strength}</p>
      <p><strong>What to improve <span className="eyebrow">· {correction}</span></strong>{feedback.priority}</p>
    </div>
    <div className="answer"><strong>Natural example</strong><p lang="en">{feedback.suggestion}</p></div>
    {feedback.target !== 'good' && <p className="target-tip">Try using <span lang="en">{expression}</span> in your next answer.</p>}
  </div>
}

const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export function RecordingList({ recordings, onOpen, onDelete }: {
  recordings: Recording[]
  onOpen: (recording: Recording) => void
  onDelete: (id: string) => Promise<void>
}) {
  const [confirmId, setConfirmId] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [cardFilter, setCardFilter] = useState('')
  const cardIds = [...new Set(recordings.map(recording => recording.cardId ?? '607'))]
  const activeFilter = cardIds.includes(cardFilter) ? cardFilter : ''
  const visible = activeFilter ? recordings.filter(recording => (recording.cardId ?? '607') === activeFilter) : recordings
  if (!recordings.length) return <p className="muted">Your recordings will appear here after you practice.</p>
  return <>
    <label className="recording-filter">Filter by card
      <select value={activeFilter} onChange={event => { setCardFilter(event.target.value); setConfirmId('') }}>
        <option value="">All cards</option>
        {cardIds.map(id => {
          const card = getCard(id)
          return card && <option key={id} value={id}>{cardLabel(card)}</option>
        })}
      </select>
    </label>
    <ul className="saved-list recording-list">{visible.map(recording => {
    const card = getCard(recording.cardId ?? '607')
    return <li key={recording.id}>
    <div className="recording-row"><div>
      <span className="eyebrow">{card && cardLabel(card) + ' · '}{dateTime.format(new Date(recording.createdAt))} · Attempt {recording.attemptNumber}</span>
    </div>
    <button className="button secondary" onClick={() => setConfirmId(recording.id)} disabled={deleting}>Delete</button></div>
    <AudioPlayer audio={recording.audio} />
    {recording.transcript && <p lang="en">{recording.transcript}</p>}
    {recording.feedback ? <details><summary>View AI feedback</summary><FeedbackView feedback={recording.feedback} expression={card?.expression ?? ''} /></details>
      : <button className="button secondary" onClick={() => onOpen(recording)} disabled={deleting}>Open recording</button>}
    {confirmId === recording.id && <div className="delete-confirm">
      <p>Delete this recording, transcript, and feedback?</p>
      <button className="button secondary" onClick={() => setConfirmId('')} disabled={deleting}>Cancel</button>
      <button className="button primary" disabled={deleting} onClick={async () => {
        setDeleting(true)
        try { await onDelete(recording.id); setConfirmId('') } finally { setDeleting(false) }
      }}>Delete recording</button>
    </div>}
  </li>})}</ul>
  </>
}
