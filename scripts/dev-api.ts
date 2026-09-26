/**
 * Runs the Vercel edge handlers in api/ on this machine, for testing an app build against
 * server code that has not been deployed yet.
 *
 *   npx tsx --env-file=.env scripts/dev-api.ts            # listens on :3001
 *   PORT=4000 npx tsx --env-file=.env scripts/dev-api.ts
 *
 * Point the mobile app at it with EXPO_PUBLIC_API_URL=http://localhost:3001 when starting
 * Metro, and `adb reverse tcp:3001 tcp:3001` so "localhost" on the phone reaches this PC.
 *
 * It listens on 127.0.0.1 only, which is all `adb reverse` needs. Node's default is every
 * interface, and that put the handlers, and the NEBIUS_API_KEY in .env behind them, on
 * whatever network this PC is on; with AI_AUTH=off, as api/_auth.ts suggests for serving
 * the phone, anyone on the same Wi-Fi could spend the key with no sign-in and no limit.
 * HOST=0.0.0.0 opens it to the LAN (a phone using this PC's LAN address), and is refused
 * unless the sign-in gate is fully on, so the LAN meets the same checks production does.
 *
 * The handlers are plain (Request) => Response functions, so this only translates Node's
 * request into a Fetch Request and back. It is not the edge runtime: Node APIs that would
 * fail on Vercel still work here, so a successful local run does not prove an edge deploy.
 */
import { createServer, type IncomingMessage } from 'node:http'
import { AI_AUTH_MODE } from '../api/_auth'

type Handler = (req: Request) => Promise<Response>

const ROUTES: Record<string, () => Promise<{ default: Handler }>> = {
  '/api/chat': () => import('../api/chat'),
  '/api/analyze-photo': () => import('../api/analyze-photo'),
  '/api/recommend': () => import('../api/recommend'),
}

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const port = Number(process.env.PORT) || 3001
const host = process.env.HOST?.trim() || '127.0.0.1'

if (!['127.0.0.1', '::1', 'localhost'].includes(host) && AI_AUTH_MODE !== 'required') {
  console.error(
    `dev api: not listening on ${host} with AI_AUTH=${AI_AUTH_MODE}: anyone on that network could ` +
      'spend the Nebius key without signing in. Drop HOST and use adb reverse, or drop AI_AUTH.',
  )
  process.exit(1)
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  const route = ROUTES[url.pathname]
  const started = Date.now()
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }))
    return
  }
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }
    const { default: handler } = await route()
    const response = await handler(new Request(url, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined }))
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(Buffer.from(await response.arrayBuffer()))
    console.log(`${req.method} ${url.pathname} -> ${response.status} in ${Date.now() - started} ms`)
  } catch (err) {
    console.error(`${req.method} ${url.pathname} crashed:`, err)
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }))
  }
}).listen(port, host, () => console.log(`dev api on http://${host.includes(':') ? `[${host}]` : host}:${port}`))
