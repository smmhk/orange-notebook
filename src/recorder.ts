export const maxSeconds = 90

export async function openMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Recording is unavailable. Open the app over HTTPS or on localhost in a recent version of Chrome or Safari.')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') throw new Error('Microphone access was denied. Allow it in your browser’s site settings and try again.')
      if (error.name === 'NotFoundError') throw new Error('No microphone was found. Connect one and try again.')
      if (error.name === 'NotReadableError') throw new Error('Could not access the microphone. Check the connection or close other apps using it.')
    }
    throw new Error('Could not start the microphone. Check your browser settings and try again.')
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
