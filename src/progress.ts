import { reviewKey } from './cards'
import type { Card, SceneKey } from './cards'
import type { Feedback } from './feedback'

export interface Progress {
  nextReview: string | null
  practiceStep: 'practice' | 'transfer'
  reviewRound: number
  earned: boolean
}

export const initialProgress: Progress = { nextReview: null, practiceStep: 'practice', reviewRound: 0, earned: false }

export function localDay(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function legacyProgress(): Progress {
  try {
    const old = JSON.parse(localStorage.getItem('orange-notebook:v1:607') ?? 'null')
    return {
      ...initialProgress,
      nextReview: typeof old?.nextReview === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(old.nextReview) ? old.nextReview : null,
      practiceStep: old?.step === 2 ? 'transfer' : 'practice',
      earned: old?.earned === true,
    }
  } catch {
    return initialProgress
  }
}

export function completeAttempt(card: Card, progress: Progress, scene: SceneKey, feedback: Feedback, recordedDay: string, eligible: boolean) {
  if (!scene.startsWith('review-')) {
    return {
      ...progress,
      nextReview: progress.nextReview ?? (progress.earned ? null : localDay(1)),
    }
  }
  const today = localDay()
  if (!eligible || recordedDay !== today || progress.earned || !progress.nextReview ||
      progress.nextReview > today || scene !== reviewKey(card, progress.reviewRound)) return progress
  const passed = feedback.target === 'good'
  return {
    ...progress,
    earned: passed,
    nextReview: passed ? null : localDay(1),
    reviewRound: passed ? progress.reviewRound : progress.reviewRound + 1,
  }
}
