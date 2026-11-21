import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { build } from 'vite'

const files = ['index.html', ...(await readdir('dist/assets')).map(name => 'assets/' + name)]
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' }
const assets = Object.fromEntries(await Promise.all(files.map(async file => [
  file === 'index.html' ? '/' : '/' + file,
  { body: await readFile('dist/' + file, 'utf8'), type: types[file.split('.').at(-1)] },
])))
const result = await build({
  configFile: false,
  build: {
    ssr: 'server/api.ts',
    write: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'api.js' } },
  },
})
const api = result.output.find(file => file.type === 'chunk')?.code
if (!api) throw new Error('API bundle is missing')
await mkdir('dist/server', { recursive: true })
await writeFile('dist/server/index.js', `
${api}
const assets = ${JSON.stringify(assets)};
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return handleApi(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const asset = Object.hasOwn(assets, path) ? assets[path] : null;
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      headers: { 'Content-Type': asset.type, 'Cache-Control': path === '/' ? 'no-cache' : 'public, max-age=31536000, immutable' },
    });
  },
};
`)
