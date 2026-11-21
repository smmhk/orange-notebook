export const maxSeconds = 90

export async function openMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('이 환경에서는 녹음할 수 없어요. HTTPS 또는 localhost에서 최신 Chrome이나 Safari로 열어 주세요.')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') throw new Error('마이크 권한이 꺼져 있어요. 브라우저의 사이트 설정에서 마이크를 허용한 뒤 다시 눌러 주세요.')
      if (error.name === 'NotFoundError') throw new Error('연결된 마이크가 없어요. 마이크를 연결한 뒤 다시 시도해 주세요.')
      if (error.name === 'NotReadableError') throw new Error('마이크를 열 수 없어요. 마이크를 사용하는 다른 앱을 닫거나 연결을 확인해 주세요.')
    }
    throw new Error('마이크를 시작하지 못했어요. 브라우저의 마이크 설정을 확인하고 다시 시도해 주세요.')
  }
}

const recordingTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']

export function createRecorder(stream: MediaStream) {
  const mimeType = recordingTypes.find(type => MediaRecorder.isTypeSupported?.(type))
  try {
    return new MediaRecorder(stream, { audioBitsPerSecond: 64_000, ...(mimeType ? { mimeType } : {}) })
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotSupportedError') throw error
    return new MediaRecorder(stream)
  }
}
