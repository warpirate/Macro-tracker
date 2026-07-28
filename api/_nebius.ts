import OpenAI from 'openai'

/**
 * Zero-width space, non-joiner, joiner, and the byte-order mark. Built from escapes on
 * purpose: a literal one of these in source would be invisible and unreviewable.
 */
const INVISIBLE = new RegExp('[\\u200B\\u200C\\u200D\\uFEFF]', 'g')

/**
 * Returns the trimmed value, or null when the variable is missing OR blank.
 *
 * `??` is not enough for a dashboard-supplied variable. A name that exists with an empty
 * value is not null, so `process.env.X ?? fallback` hands the empty string straight
 * through — and `new OpenAI({ baseURL: '' })` throws "Invalid URL string.", an error that
 * names neither the variable nor the file. Every AI endpoint 500s and nothing says why.
 *
 * Zero-width characters are stripped for the same reason they are in the Supabase client:
 * they survive a copy-paste into a dashboard field, are invisible in it, and break the
 * request with an unrelated-looking error.
 */
const read = (value: string | undefined): string | null => {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(INVISIBLE, '').trim().replace(/^["']|["']$/g, '')
  return cleaned.length > 0 ? cleaned : null
}

/** Where Nebius Token Factory lives when nothing overrides it. */
const DEFAULT_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'

/**
 * Returns the override only if it is a URL the SDK can actually use.
 *
 * `new OpenAI({ baseURL })` parses the value in its constructor, at module load, so a
 * malformed override does not fail the one request that needed it — it throws
 * "Invalid URL string." before the handler body runs, and every AI endpoint returns a 500
 * naming neither the variable nor this file. That is exactly how chat, photo analysis and
 * the coach were all dead in production at once.
 *
 * A wrong-but-parseable URL still fails, loudly, at request time. That is the right place
 * for it. What must never happen is the whole surface 500ing because a dashboard field
 * picked up a pair of quotes.
 */
const usableUrl = (value: string | null): string | null => {
  if (value === null) return null
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

/**
 * Nebius Token Factory — OpenAI-compatible inference endpoint.
 * Models are listed at GET {BASE_URL}/models.
 */
export const BASE_URL = usableUrl(read(process.env.NEBIUS_BASE_URL)) ?? DEFAULT_BASE_URL

/** Tool-calling model used by the chat assistant. */
export const CHAT_MODEL = read(process.env.NEBIUS_CHAT_MODEL) ?? 'Qwen/Qwen3-235B-A22B-Instruct-2507'

/** Vision model used for meal photo analysis. */
export const VISION_MODEL = read(process.env.NEBIUS_VISION_MODEL) ?? 'Qwen/Qwen2.5-VL-72B-Instruct'

/** The key is the one value with no safe default — fail naming it, not "Invalid URL". */
export const API_KEY = read(process.env.NEBIUS_API_KEY)

export const client = new OpenAI({
  apiKey: API_KEY ?? '',
  baseURL: BASE_URL,
})

/**
 * Throws a message a human can act on when the deployment has no key.
 *
 * Call at the top of every handler. Without it the request reaches Nebius and comes back
 * as a bare 401, which reads like an outage at the provider rather than a missing variable
 * in this project's settings.
 */
export const requireApiKey = (): string => {
  if (API_KEY === null) {
    throw new Error(
      'NEBIUS_API_KEY is not set on this deployment. Add it in Vercel → Project → ' +
        'Settings → Environment Variables, then redeploy — environment changes do not ' +
        'apply to builds that already exist.',
    )
  }
  return API_KEY
}
