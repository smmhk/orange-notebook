import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { cards, cardLabel, getCard, getScenario, reviewKey, sourceLabel } from './cards'
import type { Card, SceneKey } from './cards'
import { feedbackInstructions, isFeedback } from './feedback'
import { initialProgress, legacyProgress, localDay } from './progress'
import { deleteRecording, getRecording, listRecordings, markReviewHint, readProgress, saveFeedback, saveRecording, setPracticeStep, updateTranscript } from './recordings'
import type { Recording } from './recordings'
import { AudioPlayer, FeedbackView, RecordingList } from './RecordingViews'
import { CardBrowser } from './CardBrowser'
import { createRecorder, maxSeconds, openMicrophone } from './recorder'
import { audioLimitMessage, maxAudioBytes } from './audioFormat'
import './style.css'

type Screen = 'home' | 'practice' | 'review' | 'recordings'
type Activity = 'idle' | 'permission' | 'recording' | 'saving' | 'transcribing' | 'evaluating'
const dateLabel = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' })
const storageMessage = 'Could not save or load your data. Check your browser storage and privacy settings and try again.'

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
    throw new Error('Could not connect. Check your connection and try again.')
  }
  if (response.status === 413 && path === '/api/transcribe') throw new Error(audioLimitMessage)
  const result = await response.json().catch(() => null)
  if (!response.ok || !result) throw new Error(result?.error || 'Could not read the service response. Try again shortly.')
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
  const reviewStatus = dueCards.length ? `${dueCards.length} due today` : 'No cards due today'
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
        throw new Error('The transcript is empty. Retry transcription or record again.')
      }
      try {
        const next = await updateTranscript(saved.id, result.text.trim())
        if (!next) throw new Error('Recording is unavailable')
        setRecording(next)
        void refresh()
      } catch { setError(storageMessage) }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Transcription failed. Please try again.')
    } finally {
      setActivity('idle')
    }
  }

  async function flipCard() {
    if (busy) return
    if (!revealed && screen === 'review' && due && !recording?.feedback) {
      setActivity('saving')
      try {
        const updated = await markReviewHint(card, scene)
        setProgressByCard(current => ({ ...current, [card.id]: updated }))
      } catch {
        setError(storageMessage)
        return
      } finally {
        setActivity('idle')
      }
    }
    setRevealed(!revealed)
  }

  async function startRecording() {
    if (busy) return
    setError('')
    setActivity('permission')
    const recordedDay = localDay()
    const eligible = screen === 'review' && !openedRecording && !progress.earned &&
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
        setError('Recording stopped unexpectedly. Check your microphone and record again.')
        setActivity('idle')
      }
      current.onstop = () => {
        release()
        if (failed) return
        const audio = new Blob(chunks, { type: chunks[0]?.type || current.mimeType })
        if (!audio.size) {
          setError('No audio was captured. Move closer to the microphone and try again.')
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
      setError(reason instanceof Error ? reason.message : 'Could not start recording. Check your microphone.')
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
      setError('Enter an English transcript up to 3,000 characters long.')
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
      'Write your coaching notes in English with one example in English. Use headings for the three ratings, one strength, one priority and one example.',
      JSON.stringify({
        scenario: scenario.prompt,
        targetExpression: card.expression,
        learnerTranscript: recording.transcript,
      }, null, 2),
    ].join('\n\n')
    try {
      await navigator.clipboard.writeText(request)
      setCopyStatus('Copied. Paste the prompt into ChatGPT for feedback.')
    } catch {
      setCopyStatus('Could not copy the prompt. Check your clipboard permissions.')
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
      if (!isFeedback(result.feedback)) throw new Error('Could not read the feedback. Try again with the same answer.')
      try {
        const saved = await saveFeedback(recording, result.feedback)
        setProgressByCard(current => ({ ...current, [card.id]: saved.progress }))
        setReward(saved.rewarded)
        await refresh()
        const latest = await getRecording(recording.id)
        if (latest) {
          setRecording(latest)
          if (!latest.feedback) setError('The transcript changed in another tab. Check it before requesting feedback again.')
        }
        else {
          resetAttempt()
          setError('This recording was deleted in another tab.')
        }
      } catch {
        setError('Could not save feedback. Check your browser storage and try again.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Feedback failed. Try again with the same answer.')
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
    permission: 'Waiting for microphone permission…',
    saving: 'Saving to this browser…',
    transcribing: 'Transcribing your English…',
    evaluating: 'Getting feedback from Gemini…',
  }

  return <>
    <header className="top"><div className="shell top-inner">
      <button className="brand" disabled={busy} onClick={() => void navigate('home')}><Fruit /><span>Orange<span className="brand-light"> Notebook</span></span></button>
      <nav aria-label="Main menu">
        <button disabled={busy} aria-current={screen === 'home' || screen === 'practice' ? 'page' : undefined} onClick={() => void navigate('home')}>Today’s practice</button>
        <button disabled={busy} aria-current={screen === 'review' ? 'page' : undefined} onClick={() => void navigate('review')}>Review</button>
        <button disabled={busy} aria-current={screen === 'recordings' ? 'page' : undefined} onClick={() => void navigate('recordings')}>My recordings</button>
      </nav>
      <div className="count" aria-label={`Oranges collected: ${orangeCount}`}><Fruit /> {orangeCount}</div>
    </div></header>
    <main className="shell">
      {screen === 'home' ? <>
        <section className="hero">
          <div className="hero-copy">
            <span className="hero-label"><span className="leaf-mark" /> Today’s practice</span>
            <h1>Orange Notebook</h1>
            <p>Practice English out loud<br />for everyday situations.</p>
          </div>
          <div className="hero-art" aria-hidden="true"><span className="spark first">✦</span><Fruit /><Fruit slice /><span className="spark last">✧</span></div>
        </section>
        <div className="section-head"><h2>New card</h2><span>{cards.length.toLocaleString('en')}expressions</span></div>
        {nextCard ? <section className="feature"><div>
          <span className="pill">{cardLabel(nextCard)}</span>
          <h3>Try a speaking prompt</h3>
          <p>Speak your answer and get AI feedback.</p>
        </div><button className="button primary" onClick={() => void navigate('practice', nextCard)}>Start practice</button></section>
          : <p className="muted">You have practiced every card.</p>}
        <div className="shortcuts">
          <button onClick={() => void navigate('review')}><span className="shortcut-icon green" aria-hidden="true">↻</span><span><strong>Review</strong><small>{reviewStatus}</small></span></button>
          <button onClick={() => void navigate('recordings')}><span className="shortcut-icon peach" aria-hidden="true">♫</span><span><strong>My recordings</strong><small>Recordings saved: {recordings.length}</small></span></button>
        </div>
        {dueCards.length > 0 && <section aria-labelledby="due-heading">
          <div className="section-head"><h2 id="due-heading">Due today</h2><span>{dueCards.length} cards</span></div>
          <ul className="catalog-list">{dueCards.slice(0, 3).map(entry => <li key={entry.id}>
            <button className="catalog-card" onClick={() => void navigate('review', entry)}>
              <span className="eyebrow">{cardLabel(entry)}</span><strong>{entry.number ? `Card ${entry.number}` : `Page ${entry.sources[0].page}`}</strong>
            </button>
          </li>)}</ul>
        </section>}
        <CardBrowser onSelect={selected => void navigate('practice', selected)} />
        {error && <p className="error" role="alert">{error}</p>}
      </> : <section className="panel">
        <button className="back" disabled={busy} onClick={() => void navigate('home')}>Back to home</button>
        <span className="eyebrow">{showPractice ? cardLabel(card) : 'Orange Notebook'}</span>
        <h1 ref={heading} tabIndex={-1}>{screen === 'recordings' ? 'My recordings' : screen === 'review' ? 'Review' : 'Speaking practice'}</h1>
        {error && <p className="error" role="alert">{error}</p>}
        {screen === 'recordings' && <RecordingList recordings={recordings} onOpen={openSaved} onDelete={remove} />}
        {screen === 'review' && !showPractice && <>
          <p className="muted">{reviewStatus}.</p>
          {dueCards.length > 0 && <ul className="catalog-list">{dueCards.map(entry => <li key={entry.id}>
            <button className="catalog-card" onClick={() => void navigate('review', entry)}>
              <span className="eyebrow">{cardLabel(entry)}</span><strong>{entry.number ? `Card ${entry.number}` : `Page ${entry.sources[0].page}`}</strong>
            </button>
          </li>)}</ul>}
        </>}
        {showPractice && <>
          <button type="button" className="scenario study-card" data-side={revealed ? 'back' : 'front'}
            aria-expanded={revealed} aria-controls="study-card-content" disabled={busy} onClick={() => void flipCard()}>
            <span className="eyebrow">{revealed ? 'Answer & example' : `Situation · Attempt ${attemptNumber}`}</span>
            <span id="study-card-content" className="study-card-content">
              {revealed ? <>
                <strong lang="ko">{card.meaning}</strong>
                <span lang="en">{scenario.example}</span>
                {scenario.example !== card.expression && <span lang="en" className="study-card-target">{card.expression}</span>}
                <small>Orange Notebook 2018.pdf · {sourceLabel(card)}</small>
              </> : <span lang="ko">{scenario.prompt}</span>}
            </span>
            <span className="study-card-action">{revealed ? '↶ Show situation' : '↻ Flip for an English hint'}</span>
          </button>
          {screen === 'review' && due && !recording?.feedback && <p className="study-card-note">
            {progress.hintedReviewRound === progress.reviewRound ? 'This review counts as practice because you opened the hint.' : 'Answer without a hint to earn an orange.'}
          </p>}
          {activityLabels[activity] && <p role="status" className="status">{activityLabels[activity]}</p>}
          {activity === 'recording' && <div className="capture">
            <span className="recording-status"><span aria-hidden="true" /> Recording <time>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</time></span>
            <button className="button primary" onClick={stopRecording}>Stop recording</button>
          </div>}
          {!recording && activity === 'idle' && <>
            <p className="instruction">Answer aloud in English. You can record up to 90 seconds.</p>
            <p className="privacy">When you stop recording, your audio is sent to OpenAI for transcription and saved in this browser.</p>
            <button className="button primary" onClick={() => void startRecording()}>Start recording</button>
          </>}
          {recording && <div className="take">
            <h2>Your answer</h2>
            <AudioPlayer audio={recording.audio} />
            {persisted && <p className="saved-status">Recording saved in this browser</p>}
            {recording.transcript && !editing && <div className="transcript"><span className="eyebrow">Transcript</span><p lang="en">{recording.transcript}</p></div>}
            {!recording.feedback && <>
              {editing && <div className="sentence-form">
                <label htmlFor="transcript">Edit transcript</label>
                <textarea id="transcript" lang="en" maxLength={3000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
                <div className="actions">
                  <button className="button secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
                  <button className="button primary" disabled={busy} onClick={() => void applyEdit()}>Save changes</button>
                </div>
              </div>}
              {!editing && <>
                {recording.transcript ? <>
                  <p className="privacy">Check the transcript against your recording. Get AI feedback sends your confirmed text, the situation, and the target expression to Google Gemini.</p>
                  <div className="actions">
                    <button className="button primary" disabled={busy || !persisted} onClick={() => void evaluate()}>Get AI feedback</button>
                    <button className="button secondary" disabled={busy} onClick={() => { setDraft(recording.transcript); setEditing(true) }}>Edit transcript</button>
                  </div>
                  <button className="button secondary retry-button" disabled={busy} onClick={() => void copyFeedbackRequest()}>Copy prompt for ChatGPT</button>
                  {copyStatus && <p className="saved-status" role="status">{copyStatus}</p>}
                </> : activity === 'idle' && <>
                  <p className="privacy">Retrying transcription sends this audio to OpenAI.</p>
                  {recording.audio.size <= maxAudioBytes &&
                    <button className="button primary" onClick={() => void transcribe(recording, !persisted)}>Retry transcription</button>}
                </>}
                {activity === 'idle' && <button className="button secondary retry-button" onClick={retry}>Record again</button>}
              </>}
            </>}
            {recording.feedback && <>
              {reward && <div className="reward-banner" role="status"><span className="reward"><Fruit /></span><strong>You earned an orange!</strong></div>}
              <FeedbackView feedback={recording.feedback} expression={card.expression} />
              {progress.nextReview && <p className="saved-status">Next review: {dayLabel(progress.nextReview)}</p>}
              <div className="actions feedback-actions">
                <button className="button primary" onClick={retry}>Try again</button>
                {screen === 'practice' && <button className="button secondary" onClick={() => void changeScene()}>{scene === 'practice' ? 'Change situation' : 'Finish practice'}</button>}
                {screen === 'review' && <button className="button secondary" onClick={() => void navigate('review')}>Finish review</button>}
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
