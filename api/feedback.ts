import { handleApi } from '../server/api.ts'

export default {
  fetch(request: Request) {
    return handleApi(request, {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    })
  },
}
