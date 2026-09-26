import { read } from './_nebius'

/*
  Who may spend the Nebius key, and how fast.

  Until this existed, /api/chat, /api/analyze-photo and /api/recommend answered anyone who
  could reach them: no sign-in, no ceiling, every call billed to the owner's key. The URLs
  ship inside the mobile bundle and the web app's JavaScript, so "nobody knows the address"
  was never a control.

  Every AI handler now calls requireAiCaller() straight after its method check. It does two
  things, in parallel so the pair costs one round trip rather than two:

    1. Asks Supabase Auth who the bearer token belongs to (GET /auth/v1/user). This is the
       gate, and it FAILS CLOSED: no token, a token Supabase rejects, or no Supabase config
       at all means no model call. Checking with Auth rather than only verifying the JWT
       signature locally also catches sessions that were signed out or revoked.

    2. Bumps the caller's usage counters (bump_ai_usage() in
       supabase/migrations/20260926000100_ai_usage.sql) and refuses with a 429 past the
       ceilings in AI_LIMITS. When the database cannot count (the migration is not applied,
       it is slow, it errors) the request is NOT refused for that reason alone: a limiter
       outage should cost some money, not the whole coach. But it is not waved through
       uncounted either, because a signed-in caller can CAUSE those failures (flood one
       counter row until the bumps queue past the timeout, or tie up PostgREST with direct
       RPC calls under their own token), and "the harder you push, the less gets counted"
       would make the limit an invitation. So every instance also keeps its own count in
       memory, and when the database cannot answer, that count is held to the same
       ceilings. It is per instance, so it is looser than the real limit, but it is a
       limit. Every fallback is logged, summarised once a minute per instance, so a
       sustained outage or bypass shows up in the logs instead of hiding behind one line.

  ROLLOUT. AI_AUTH in the Vercel environment picks one of three modes:

    required (the default)  both checks, as above.
    soft                    a call WITH a token gets both checks; a call without one is let
                            through uncounted, and those are tallied in the logs once a
                            minute per instance.
    off                     neither check: the behaviour before this file existed.

  Soft exists for the changeover. App builds from before this file send no token, and the
  Android app is a sideloaded APK with no over-the-air update, so an installed build only
  stops calling when its owner installs a newer one, and "Check for updates" can only offer
  a release that has been published. The order that breaks nobody:
    1. Publish a mobile release that sends the token. It works against a server without
       this file too, which ignores the header.
    2. Deploy this file with AI_AUTH=soft. Signed-in callers are limited from then on.
    3. Remove AI_AUTH (required) once the tokenless tally is down to what you are willing
       to cut off. A script that omits the token looks the same as an old build, which is
       why soft cannot be the end state.
  Deploying with the variable unset skips straight to step 3, and the coach, photo scans and
  plans stop for every installed APK that predates the token. Anything other than exactly
  "soft" or "off" means required, so a typo in that field closes the door instead of opening
  it. Like every env change, a new value needs a redeploy.

  Supabase config: SUPABASE_URL / SUPABASE_ANON_KEY when set, otherwise the VITE_ pair the
  web build already uses. Vercel exposes every project variable to functions, so an
  existing deployment needs nothing new.

  RUNNING THE HANDLERS ON THIS MACHINE. Both local scripts trip over the gate unless told:

    - scripts/dev-api.ts serving the PHONE: the phone signs in to the production project,
      but the web .env points VITE_SUPABASE_URL at the local Supabase stack, so every token
      is checked against the wrong project. Chat and photos then fail with "sign-in
      expired" (local stack up) or a 503 (local stack down), and signing in again cannot
      fix either. Set SUPABASE_URL and SUPABASE_ANON_KEY to the project the app signs in to
      (they win over the VITE_ pair), or run with AI_AUTH=off:
        AI_AUTH=off npx tsx --env-file=.env scripts/dev-api.ts
      That script listens on loopback only (the phone reaches it through `adb reverse`), and
      refuses to listen anywhere wider unless the gate is fully on, so AI_AUTH=off opens the
      Nebius key to this machine and not to everyone on its network.
      A rejected token whose issuer differs from SUPABASE_URL is logged saying exactly this.

    - scripts/eval-coach.ts calls the chat handler with no token at all, so it needs
      AI_AUTH=off on its command line:
        AI_AUTH=off npx tsx --env-file=.env scripts/eval-coach.ts
      AI_AUTH is read when this module loads, which is before any line of the script runs,
      so setting process.env.AI_AUTH inside the script is too late.
*/

