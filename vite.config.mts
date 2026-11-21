import { Readable } from 'node:stream'
import { defineConfig, loadEnv } from 'vite'
import { handleApi } from './server/api.ts'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [{
      name: 'orange-notebook-api',
      configureServer(server) {
        server.middlewares.use(async (incoming, outgoing, next) => {
          if (!incoming.url?.startsWith('/api/')) return next()
          try {
            const method = incoming.method ?? 'GET'
            const request = new Request('http://localhost' + incoming.url, {
              method,
              headers: Object.entries(incoming.headers).flatMap(([name, value]) =>
                value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]]),
              ...(method === 'GET' || method === 'HEAD' ? {} : {
                body: Readable.toWeb(incoming),
                duplex: 'half',
              }),
            } as RequestInit)
            const response = await handleApi(request, env)
            outgoing.writeHead(response.status, Object.fromEntries(response.headers))
            outgoing.end(Buffer.from(await response.arrayBuffer()))
          } catch {
            outgoing.writeHead(500, { 'Content-Type': 'application/json' })
            outgoing.end(JSON.stringify({ error: '로컬 서버 요청을 처리하지 못했어요. 다시 시도해 주세요.' }))
          }
        })
      },
    }],
  }
})
