import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { cards, cardLabel, getCard, getScenario, reviewKey, sourceLabel } from './cards'
import type { Card, SceneKey } from './cards'
import { feedbackInstructions, isFeedback } from './feedback'
import { initialProgress, legacyProgress, localDay } from './progress'
import { deleteRecording, getRecording, listRecordings, readProgress, saveFeedback, saveRecording, setPracticeStep, updateTranscript } from './recordings'
import type { Recording } from './recordings'
import { AudioPlayer, FeedbackView, RecordingList } from './RecordingViews'
import { CardBrowser } from './CardBrowser'
import { createRecorder, maxSeconds, openMicrophone } from './recorder'
import { audioLimitMessage, maxAudioBytes } from './audioFormat'
import './style.css'

type Screen = 'home' | 'practice' | 'review' | 'recordings'
type Activity = 'idle' | 'permission' | 'recording' | 'saving' | 'transcribing' | 'evaluating'
const dateLabel = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' })
const storageMessage = '이 브라우저에 저장하거나 불러오지 못했어요. 저장 공간과 개인 정보 설정을 확인한 뒤 다시 시도해 주세요.'

function dayLabel(day: string) {
  return dateLabel.format(new Date(day + 'T12:00:00'))
}

function Fruit({ slice = false }: { slice?: boolean }) {
  return <span aria-hidden="true" className={slice ? 'slice' : 'fruit'} />
}