/** The AI endpoints, by the names bump_ai_usage() accepts. Adding one means adding it there too. */
export type AiEndpoint = 'chat' | 'analyze-photo' | 'recommend'

interface AiLimit {
  perMinute: number
  perDay: number
  /** What one call is, in the words the 429 message uses. */
  noun: string
}

/**
 * Ceilings per signed-in user. Change them here; the database only counts.
 *
 * Sized so a real person never meets them: 300 coach messages is a conversation every few
 * minutes from breakfast to bed, and nobody photographs a hundred meals. What they stop is
 * a script. The per-minute ceiling is the one a stuck retry loop hits first; the daily
 * ceiling bounds how MANY calls one account makes. The day is the UTC day, so it rolls
 * over at 05:30 IST.
 *
 * What these do NOT bound is how big each call is. The bill is calls × tokens, and the
 * request body decides the tokens, so each handler caps what it hands the model: chat.ts
 * its trimmed history plus data pack, recommend.ts its body, analyze-photo.ts the image.
 * Those caps live in the handlers, which know what a legitimate body looks like; this file
 * only decides who may call and how often.
 */
export const AI_LIMITS: Record<AiEndpoint, AiLimit> = {
  chat: { perMinute: 20, perDay: 300, noun: 'coach messages' },
  'analyze-photo': { perMinute: 10, perDay: 100, noun: 'photo scans' },
  recommend: { perMinute: 5, perDay: 30, noun: 'plan refreshes' },
}

/*
  Both checks come out of the same 25s edge budget as the model calls (EDGE_LIMIT_MS in
  ./_nebius). They run in parallel, so the worst case is the larger of the two, 2s; a
  healthy Supabase answers in well under a tenth of that. Chat is the tightest fit: its two
  model calls are budgeted 13s + 7s, and each has a 1s signal backstop on top, so the
  worst case is 2 + 14 + 8 = 24s, inside the limit. At 3s it was exactly 25s, which is a
  FUNCTION_INVOCATION_TIMEOUT. Raise either number only after taking the time from chat.
  The limiter gets less than Auth because giving up on it only means falling back to the
  in-memory count below.
*/
const AUTH_TIMEOUT_MS = 2000
const LIMIT_TIMEOUT_MS = 1500

const RAW_AI_AUTH = read(process.env.AI_AUTH)?.toLowerCase() ?? null

/**
 * The mode AI_AUTH selects (see ROLLOUT above). Exported so scripts/dev-api.ts can refuse to
 * serve the network while the gate is not fully on, reading the variable exactly as this does.
 */
export const AI_AUTH_MODE: 'required' | 'soft' | 'off' =
  RAW_AI_AUTH === 'off' ? 'off' : RAW_AI_AUTH === 'soft' ? 'soft' : 'required'

if (AI_AUTH_MODE === 'off') {
  console.warn('[ai-auth] AI_AUTH=off: the AI endpoints accept anyone, with no rate limit.')
} else if (AI_AUTH_MODE === 'soft') {
  console.warn('[ai-auth] AI_AUTH=soft: calls without a sign-in token are let through uncounted.')
} else if (RAW_AI_AUTH !== null && RAW_AI_AUTH !== 'required') {
  console.warn(`[ai-auth] AI_AUTH="${RAW_AI_AUTH}" is not "required", "soft" or "off"; treating it as required.`)
}

/** Where to ask, and the key to ask with; or the sentence explaining why we cannot. */
type SupabaseConfig = { url: string; anonKey: string } | { error: string }

/** `problem` names the variable and what is wrong with it; the rest says what to do. */
const configError = (problem: string): { error: string } => ({
  error:
    `${problem}, so the AI endpoints cannot check who is signed in and are refusing every ` +
    'request. Fix it in Vercel → Project → Settings → Environment Variables, then redeploy — ' +
    'environment changes do not apply to builds that already exist.',
})

