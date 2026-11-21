import { getCard } from './cards'
import type { SceneKey } from './cards'
import type { Feedback } from './feedback'
import { completeAttempt, initialProgress, legacyProgress } from './progress'
import type { Progress } from './progress'

export interface Recording {
  id: string
  cardId?: string
  scene: SceneKey
  attemptNumber: number
  createdAt: string
  recordedDay: string
  eligible: boolean
  audio: Blob
  transcript: string
  feedback?: Feedback
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('orange-notebook', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('recordings', { keyPath: 'id' })
      request.result.createObjectStore('progress')
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Database is blocked'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function transact<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, setResult: (value: T) => void) => void) {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      let result: T
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
      tx.onerror = () => reject(tx.error)
      try {
        run(tx, value => { result = value })
      } catch (error) {
        tx.abort()
        reject(error)
      }
    })
  } finally {
    db.close()
  }
}

export function listRecordings() {
  return transact<Recording[]>(['recordings'], 'readonly', (tx, done) => {
    const request = tx.objectStore('recordings').getAll()
    request.onsuccess = () => done((request.result as Recording[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  })
}

export function saveRecording(recording: Recording) {
  return transact<void>(['recordings'], 'readwrite', tx => {
    tx.objectStore('recordings').put(recording)
  })
}

export function updateTranscript(id: string, transcript: string) {
  return transact<Recording | null>(['recordings'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('recordings')
    const request = store.get(id)
    request.onsuccess = () => {
      const existing: Recording | undefined = request.result
      if (!existing || existing.feedback) {
        done(null)
        return
      }
      const next = { ...existing, transcript }
      store.put(next)
      done(next)
    }
  })
}

export function getRecording(id: string) {
  return transact<Recording | undefined>(['recordings'], 'readonly', (tx, done) => {
    const request = tx.objectStore('recordings').get(id)
    request.onsuccess = () => done(request.result)
  })
}

export function deleteRecording(id: string) {
  return transact<void>(['recordings'], 'readwrite', tx => {
    tx.objectStore('recordings').delete(id)
  })
}

export function readProgress() {
  return transact<Record<string, Progress>>(['progress'], 'readonly', (tx, done) => {
    const progressByCard: Record<string, Progress> = { '607': legacyProgress() }
    const request = tx.objectStore('progress').openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        progressByCard[String(cursor.key)] = cursor.value
        cursor.continue()
      } else {
        done(progressByCard)
      }
    }
  })
}

export function setPracticeStep(cardId: string, step: Progress['practiceStep']) {
  return transact<Progress>(['progress'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('progress')
    const request = store.get(cardId)
    request.onsuccess = () => {
      const next: Progress = { ...(request.result ?? (cardId === '607' ? legacyProgress() : initialProgress)), practiceStep: step }
      store.put(next, cardId)
      done(next)
    }
  })
}

export function saveFeedback(recording: Recording, feedback: Feedback) {
  const cardId = recording.cardId ?? '607'
  const card = getCard(cardId)
  if (!card) return Promise.reject(new Error('Unknown card'))
  return transact<{ progress: Progress; rewarded: boolean }>(['recordings', 'progress'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('progress')
    const recordings = tx.objectStore('recordings')
    const request = store.get(cardId)
    request.onsuccess = () => {
      const current: Progress = request.result ?? (cardId === '607' ? legacyProgress() : initialProgress)
      const existing = recordings.get(recording.id)
      existing.onsuccess = () => {
        // A request completed in another tab must not recreate a deleted recording or reevaluate it.
        if (!existing.result || existing.result.feedback || existing.result.transcript !== recording.transcript) {
          done({ progress: current, rewarded: false })
          return
        }
        const next = completeAttempt(card, current, recording.scene, feedback, recording.recordedDay, recording.eligible)
        recordings.put({ ...existing.result, feedback })
        store.put(next, cardId)
        done({ progress: next, rewarded: !current.earned && next.earned })
      }
    }
  })
}