async function requestService(path: string, body: BodyInit, type: string) {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': type }, body,
      signal: AbortSignal.timeout(50000),
    })
  } catch {
    throw new Error('서비스에 연결하지 못했어요. 네트워크를 확인한 뒤 같은 녹음으로 다시 시도해 주세요.')
  }
  if (response.status === 413 && path === '/api/transcribe') throw new Error(audioLimitMessage)
  const result = await response.json().catch(() => null)
  if (!response.ok || !result) throw new Error(result?.error || '서비스 응답을 읽을 수 없어요. 잠시 뒤 다시 시도해 주세요.')
  return result
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [progressByCard, setProgressByCard] = useState(() => ({ '607': legacyProgress() }) as Record<string, typeof initialProgress>)
  const [card, setCard] = useState(() => getCard('607')!)
  const progress = progressByCard[card.id] ?? initialProgress
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [scene, setScene] = useState<SceneKey>('practice')
  const [attemptNumber, setAttemptNumber] = useState(1)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [activity, setActivity] = useState<Activity>('idle')
  const [seconds, setSeconds] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [error, setError] = useState('')
  const [today, setToday] = useState(localDay)
  const [reward, setReward] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [openedRecording, setOpenedRecording] = useState(false)
  const [persisted, setPersisted] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = activity !== 'idle'
  const isDue = (item?: typeof initialProgress) => Boolean(!item?.earned && item?.nextReview && item.nextReview <= today)
  const dueCards = cards.filter(entry => isDue(progressByCard[entry.id]))
  const due = isDue(progress)
  const nextCard = cards.find(entry => {
    const item = progressByCard[entry.id]
    return !item?.earned && !item?.nextReview
  })
  const orangeCount = Object.values(progressByCard).filter(entry => entry.earned).length
  const reviewStatus = dueCards.length ? `오늘 복습할 카드 ${dueCards.length}개` : '오늘 복습할 카드가 없어요'
  const scenario = getScenario(card, scene) ?? card.practice

  async function refresh() {
    try {
      const [savedRecordings, savedProgress] = await Promise.all([listRecordings(), readProgress()])
      setRecordings(savedRecordings)
      setProgressByCard(savedProgress)
    } catch {
      setError(storageMessage)
    }
  }

  useEffect(() => {
    void refresh()
    const update = () => { setToday(localDay()); void refresh() }
    const timer = window.setInterval(() => setToday(localDay()), 15000)
    window.addEventListener('focus', update)
    return () => { window.removeEventListener('focus', update); window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (screen !== 'home') heading.current?.focus()
    window.scrollTo(0, 0)
  }, [screen, scene, card.id])

  useEffect(() => {
    if (activity !== 'recording') return
    const started = Date.now()
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000)
      setSeconds(Math.min(elapsed, maxSeconds))
      if (elapsed >= maxSeconds) stopRecording()
    }, 250)
    return () => window.clearInterval(timer)
  }, [activity])

  function resetAttempt() {
    setRecording(null)
    setPersisted(false)
    setDraft('')
    setCopyStatus('')
    setEditing(false)
    setError('')
    setReward(false)
    setRevealed(false)
    setSeconds(0)
  }

  async function navigate(destination: Screen, selected?: Card) {
    if (busy) return
    resetAttempt()
    setOpenedRecording(false)
    setAttemptNumber(1)
    setToday(localDay())
    setScreen(destination)
    if (selected) {
      setCard(selected)
      const selectedProgress = progressByCard[selected.id] ?? initialProgress
      setScene(destination === 'review' ? reviewKey(selected, selectedProgress.reviewRound) : selectedProgress.practiceStep)
    } else if (destination === 'review') {
      setScene('practice')
    }
    await refresh()
  }

  function remove(id: string) {
    return deleteRecording(id).then(refresh).catch(() => setError(storageMessage))
  }

  function openSaved(saved: Recording) {
    const selected = getCard(saved.cardId ?? '607')
    if (!selected) return
    resetAttempt()
    setCard(selected)
    setScene(saved.scene)
    setRecording(saved)
    setPersisted(true)
    setAttemptNumber(saved.attemptNumber)
    setOpenedRecording(true)
    setScreen(saved.scene.startsWith('review-') ? 'review' : 'practice')
  }

  async function transcribe(saved: Recording, persistFirst: boolean) {
    setError('')
    setActivity('saving')
    if (persistFirst) {
      try {
        await saveRecording(saved)
        setPersisted(true)
        void refresh()
      } catch {
        setError(storageMessage)
        setActivity('idle')
        return
      }
    }
    if (saved.audio.size > maxAudioBytes) {
      setError(audioLimitMessage)
      setActivity('idle')
      return
    }
    setActivity('transcribing')
    try {
      const result = await requestService('/api/transcribe', saved.audio, saved.audio.type || 'application/octet-stream')
      if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 3000) {
        throw new Error('받아쓰기 결과가 비어 있어요. 같은 녹음으로 다시 시도하거나 다시 말해 보세요.')
      }
      try {
        const next = await updateTranscript(saved.id, result.text.trim())
        if (!next) throw new Error('Recording is unavailable')
        setRecording(next)
        void refresh()
      } catch { setError(storageMessage) }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '받아쓰기에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setActivity('idle')
    }
  }

  async function startRecording() {
    if (busy) return
    setError('')
    setActivity('permission')
    const recordedDay = localDay()
    const eligible = screen === 'review' && !revealed && !openedRecording && !progress.earned &&
      Boolean(progress.nextReview && progress.nextReview <= recordedDay && scene === reviewKey(card, progress.reviewRound))
    let stream: MediaStream | undefined
    try {
      stream = await openMicrophone()
      const current = createRecorder(stream)
      const chunks: Blob[] = []
      let failed = false
      const release = () => {
        stream?.getTracks().forEach(track => track.stop())
        if (recorder.current === current) recorder.current = null
      }
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      current.onerror = () => {
        failed = true
        release()
        setError('녹음이 중단됐어요. 마이크 연결을 확인하고 다시 녹음해 주세요.')
        setActivity('idle')
      }
      current.onstop = () => {
        release()
        if (failed) return
        const audio = new Blob(chunks, { type: chunks[0]?.type || current.mimeType })
        if (!audio.size) {
          setError('저장할 음성이 없어요. 마이크에 가까이 대고 다시 녹음해 주세요.')
          setActivity('idle')
          return
        }
        const saved: Recording = {
          id: crypto.randomUUID(), cardId: card.id, scene, createdAt: new Date().toISOString(),
          recordedDay, attemptNumber, eligible, audio, transcript: '',
        }
        setRecording(saved)
        void transcribe(saved, true)
      }
      setSeconds(0)
      current.start()
      recorder.current = current
      setActivity('recording')
    } catch (reason) {
      stream?.getTracks().forEach(track => track.stop())
      setError(reason instanceof Error ? reason.message : '녹음을 시작할 수 없어요. 마이크를 확인해 주세요.')
      setActivity('idle')
    }
  }

  function stopRecording() {
    const current = recorder.current
    if (current?.state === 'recording') {
      setActivity('saving')
      current.stop()
    }
  }

  async function applyEdit() {
    if (!recording) return
    const transcript = draft.trim()
    if (!/[a-z]/i.test(transcript) || transcript.length > 3000) {
      setError('받아쓴 영어 문장을 1~3,000자로 입력해 주세요.')
      return
    }
    setActivity('saving')
    try {
      const next = await updateTranscript(recording.id, transcript)
      if (!next) throw new Error('Recording is unavailable')
      setRecording(next)
      setPersisted(true)
      setEditing(false)
      setError('')
      void refresh()
    } catch { setError(storageMessage) } finally { setActivity('idle') }
  }

  async function copyFeedbackRequest() {
    if (!recording?.transcript || busy || editing) return
    const request = [
      feedbackInstructions,
      'Write your coaching notes in Korean with one example in English. Use headings for the three ratings, one strength, one priority and one example.',
      JSON.stringify({
        scenario: scenario.prompt,
        targetExpression: card.expression,
        learnerTranscript: recording.transcript,
      }, null, 2),
    ].join('\n\n')
    try {
      await navigator.clipboard.writeText(request)
      setCopyStatus('복사했어요. ChatGPT에 붙여넣어 피드백을 요청할 수 있어요.')
    } catch {
      setCopyStatus('클립보드에 복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.')
    }
  }

  async function evaluate() {
    if (!recording?.transcript || busy || editing) return
    setError('')
    setActivity('evaluating')
    try {
      const result = await requestService('/api/feedback', JSON.stringify({
        cardId: recording.cardId ?? '607', scene: recording.scene, transcript: recording.transcript,
      }), 'application/json')
      if (!isFeedback(result.feedback)) throw new Error('피드백을 읽을 수 없어요. 같은 답변으로 다시 시도해 주세요.')
      try {
        const saved = await saveFeedback(recording, result.feedback)
        setProgressByCard(current => ({ ...current, [card.id]: saved.progress }))
        setReward(saved.rewarded)
        await refresh()
        const latest = await getRecording(recording.id)
        if (latest) {
          setRecording(latest)
          if (!latest.feedback) setError('다른 탭에서 받아쓰기가 수정됐어요. 다시 확인한 뒤 피드백을 요청해 주세요.')
        }
        else {
          resetAttempt()
          setError('다른 탭에서 이 녹음이 삭제됐어요.')
        }
      } catch {
        setError('피드백을 저장하지 못했어요. 브라우저 저장 공간을 확인하고 다시 요청해 주세요.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '평가에 실패했어요. 같은 답변으로 다시 시도해 주세요.')
    } finally { setActivity('idle') }
  }

  function retry() {
    // Once feedback reveals the target, subsequent takes of this scene are practice only.
    setOpenedRecording(openedRecording || Boolean(recording?.feedback))
    setAttemptNumber(number => number + 1)
    resetAttempt()
  }

  async function changeScene() {
    if (busy) return
    const next = scene === 'practice' ? 'transfer' : 'practice'
    try {
      const updated = await setPracticeStep(card.id, next)
      setProgressByCard(current => ({ ...current, [card.id]: updated }))
      if (next === 'practice') await navigate('home')
      else {
        setScene(next)
        setAttemptNumber(1)
        setOpenedRecording(false)
        resetAttempt()
      }
    } catch { setError(storageMessage) }
  }

  const showPractice = screen === 'practice' || (screen === 'review' && ((scene.startsWith('review-') && due) || openedRecording || Boolean(recording)))
  const activityLabels: Partial<Record<Activity, string>> = {
    permission: '마이크 권한을 기다리고 있어요…',
    saving: '이 브라우저에 저장하고 있어요…',
    transcribing: '영어로 받아쓰고 있어요…',
    evaluating: 'Gemini 피드백을 준비하고 있어요…',
  }

  return <>
    <header className="top"><div className="shell top-inner">
      <button className="brand" disabled={busy} onClick={() => void navigate('home')}><Fruit /><span>Orange<span className="brand-light"> Notebook</span></span></button>
      <nav aria-label="주 메뉴">
        <button disabled={busy} aria-current={screen === 'home' || screen === 'practice' ? 'page' : undefined} onClick={() => void navigate('home')}>오늘의 연습</button>
        <button disabled={busy} aria-current={screen === 'review' ? 'page' : undefined} onClick={() => void navigate('review')}>복습</button>
        <button disabled={busy} aria-current={screen === 'recordings' ? 'page' : undefined} onClick={() => void navigate('recordings')}>내 녹음</button>
      </nav>
      <div className="count" aria-label={`모은 오렌지 ${orangeCount}개`}><Fruit /> {orangeCount}</div>
    </div></header>
    <main className="shell">
      {screen === 'home' ? <>
        <section className="hero">
          <div className="hero-copy">
            <span className="hero-label"><span className="leaf-mark" /> 오늘의 연습</span>
            <h1>오렌지 노트</h1>
            <p>내 일상에 맞는 영어를<br />소리 내어 말해 보세요.</p>
          </div>
          <div className="hero-art" aria-hidden="true"><span className="spark first">✦</span><Fruit /><Fruit slice /><span className="spark last">✧</span></div>
        </section>
        <div className="section-head"><h2>오늘의 새 카드</h2><span>{cards.length.toLocaleString('ko-KR')}개 표현</span></div>
        {nextCard ? <section className="feature"><div>
          <span className="pill">{cardLabel(nextCard)}</span>
          <h3>{nextCard.practice.title}</h3>
          <p>상황에 맞게 말하고 AI 피드백을 받아 보세요.</p>
        </div><button className="button primary" onClick={() => void navigate('practice', nextCard)}>연습 시작</button></section>
          : <p className="muted">모든 카드의 첫 연습을 마쳤어요.</p>}
        <div className="shortcuts">
          <button onClick={() => void navigate('review')}><span className="shortcut-icon green" aria-hidden="true">↻</span><span><strong>복습</strong><small>{reviewStatus}</small></span></button>
          <button onClick={() => void navigate('recordings')}><span className="shortcut-icon peach" aria-hidden="true">♫</span><span><strong>내 녹음</strong><small>저장한 녹음 {recordings.length}개</small></span></button>
        </div>
        {dueCards.length > 0 && <section aria-labelledby="due-heading">
          <div className="section-head"><h2 id="due-heading">오늘의 복습</h2><span>{dueCards.length}개</span></div>
          <ul className="catalog-list">{dueCards.slice(0, 3).map(entry => <li key={entry.id}>
            <button className="catalog-card" onClick={() => void navigate('review', entry)}>
              <span className="eyebrow">{cardLabel(entry)}</span><strong>{entry.practice.title}</strong>
            </button>
          </li>)}</ul>
        </section>}
        <CardBrowser onSelect={selected => void navigate('practice', selected)} />
        {error && <p className="error" role="alert">{error}</p>}
      </> : <section className="panel">
        <button className="back" disabled={busy} onClick={() => void navigate('home')}>홈으로</button>
        <span className="eyebrow">{showPractice ? cardLabel(card) : '오렌지 노트'}</span>
        <h1 ref={heading} tabIndex={-1}>{screen === 'recordings' ? '내 녹음' : screen === 'review' ? '복습' : '말하기 연습'}</h1>
        {error && <p className="error" role="alert">{error}</p>}
        {screen === 'recordings' && <RecordingList recordings={recordings} onOpen={openSaved} onDelete={remove} />}
        {screen === 'review' && !showPractice && <>
          <p className="muted">{reviewStatus}.</p>
          {dueCards.length > 0 && <ul className="catalog-list">{dueCards.map(entry => <li key={entry.id}>
            <button className="catalog-card" onClick={() => void navigate('review', entry)}>
              <span className="eyebrow">{cardLabel(entry)}</span><strong>{entry.practice.title}</strong>
            </button>
          </li>)}</ul>}
        </>}
        {showPractice && <>
          <div className="scenario"><span className="eyebrow">{scenario.title} · {attemptNumber}번째 시도</span><p>{scenario.prompt}</p></div>
          {activityLabels[activity] && <p role="status" className="status">{activityLabels[activity]}</p>}
          {activity === 'recording' && <div className="capture">
            <span className="recording-status"><span aria-hidden="true" /> 녹음 중 <time>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</time></span>
            <button className="button primary" onClick={stopRecording}>녹음 끝내기</button>
          </div>}
          {!recording && activity === 'idle' && <>
            <p className="instruction">영어로 소리 내어 답해 보세요. 한 번에 최대 90초 녹음할 수 있어요.</p>
            <p className="privacy">녹음을 끝내면 받아쓰기를 위해 음성이 OpenAI로 전송돼요. 음성 파일은 이 브라우저에 저장돼요.</p>
            <button className="button primary" onClick={() => void startRecording()}>녹음 시작</button>
          </>}
          {recording && <div className="take">
            <h2>내가 말한 답변</h2>
            <AudioPlayer audio={recording.audio} />
            {persisted && <p className="saved-status">이 브라우저에 녹음 저장됨</p>}
            {recording.transcript && !editing && <div className="transcript"><span className="eyebrow">받아쓰기</span><p lang="en">{recording.transcript}</p></div>}
            {!recording.feedback && <>
              {editing && <div className="sentence-form">
                <label htmlFor="transcript">받아쓰기 수정</label>
                <textarea id="transcript" lang="en" maxLength={3000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
                <div className="actions">
                  <button className="button secondary" disabled={busy} onClick={() => setEditing(false)}>취소</button>
                  <button className="button primary" disabled={busy} onClick={() => void applyEdit()}>수정 저장</button>
                </div>
              </div>}
              {!editing && <>
                {recording.transcript ? <>
                  <p className="privacy">받아쓰기가 실제로 말한 내용과 같은지 들어 보고 확인해 주세요. ‘AI 피드백 받기’를 누르면 확인한 영어 텍스트, 연습 상황, 목표 표현이 Google Gemini로 전송돼요. 음성 파일은 이 요청에 포함되지 않아요.</p>
                  <div className="actions">
                    <button className="button primary" disabled={busy || !persisted} onClick={() => void evaluate()}>AI 피드백 받기</button>
                    <button className="button secondary" disabled={busy} onClick={() => { setDraft(recording.transcript); setEditing(true) }}>받아쓰기 수정</button>
                  </div>
                  <button className="button secondary retry-button" disabled={busy} onClick={() => void copyFeedbackRequest()}>ChatGPT용 피드백 요청 복사</button>
                  {copyStatus && <p className="saved-status" role="status">{copyStatus}</p>}
                </> : activity === 'idle' && <>
                  <p className="privacy">받아쓰기를 다시 요청하면 이 음성이 OpenAI로 전송돼요.</p>
                  {recording.audio.size <= maxAudioBytes &&
                    <button className="button primary" onClick={() => void transcribe(recording, !persisted)}>받아쓰기 다시 시도</button>}
                </>}
                {activity === 'idle' && <button className="button secondary retry-button" onClick={retry}>다시 녹음</button>}
              </>}
            </>}
            {recording.feedback && <>
              {reward && <div className="reward-banner" role="status"><span className="reward"><Fruit /></span><strong>오렌지 1개를 모았어요!</strong></div>}
              <FeedbackView feedback={recording.feedback} expression={card.expression} />
              {progress.nextReview && <p className="saved-status">다음 복습은 {dayLabel(progress.nextReview)}이에요.</p>}
              {screen === 'practice' && <>
                <button className="button secondary" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? '카드 표현과 예문 가리기' : '카드 표현과 예문 보기'}</button>
                {revealed && <div className="answer">
                  <strong lang="en">{card.expression}</strong><p lang="en">{card.original}</p>
                  <p>{card.meaning} {card.usage}</p><p lang="en">{scenario.example}</p><small>《오렌지 노트 2018.pdf》 {sourceLabel(card)}</small>
                </div>}
              </>}
              <div className="actions feedback-actions">
                <button className="button primary" onClick={retry}>다시 말하기</button>
                {screen === 'practice' && <button className="button secondary" onClick={() => void changeScene()}>{scene === 'practice' ? '장면 바꾸기' : '연습 마치기'}</button>}
                {screen === 'review' && <button className="button secondary" onClick={() => void navigate('review')}>복습 마치기</button>}
              </div>
            </>}
          </div>}
        </>}
      </section>}
    </main>
    <footer className="shell footer"><Fruit slice /><span>Orange Notebook</span></footer>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