/**
 * The first of SUPABASE_URL, VITE_SUPABASE_URL that holds a URL that parses.
 *
 * Each is parsed on its own, so the error names the variable that actually holds the bad
 * value (the same misleading-error trap ./_nebius's usableUrl() exists for), and a mistyped
 * SUPABASE_URL does not hide a working VITE_SUPABASE_URL. Falling back is logged, because
 * an override that silently does nothing is its own kind of confusing.
 *
 * Static `process.env.X` reads, not process.env[name]: that is the form every bundler and
 * runtime is guaranteed to fill in.
 */
const resolveUrl = (): { url: string } | { error: string } => {
  const candidates: ReadonlyArray<readonly [string, string | null]> = [
    ['SUPABASE_URL', read(process.env.SUPABASE_URL)],
    ['VITE_SUPABASE_URL', read(process.env.VITE_SUPABASE_URL)],
  ]
  const invalid: string[] = []
  for (const [name, value] of candidates) {
    if (value === null) continue
    try {
      const url = new URL(value).toString().replace(/\/+$/, '')
      if (invalid.length > 0) console.warn(`[ai-auth] ${invalid.join(', ')} is not a valid URL; using ${name}.`)
      return { url }
    } catch {
      invalid.push(name)
    }
  }
  if (invalid.length === 0) {
    return configError('SUPABASE_URL is not set on this deployment (VITE_SUPABASE_URL would also do)')
  }
  return configError(
    `${invalid.join(' and ')} ${invalid.length === 1 ? 'is not a valid URL' : 'are not valid URLs'} on this deployment`,
  )
}

/**
 * Read once, at load, like ./_nebius. A URL that does not parse is reported as its own
 * problem here: left to fetch(), it would surface as a vague network failure on every
 * request and read like a Supabase outage.
 */
const SUPABASE: SupabaseConfig = (() => {
  const resolved = resolveUrl()
  if ('error' in resolved) return resolved
  const anonKey = read(process.env.SUPABASE_ANON_KEY) ?? read(process.env.VITE_SUPABASE_ANON_KEY)
  if (anonKey === null) {
    return configError('SUPABASE_ANON_KEY is not set on this deployment (VITE_SUPABASE_ANON_KEY would also do)')
  }
  return { url: resolved.url, anonKey }
})()

/*
  What the user reads. Written for people, because an older mobile build shows a handler's
  own `error` string in preference to anything generic.

  NOT_SIGNED_IN is worded for the only people who will ever read it. Current clients word
  every 401 themselves (only they know whether the person has an account), so this sentence
  reaches just the builds from before this file: APKs already installed, and web tabs still
  running the old bundle. None of them send a token, and every one of their users is already
  signed in, since those builds only reach chat and photos behind an account. "Sign in" would
  send them round a loop that cannot work; updating is the fix. It names no menu, because
  the oldest APKs have no "Check for updates" at all, and it is only true once a release that
  sends the token is published, which is step 1 of ROLLOUT.
*/
const NOT_SIGNED_IN =
  'This version of MacroFit can no longer reach the coach. Install the latest version of the ' +
  'app, or reload the page if you are on the web, then try again.'
const SESSION_REJECTED = 'Your sign-in has expired. Sign in again to use the coach.'
const AUTH_UNAVAILABLE = 'Could not check your sign-in just now. Try again in a moment.'

const json = (payload: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/** Returns the token from `Authorization: Bearer <jwt>`, or null when there is none. */
const bearerToken = (req: Request): string | null => {
  const header = req.headers.get('authorization')
  if (header === null) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match === null ? null : match[1]
}

/**
 * The origin in the token's `iss` claim when it differs from the project this deployment
 * checks against, else null.
 *
 * UNVERIFIED, and used for one thing only: a log line after Supabase has already said no.
 * It never lets anything through and never refuses anything on its own, so a forged claim
 * can at most write a misleading log line, and a custom domain whose issuer does not match
 * cannot lock anyone out. What it buys is the difference between "sign-in expired" on a
 * phone pointed at a dev server and a log that names the real problem: the token comes from
 * a different Supabase project than the one in SUPABASE_URL.
 */
const foreignIssuer = (token: string, url: string): string | null => {
  const payload = token.split('.')[1]
  if (payload === undefined || payload.length === 0) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { iss?: unknown }
    if (typeof claims.iss !== 'string') return null
    const issuer = new URL(claims.iss).origin
    return issuer === new URL(url).origin ? null : issuer
  } catch {
    return null
  }
}

