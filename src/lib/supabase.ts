import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (import.meta as any).env ?? {}

/** Zero-width space, non-joiner, joiner, and the byte-order mark. */
const INVISIBLE = new RegExp('[\u200B\u200C\u200D\uFEFF]', 'g')

/**
 * Strips whitespace, surrounding quotes and any zero-width/BOM characters from an
 * environment value.
 *
 * The anon key travels in the `apikey` and `Authorization` HTTP headers. A header value
 * containing a code point above U+00FF makes `fetch` throw before the request is even
 * sent - "String contains non ISO-8859-1 code point" - so every Supabase call fails with
 * an error naming neither the header nor the variable that caused it.
 *
 * A leading U+FEFF is the usual culprit: invisible in a dashboard field, and it rides
 * along when a key is pasted from a UTF-8-with-BOM file. Sanitising here means one bad
 * paste can never take the whole app down again.
 */
const clean = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(INVISIBLE, '').trim().replace(/^["']|["']$/g, '')
    : ''

const supabaseUrl = clean(env.VITE_SUPABASE_URL)
const supabaseAnonKey = clean(env.VITE_SUPABASE_ANON_KEY)

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
