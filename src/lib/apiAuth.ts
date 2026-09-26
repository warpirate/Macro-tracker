import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/*
  The AI endpoints (/api/chat, /api/analyze-photo, /api/recommend) only answer a signed-in
  user now: api/_auth.ts checks the bearer token with Supabase and counts each call against
  a per-user limit, because until then anyone with the URL could spend the owner's Nebius
  key. Every call site goes through these two helpers so the header and the wording of a
  refusal cannot drift apart between screens.
*/

/** Thrown by aiAuthHeaders() when the session is alive but could not be refreshed. */
export const AI_SESSION_UNREACHABLE_MESSAGE =
  'Could not refresh your sign-in. Check your connection and try again.'

const sessionHeaders = async (): Promise<Record<string, string>> => {
  let result: Awaited<ReturnType<typeof supabase.auth.getSession>>
  try {
    result = await supabase.auth.getSession()
  } catch {
    // Storage blocked or the client misconfigured: sent as no session, and the server's 401
    // then says so in words, which beats an exception that names neither cause nor fix.
    return {}
  }
  const token = result.data.session?.access_token
  if (token) return { Authorization: `Bearer ${token}` }
  /*
    No session is not always "signed out". When the access token has expired and the
    refresh fails on the network (a flaky connection, a laptop just off sleep), supabase-js
    answers { session: null, error } but keeps the session, because the refresh can still
    succeed. Sending the request without a token would earn a 401 and tell a signed-in user
    to sign out and back in, when trying again was all it needed. Only a network failure is
    treated this way; a refresh token the server rejected really has ended the session.
  */
  if (result.error !== null && isAuthRetryableFetchError(result.error)) {
    throw new Error(AI_SESSION_UNREACHABLE_MESSAGE)
  }
  return {}
}

/** Rejects once `signal` aborts, so a stalled lookup is bounded by the request's own timeout. */
const whenAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'))
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })

/**
 * Returns `{ Authorization: 'Bearer <access token>' }` for the current session, or `{}`
 * when there is none.
 *
 * getSession() refreshes an access token that has expired or is about to, so the token sent
 * is one the server will accept for as long as the session itself is alive. That refresh is
 * a network call with no timeout of its own, so pass the request's `signal` where the
 * request has a timeout: the lookup then gives up with it, instead of holding a spinner (and
 * any in-flight guard) until the network decides.
 *
 * Throws only when the session could not be refreshed for a network reason (with
 * AI_SESSION_UNREACHABLE_MESSAGE) or `signal` aborted. Every call site awaits this inside
 * the same try as its fetch, so both land in the "try again" path a failed request takes.
 */
export const aiAuthHeaders = (signal?: AbortSignal): Promise<Record<string, string>> =>
  signal === undefined ? sessionHeaders() : Promise.race([sessionHeaders(), whenAborted(signal)])

/**
 * The web app only renders behind a sign-in, so a 401 from an AI endpoint means the session
 * died underneath a user who is still looking at the app (signed out elsewhere, revoked).
 * Sign-out lives on Profile; saying where is what makes the message actionable.
 */
export const AI_SIGNED_OUT_MESSAGE =
  'Your sign-in has expired. Sign out from Profile and sign back in to use the coach.'

/** Used when a 429 arrives without the server's own sentence, e.g. from the platform. */
const AI_LIMIT_FALLBACK = "You've reached the coach's usage limit for now. Try again later."

/**
 * Returns the sentence to show for a refusal the user can act on, or null when the failure
 * is something else and the caller's own wording should stand.
 *
 * 401 always reads as "sign in again", whatever the body says. A 429 prefers the server's
 * sentence, because only the server knows whether this was the per-minute ceiling ("wait a
 * minute") or the daily one ("about 6 hours"), and those promise very different waits.
 */
export const aiRefusalMessage = (status: number, payload: unknown): string | null => {
  if (status === 401) return AI_SIGNED_OUT_MESSAGE
  if (status !== 429) return null
  const error =
    typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : undefined
  return typeof error === 'string' && error.trim().length > 0 ? error.trim() : AI_LIMIT_FALLBACK
}