/** Logs the likely cause when a refused token was issued by another project. */
const explainForeignToken = (token: string, url: string): void => {
  const issuer = foreignIssuer(token, url)
  if (issuer === null) return
  console.error(
    `[ai-auth] this token was issued by ${issuer}, but this server checks sign-ins against ` +
      `${new URL(url).origin}. If the app signs in to a different project than this server ` +
      '(e.g. scripts/dev-api.ts with the web .env while the phone uses production), set ' +
      'SUPABASE_URL and SUPABASE_ANON_KEY to the project the app uses, or run with AI_AUTH=off.',
  )
}

type Verification =
  | { kind: 'user'; id: string }
  /** Supabase looked at the token and said no. The user's problem: 401. */
  | { kind: 'rejected' }
  /** Supabase refused OUR key. The deployment's problem: 500, naming the variable. */
  | { kind: 'misconfigured' }
  /** No answer we can use: timeout, network, 5xx. Nobody's fault yet: 503. */
  | { kind: 'unavailable'; detail: string }

/**
 * Asks Supabase Auth whose token this is.
 *
 * A 401 is not always about the user. The API gateway answers "Invalid API key" with a 401
 * too, when the deployment's anon key is wrong, and reporting that as "your sign-in has
 * expired" would send every user to sign out and back in for a problem in this project's
 * settings. The body tells the two apart.
 */
const verifyUser = async (url: string, anonKey: string, token: string): Promise<Verification> => {
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    })

    if (res.status === 401 || res.status === 403) {
      const body = await res.text()
      return /api key/i.test(body) ? { kind: 'misconfigured' } : { kind: 'rejected' }
    }
    if (!res.ok) return { kind: 'unavailable', detail: `auth answered HTTP ${res.status}` }

    const user = (await res.json()) as { id?: unknown; is_anonymous?: unknown }
    if (typeof user.id !== 'string' || user.id.length === 0) {
      return { kind: 'unavailable', detail: 'auth answered 200 without a user id' }
    }
    /*
      Anonymous sign-in is off for this project today. If it is ever switched on, anyone could
      mint a session with no email at all and each one would carry its own daily allowance,
      which is the open door this file exists to close. So an anonymous session is refused
      here regardless of the dashboard setting.
    */
    if (user.is_anonymous === true) return { kind: 'rejected' }
    return { kind: 'user', id: user.id }
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Running totals for this user and endpoint, including the call being made now. */
interface Usage {
  minute: number
  day: number
}

type Count =
  | { kind: 'counted'; usage: Usage }
  /** PostgREST does not know bump_ai_usage(): the migration has not been applied. */
  | { kind: 'missing' }
  /** PostgREST refused the token. Only worth a log line when Auth accepted it. */
  | { kind: 'unauthorized' }
  /** Timeout, network, 5xx, or a reply of the wrong shape. */
  | { kind: 'unavailable'; detail: string }

/**
 * Counts this call in the database and returns the totals, or why it could not.
 *
 * Sent with the USER's token, not a service key: bump_ai_usage() takes the user from
 * auth.uid(), so the counter it moves is always the caller's own and this deployment needs
 * no secret beyond the anon key it already has.
 */
