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
  if (!transcription && url.pathname !== '/api/feedback') return error('요청 주소를 확인해 주세요.', 404)
  if (request.method !== 'POST') return error('요청 방식을 확인해 주세요.', 405)
  if (request.headers.get('sec-fetch-site') === 'cross-site') return error('앱 화면에서 다시 시도해 주세요.', 403)
  const apiKey = (transcription ? env.OPENAI_API_KEY : env.GEMINI_API_KEY)?.trim()
  if (!apiKey) return error(transcription
    ? '서버에 OpenAI API 키가 설정되지 않았어요. 서버 설정 후 이 녹음으로 다시 시도해 주세요.'
    : '서버에 Gemini API 키가 설정되지 않았어요. 설정 후 같은 받아쓰기로 다시 요청하거나 피드백 요청을 복사할 수 있어요.', 503)
  if (!transcription && request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return error('피드백은 확인한 영어 텍스트만 받을 수 있어요.', 415)
  }

  try {
    const bytes = await readBody(request, transcription ? maxAudioBytes : 12000)
    if (!bytes && transcription) return error(audioLimitMessage, 413)
    if (!bytes || !bytes.length) return error('파일 또는 답변 크기를 확인한 뒤 다시 시도해 주세요.', 400)

    if (transcription) {
      const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      if (!Object.hasOwn(audioTypes, type)) return error('이 녹음 형식을 받아쓸 수 없어요. Chrome 또는 Safari에서 다시 녹음해 주세요.', 415)
      const form = new FormData()
      form.append('file', new Blob([bytes], { type }), 'recording.' + audioTypes[type])
      form.append('model', 'gpt-4o-mini-transcribe')
      form.append('language', 'en')
      const response = await transcribeAudio(apiKey, form)
      if (!response.ok) return upstreamError(response.status, '받아쓰기')
      const result = await response.json() as { text?: unknown }
      const text = typeof result.text === 'string' ? result.text.trim() : ''
      if (!/\p{L}/u.test(text) || text.length > 3000) return error('영어 답변이 또렷하게 인식되지 않았어요. 마이크 가까이에서 다시 녹음해 주세요.', 422)
      return Response.json({ text }, { headers: { 'Cache-Control': 'no-store' } })
    }

    let input: { cardId?: unknown; scene?: unknown; transcript?: unknown } | null
    try { input = JSON.parse(new TextDecoder().decode(bytes)) } catch { input = null }
    const card = getCard(input?.cardId === undefined ? '607' : input.cardId)
    const scenario = card && getScenario(card, input?.scene)
    const transcript = typeof input?.transcript === 'string' ? input.transcript.trim() : ''
    if (!card || !scenario || !/[a-z]/i.test(transcript) || transcript.length > 3000) {
      return error('받아쓴 영어 문장을 확인하고 다시 시도해 주세요.', 400)
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
      return error('Gemini 요청 한도에 도달했어요. 한도가 초기화된 뒤 같은 받아쓰기로 다시 요청하거나 피드백 요청을 복사해 주세요.', 429)
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return error('Gemini 모델에 접근할 수 없어요. 서버 API 키와 Google AI Studio 프로젝트의 모델 접근 권한을 확인해 주세요.', 502)
    }
    if (!response.ok) return upstreamError(response.status, 'Gemini 피드백')
    const result = await response.json() as {
      candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]
    }
    const candidate = result.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') {
      return error('Gemini가 피드백을 완성하지 못했어요. 같은 받아쓰기로 다시 요청할 수 있어요.', 502)
    }
    const json = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('') ?? ''
    const feedback: unknown = JSON.parse(json)
    if (!isFeedback(feedback)) return error('피드백 형식을 확인할 수 없어요. 같은 답변으로 다시 요청해 주세요.', 502)
    if (card.id === '607' && feedback.target === 'good' && !usesTarget(transcript)) feedback.target = 'retry'
    return Response.json({ feedback }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return error(`${transcription ? '받아쓰기' : '피드백'} 서비스에 응답이 없거나 결과를 읽을 수 없어요. 잠시 후 같은 녹음으로 다시 시도해 주세요.`, 502)
  }
}

function upstreamError(status: number, feature: string) {
  if (status === 401 || status === 403) return error(`${feature} 서비스 인증에 실패했어요. 서버 API 키와 모델 접근 권한을 확인하고 다시 시도해 주세요.`, 502)
  if (status === 429) return error(`${feature} 서비스 요청 한도에 도달했어요. 잠시 후 다시 시도하거나 서버 계정의 사용 한도를 확인해 주세요.`, 503)
  return error(`${feature} 서비스가 요청을 처리하지 못했어요. 잠시 후 같은 녹음으로 다시 시도해 주세요.`, 502)
}
