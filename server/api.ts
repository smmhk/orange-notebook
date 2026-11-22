import { getCard, getScenario } from '../src/cards.ts'
import { feedbackInstructions, feedbackSchema, isFeedback, usesTarget } from '../src/feedback.ts'

export interface ServerEnv {
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
}

import { audioLimitMessage, maxAudioBytes } from '../src/audioFormat.ts'
const audioTypes: Record<string, string> = {
  'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg',
  'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a',
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function readBody(request: Request, limit: number) {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(new Uint8Array(value))
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    reader.releaseLock()
  }
}

async function transcribeAudio(apiKey: string, body: FormData) {
  return fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    body,
    signal: AbortSignal.timeout(40000),
  })
}


export async function handleApi(request: Request, env: ServerEnv): Promise<Response> {
  const url = new URL(request.url)
  const transcription = url.pathname === '/api/transcribe'
  if (!transcription && url.pathname !== '/api/feedback') return error('API endpoint not found.', 404)
  if (request.method !== 'POST') return error('This API endpoint requires a POST request.', 405)
  if (request.headers.get('sec-fetch-site') === 'cross-site') return error('Try again from the app.', 403)
  const apiKey = (transcription ? env.OPENAI_API_KEY : env.GEMINI_API_KEY)?.trim()
  if (!apiKey) return error(transcription
    ? 'Configure OPENAI_API_KEY on the server, then retry transcription.'
    : 'Configure GEMINI_API_KEY on the server, then retry or copy the prompt for ChatGPT.', 503)
  if (!transcription && request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return error('Send the confirmed English transcript as JSON.', 415)
  }

  try {
    const bytes = await readBody(request, transcription ? maxAudioBytes : 12000)
    if (!bytes && transcription) return error(audioLimitMessage, 413)
    if (!bytes || !bytes.length) return error('Check the file or answer size and try again.', 400)

    if (transcription) {
      const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      if (!Object.hasOwn(audioTypes, type)) return error('This recording format is unsupported. Try recording in Chrome or Safari.', 415)
      const form = new FormData()
      form.append('file', new Blob([bytes], { type }), 'recording.' + audioTypes[type])
      form.append('model', 'gpt-4o-mini-transcribe')
      form.append('language', 'en')
      const response = await transcribeAudio(apiKey, form)
      if (!response.ok) return upstreamError(response.status, 'Transcription')
      const result = await response.json() as { text?: unknown }
      const text = typeof result.text === 'string' ? result.text.trim() : ''
      if (!/\p{L}/u.test(text) || text.length > 3000) return error('No usable English transcript was found. Move closer to your microphone and record again.', 422)
      return Response.json({ text }, { headers: { 'Cache-Control': 'no-store' } })
    }

    let input: { cardId?: unknown; scene?: unknown; transcript?: unknown } | null
    try { input = JSON.parse(new TextDecoder().decode(bytes)) } catch { input = null }
    const card = getCard(input?.cardId === undefined ? '607' : input.cardId)
    const scenario = card && getScenario(card, input?.scene)
    const transcript = typeof input?.transcript === 'string' ? input.transcript.trim() : ''
    if (!card || !scenario || !/[a-z]/i.test(transcript) || transcript.length > 3000) {
      return error('Check your English transcript and try again.', 400)
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: feedbackInstructions }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({
          targetExpression: card.expression,
          scenario: scenario.prompt,
          learnerTranscript: transcript,
        }) }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: feedbackSchema },
      }),
      signal: AbortSignal.timeout(40000),
    })
    if (response.status === 429) {
      return error('Gemini reached its request limit. Retry after the limit resets or copy the prompt for ChatGPT.', 429)
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return error('Gemini access failed. Check the server key and model access in Google AI Studio.', 502)
    }
    if (!response.ok) return upstreamError(response.status, 'Gemini feedback')
    const result = await response.json() as {
      candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]
    }
    const candidate = result.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') {
      return error('Gemini did not finish the feedback. Try again with the same transcript.', 502)
    }
    const json = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('') ?? ''
    const feedback: unknown = JSON.parse(json)
    if (!isFeedback(feedback)) return error('The feedback format was invalid. Try again with the same answer.', 502)
    if (card.id === '607' && feedback.target === 'good' && !usesTarget(transcript)) feedback.target = 'retry'
    return Response.json({ feedback }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return error(`${transcription ? 'Transcription' : 'Feedback'} failed to respond or returned an unreadable result. Try again shortly.`, 502)
  }
}

function upstreamError(status: number, feature: string) {
  if (status === 401 || status === 403) return error(`${feature} authentication failed. Check the server API key and model permissions.`, 502)
  if (status === 429) return error(`${feature} reached a usage limit. Check the API account balance and limits, or retry shortly.`, 503)
  return error(`${feature} could not process the request. Try again shortly.`, 502)
}