const bumpUsage = async (url: string, anonKey: string, token: string, endpoint: AiEndpoint): Promise<Count> => {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/bump_ai_usage`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_endpoint: endpoint }),
      signal: AbortSignal.timeout(LIMIT_TIMEOUT_MS),
    })
    // PostgREST answers 404 (PGRST202) for a function it does not have.
    if (res.status === 404) return { kind: 'missing' }
    if (res.status === 401) return { kind: 'unauthorized' }
    if (!res.ok) return { kind: 'unavailable', detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
    const body = (await res.json()) as { minute?: unknown; day?: unknown }
    if (typeof body.minute !== 'number' || typeof body.day !== 'number') {
      return { kind: 'unavailable', detail: `unexpected reply ${JSON.stringify(body).slice(0, 200)}` }
    }
    return { kind: 'counted', usage: { minute: body.minute, day: body.day } }
  } catch (error) {
    return { kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) }
  }
}

/*
  This instance's own count of every verified call, per user and endpoint, in the same
  windows the database uses (the UTC minute and the UTC day).

  Kept for EVERY call, not only once the database fails: a flood that pushes the database
  past its timeout was already being counted here as it arrived, so the fallback starts
  from the true figure for this instance rather than from zero. And the larger of the two
  counts is the one enforced, so calls that slipped past an outage still count once the
  database is back.

  Bounded: past LOCAL_MAX_KEYS callers the map is cleared and starts over. That forgets
  some counts on a very busy instance, which only matters while the database is also down.
*/
interface LocalCount {
  minuteStart: number
  minute: number
  dayStart: number
  day: number
}

const LOCAL_MAX_KEYS = 10_000
const localCounts = new Map<string, LocalCount>()

const countLocally = (userId: string, endpoint: AiEndpoint, now: number): Usage => {
  // Epoch milliseconds start at a UTC midnight and JavaScript time has no leap seconds, so
  // these line up with date_trunc('minute') and date_trunc('day', ..., 'UTC') in the database.
  const minuteStart = now - (now % 60_000)
  const dayStart = now - (now % 86_400_000)
  const key = `${userId}:${endpoint}`
  let entry = localCounts.get(key)
  if (entry === undefined) {
    if (localCounts.size >= LOCAL_MAX_KEYS) localCounts.clear()
    entry = { minuteStart, minute: 0, dayStart, day: 0 }
    localCounts.set(key, entry)
  }
  if (entry.minuteStart !== minuteStart) {
    entry.minuteStart = minuteStart
    entry.minute = 0
  }
  if (entry.dayStart !== dayStart) {
    entry.dayStart = dayStart
    entry.day = 0
  }
  entry.minute += 1
  entry.day += 1
  return { minute: entry.minute, day: entry.day }
}

/*
  One line per instance per minute, carrying how many calls took the path since the last
  line. Used while the database cannot count, and for the calls soft mode lets through. One
  line per call would drown the logs (an unapplied migration, a changeover that runs for
  weeks); one line per instance, ever, would hide a bypass that runs all day.
*/
const REPORT_MS = 60_000

const calls = (n: number): string => `${n} call${n === 1 ? '' : 's'}`

const tally = (describe: (count: number, detail: string) => string) => {
  let reportedAt = -Infinity
  let sinceReport = 0
  return (detail: string, now: number): void => {
    sinceReport += 1
    if (now - reportedAt < REPORT_MS) return
    console.warn(describe(sinceReport, detail))
    reportedAt = now
    sinceReport = 0
  }
}

const noteFallback = tally(
  (n, reason) =>
    `[ai-auth] rate limiter unavailable, limiting from this instance's memory only ` +
    `(${calls(n)} since the last report): ${reason}`,
)

/** The number that says when soft mode can become required: old builds still calling. */
const noteTokenless = tally(
  (n, endpoint) =>
    `[ai-auth] AI_AUTH=soft let through ${calls(n)} with no sign-in token since the last ` +
    `report (this one to /api/${endpoint})`,
)

/** Seconds until the next minute boundary, 1 to 60. */
const secondsToNextMinute = (now: number): number => 60 - Math.floor((now % 60_000) / 1000)

/** Seconds until the next UTC midnight, the same boundary bump_ai_usage() counts days by. */
const secondsToNextUtcDay = (now: number): number => {
  const d = new Date(now)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  return Math.max(1, Math.ceil((midnight - now) / 1000))
}

/** "about 6 hours", "about 40 minutes": a wait a person can plan around. */
const roughly = (seconds: number): string => {
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return minutes <= 1 ? 'a minute' : `${minutes} minutes`
  const hours = Math.round(seconds / 3600)
  return hours <= 1 ? 'an hour' : `${hours} hours`
}

/**
 * The 429 for a caller past either ceiling, or null when they are within both.
 *
 * The day is checked first: when both are exceeded, "wait a minute" would be a promise the
 * next request breaks. `limit` and `retryAfterSeconds` ride along in the body for clients
 * that want to branch on them, and Retry-After says the same thing in HTTP's own terms.
 */
