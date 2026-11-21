import { useEffect, useState } from 'react'
import { cardLabel, getCard, getScenario } from './cards'
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
    {url && <audio controls preload="metadata" aria-label="내 녹음 재생" src={url} onError={() => setError(true)} />}
    {error && <p role="alert">이 브라우저에서 녹음 파일을 재생하지 못했어요. 녹음한 브라우저에서 다시 열어 보세요.</p>}
  </>
}

export function FeedbackView({ feedback, expression }: { feedback: Feedback; expression: string }) {
  const scores = [
    ['상황 전달', feedback.delivery],
    ['목표 표현 활용', feedback.target],
    ['회화 자연스러움', feedback.naturalness],
  ] as const
  const correction = { grammar: '문법 오류', style: '선택적인 말투 개선', practice: '다음 연습' }[feedback.correctionType]
  return <div className="feedback">
    <h2>AI 피드백</h2>
    <dl className="scores">{scores.map(([label, rating]) => <div key={label}>
      <dt>{label}</dt><dd data-rating={rating}>{ratingLabels[rating]}</dd>
    </div>)}</dl>
    <div className="feedback-notes">
      <p><strong>잘 전달된 부분</strong>{feedback.strength}</p>
      <p><strong>우선 고칠 부분 <span className="eyebrow">· {correction}</span></strong>{feedback.priority}</p>
    </div>
    <div className="answer"><strong>자연스러운 문장</strong><p lang="en">{feedback.suggestion}</p></div>
    {feedback.target !== 'good' && <p className="target-tip">다시 말할 때 <span lang="en">{expression}</span>를 넣어 보세요.</p>}
  </div>
}

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

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
  if (!recordings.length) return <p className="muted">아직 저장한 녹음이 없어요. 오늘의 연습에서 첫 문장을 말해 보세요.</p>
  return <>
    <label className="recording-filter">카드별로 보기
      <select value={activeFilter} onChange={event => { setCardFilter(event.target.value); setConfirmId('') }}>
        <option value="">모든 카드</option>
        {cardIds.map(id => {
          const card = getCard(id)
          return card && <option key={id} value={id}>{cardLabel(card)} · {card.practice.title}</option>
        })}
      </select>
    </label>
    <ul className="saved-list recording-list">{visible.map(recording => {
    const card = getCard(recording.cardId ?? '607')
    return <li key={recording.id}>
    <div className="recording-row"><div>
      <span className="eyebrow">{card && cardLabel(card) + ' · '}{dateTime.format(new Date(recording.createdAt))} · {recording.attemptNumber}번째 시도</span>
      <h2>{card && getScenario(card, recording.scene)?.title}</h2>
    </div>
    <button className="button secondary" onClick={() => setConfirmId(recording.id)} disabled={deleting}>삭제</button></div>
    <AudioPlayer audio={recording.audio} />
    {recording.transcript && <p lang="en">{recording.transcript}</p>}
    {recording.feedback ? <details><summary>AI 피드백 보기</summary><FeedbackView feedback={recording.feedback} expression={card?.expression ?? ''} /></details>
      : <button className="button secondary" onClick={() => onOpen(recording)} disabled={deleting}>이 녹음 이어서 확인</button>}
    {confirmId === recording.id && <div className="delete-confirm">
      <p>이 녹음과 받아쓰기, 피드백을 삭제할까요?</p>
      <button className="button secondary" onClick={() => setConfirmId('')} disabled={deleting}>취소</button>
      <button className="button primary" disabled={deleting} onClick={async () => {
        setDeleting(true)
        try { await onDelete(recording.id); setConfirmId('') } finally { setDeleting(false) }
      }}>녹음 삭제</button>
    </div>}
  </li>})}</ul>
  </>
}