const refuseOverLimit = (endpoint: AiEndpoint, userId: string, usage: Usage, now: number): Response | null => {
  const limit = AI_LIMITS[endpoint]

  if (usage.day > limit.perDay) {
    // Logged at the crossing only, so the owner can see who hit the ceiling without one line
    // per refused retry.
    if (usage.day === limit.perDay + 1) {
      console.warn(`[ai-auth] user ${userId} reached the daily ${endpoint} limit (${limit.perDay})`)
    }
    const wait = secondsToNextUtcDay(now)
    return json(
      {
        error: `You've used all ${limit.perDay} of today's ${limit.noun}. Try again in about ${roughly(wait)}.`,
        limit: 'day',
        retryAfterSeconds: wait,
      },
      429,
      { 'Retry-After': String(wait) },
    )
  }

  if (usage.minute > limit.perMinute) {
    const wait = secondsToNextMinute(now)
    return json(
      {
        error: `Too many ${limit.noun} at once. Wait a minute and try again.`,
        limit: 'minute',
        retryAfterSeconds: wait,
      },
      429,
      { 'Retry-After': String(wait) },
    )
  }

  return null
}

/** Who is calling. `userId` is null only when AI_AUTH=off, or soft and the call had no token. */
export interface AiCaller {
  userId: string | null
}

/**
 * Returns the verified caller, or a finished Response the handler must return as-is.
 *
 *   const caller = await requireAiCaller(req, 'chat')
 *   if (caller instanceof Response) return caller
 *
 * 401 no token, or one Supabase rejects · 429 over a limit · 503 Supabase Auth did not
 * answer in time · 500 the deployment has no usable Supabase config. Never throws.
 */
export const requireAiCaller = async (req: Request, endpoint: AiEndpoint): Promise<AiCaller | Response> => {
  if (AI_AUTH_MODE === 'off') return { userId: null }

  const token = bearerToken(req)
  // Before the config check: soft mode's whole job is keeping old builds working, and a
  // config problem is no reason to cut them off early. Calls with a token still meet it.
  if (token === null && AI_AUTH_MODE === 'soft') {
    noteTokenless(endpoint, Date.now())
    return { userId: null }
  }

  if ('error' in SUPABASE) {
    console.error(`[ai-auth] ${SUPABASE.error}`)
    return json({ error: SUPABASE.error }, 500)
  }

  if (token === null) return json({ error: NOT_SIGNED_IN }, 401)

  const [verified, count] = await Promise.all([
    verifyUser(SUPABASE.url, SUPABASE.anonKey, token),
    bumpUsage(SUPABASE.url, SUPABASE.anonKey, token, endpoint),
  ])

  switch (verified.kind) {
    case 'rejected':
      explainForeignToken(token, SUPABASE.url)
      return json({ error: SESSION_REJECTED }, 401)
    case 'misconfigured': {
      const error =
        'Supabase rejected this deployment\'s anon key, so the AI endpoints cannot check who ' +
        'is signed in. Check SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) against the ' +
        'project in SUPABASE_URL, then redeploy.'
      console.error(`[ai-auth] ${error}`)
      return json({ error }, 500)
    }
    case 'unavailable':
      console.error(`[ai-auth] could not verify a session for /api/${endpoint}: ${verified.detail}`)
      explainForeignToken(token, SUPABASE.url)
      return json({ error: AUTH_UNAVAILABLE }, 503)
    case 'user':
      break
  }

  const now = Date.now()
  const local = countLocally(verified.id, endpoint, now)

  let usage: Usage
  switch (count.kind) {
    case 'counted':
      // The larger of the two, so calls this instance let through during an outage still
      // count against the caller once the database is answering again.
      usage = { minute: Math.max(count.usage.minute, local.minute), day: Math.max(count.usage.day, local.day) }
      break
    case 'missing':
      noteFallback('bump_ai_usage() does not exist; apply supabase/migrations/20260926000100_ai_usage.sql', now)
      usage = local
      break
    case 'unauthorized':
      // Auth accepted this token and PostgREST did not, e.g. a JWT secret or signing-key
      // rotation one of them has not picked up. Every call would otherwise pass uncounted
      // without a word.
      noteFallback('PostgREST rejected a token Supabase Auth accepted', now)
      usage = local
      break
    case 'unavailable':
      noteFallback(count.detail, now)
      usage = local
      break
  }

  const refusal = refuseOverLimit(endpoint, verified.id, usage, now)
  if (refusal !== null) return refusal

  return { userId: verified.id }
}
