import { supabase } from './supabase'

const BUCKET = 'progress-photos'

/*
  WHY A PHOTO IS STORED AS A REFERENCE, NOT A URL

  Progress photos are body photos. The bucket used to be public, and the getPublicUrl()
  result went into ProgressPhoto.dataUrl: a permanent link that needed no sign-in, copied
  into the synced JSON blob and anywhere that blob travelled. The bucket is now private
  (supabase/migrations/20260926000000_private_progress_photos.sql), so there is no permanent
  link to store any more. The synced value is the object's path behind a prefix, and each
  device that shows the photo mints its own short-lived signed URL for it.

  ProgressPhoto.dataUrl can therefore hold three shapes, and every reader goes through
  resolvePhotoSrc() rather than handing the raw value to an <img>:

    data:image/jpeg;base64,...                      taken signed out, or the upload failed
    storage:progress-photos/{userId}/{photoId}.jpg  the reference written today
    https://…/storage/v1/object/public/progress-photos/{userId}/{photoId}.jpg
                                                    legacy: what existing accounts hold

  The legacy URL is dead as a link once the bucket is private, but the path inside it is
  still good, so it is signed exactly like a reference. That is why no data migration is
  needed: old entries keep working through this code before and after the bucket flips.
*/

/** Prefix that marks a stored value as a path in the photo bucket. Never a valid URL scheme an <img> would try. */
export const PHOTO_REF_PREFIX = `storage:${BUCKET}/`

/** The part of a legacy public URL that precedes the object path. */
const LEGACY_PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`

/** Lifetime of a signed URL: a long session on the page, but a leaked link dies within the hour. */
const SIGNED_URL_TTL_S = 60 * 60

/** A cached URL is re-signed this long before it expires, so an <img> is never handed one that dies mid-load. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/**
 * How long one signing request may take before its photos count as failed. createSignedUrls
 * takes no abort signal, so a stalled request (a half-open socket, a hung auth refresh) would
 * otherwise hold every tile on the shimmer, with every retry joining the same stuck promise.
 */
const SIGN_TIMEOUT_MS = 15_000

/** Where a photo's file lives in the bucket; the insert/select/delete policies key on the first segment. */
const objectPath = (userId: string, photoId: string): string => `${userId}/${photoId}.jpg`

/** True for a photo held inline as base64: it needs no network and no signing. */
export const isInlinePhoto = (stored: string): boolean => stored.startsWith('data:')

/**
 * The object path inside the bucket for a stored photo value, or null when the value does
 * not point into the bucket (an inline data: URL, empty, or something unrecognised).
 */
export const photoStoragePath = (stored: string | null | undefined): string | null => {
  if (!stored || isInlinePhoto(stored)) return null
  if (stored.startsWith(PHOTO_REF_PREFIX)) return stored.slice(PHOTO_REF_PREFIX.length) || null

  const at = stored.indexOf(LEGACY_PUBLIC_MARKER)
  if (at === -1) return null
  const raw = stored.slice(at + LEGACY_PUBLIC_MARKER.length).split(/[?#]/)[0]
  try {
    return decodeURIComponent(raw) || null
  } catch {
    // A malformed escape cannot name a real object; treat it as unrecognised.
    return null
  }
}

/**
 * Upload a compressed image (data URL) to Supabase Storage.
 * Returns the reference to store in ProgressPhoto.dataUrl, or null on failure (the caller
 * then keeps the inline data URL, so the photo is never lost).
 */
export const uploadProgressPhoto = async (
  userId: string,
  photoId: string,
  dataUrl: string,
): Promise<string | null> => {
  try {
    // Convert data URL → Blob
    const res = await fetch(dataUrl)
    const blob = await res.blob()

    const path = objectPath(userId, photoId)
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true })

    if (error) {
      console.error('Photo upload error:', error.message)
      return null
    }

    return PHOTO_REF_PREFIX + path
  } catch (e) {
    console.error('Photo upload failed:', e)
    return null
  }
}

/*
  SIGNED URL CACHE

  Signing is a network round trip, and the gallery shows up to 20 photos at once. Two
  things keep that cheap:

  - A per-path cache of signed URLs, trusted until REFRESH_MARGIN_MS before expiry. The
    full-size viewer opening a photo the gallery already signed is then instant.
  - Batching. Every request made in the same tick (one per tile, all from the same React
    commit) is collected and sent as ONE createSignedUrls call on the next microtask,
    and a path already being signed shares that in-flight promise.

  Failures are not cached, so asking again (a retry, a remount, the <img> error path)
  really asks again. Memory only, by design: a signed URL is a bearer credential for a
  body photo, so it is never written to localStorage, and it belongs to the account that
  signed it (see ACCOUNT CHANGES).
*/

interface SignedEntry {
  url: string
  expiresAt: number
}

const signedCache = new Map<string, SignedEntry>()
const inflight = new Map<string, Promise<string | null>>()
let pendingBatch: Map<string, (url: string | null) => void> | null = null

/*
  ACCOUNT CHANGES

  A cached URL opens the photo for whoever holds it, and sign-out does not clear the local
  store (AuthContext keeps it), so the previous account's photo references can still be on
  screen for the next person on this tab. The cache must not outlive the account that
  filled it.

  So whenever the signed-in user changes (SIGNED_OUT, or a different account arriving with
  no sign-out in between), the cache and the in-flight map are emptied and `authGeneration`
  moves on. A batch that was already on the wire resolves null instead of caching its
  answer, because that answer was signed for the previous session. Subscribers then hear
  'revoked', and everything on screen resolves again under the new session. For someone
  else's photos that means RLS refuses, and a placeholder replaces the image.

  The same channel carries the two moments a photo that FAILED might now succeed: a session
  was established or refreshed ('restored'), or some other view cached a URL, perhaps for
  this very photo ('signed'). Without them one network blip would leave every gallery tile
  on its placeholder until the page remounted, because a batch fails as a unit.
*/

export type PhotoAccessChange =
  /** The signed-in user changed. Every signed URL on screen belongs to the previous one. */
  | 'revoked'
  /** A session was established or refreshed. A photo that failed may resolve now. */
  | 'restored'
  /** A new signed URL entered the cache. A failed photo may find its own there, no request needed. */
  | 'signed'

let authGeneration = 0
/** Undefined until the first auth event, so the initial session is not mistaken for a switch. */
let authUserId: string | null | undefined
const accessListeners = new Set<(change: PhotoAccessChange) => void>()

const notifyAccess = (change: PhotoAccessChange): void => {
  accessListeners.forEach(listener => listener(change))
}

/** Hear about the moments a photo's displayability may have changed. Returns the unsubscribe. */
export const subscribePhotoAccess = (listener: (change: PhotoAccessChange) => void): (() => void) => {
  accessListeners.add(listener)
  return () => {
    accessListeners.delete(listener)
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  const userId = session?.user?.id ?? null
  const switched = authUserId !== undefined && userId !== authUserId
  authUserId = userId

  let change: PhotoAccessChange | null = null
  if (event === 'SIGNED_OUT' || switched) {
    // Synchronous, so nothing can read the old account's URLs from here on.
    authGeneration++
    signedCache.clear()
    inflight.clear()
    change = 'revoked'
  } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    change = 'restored'
  }
  // Listeners go on to sign photos, and this callback runs inside the auth lock, where a
  // Supabase call can deadlock. They hear about it on the next task instead.
  if (change) {
    const heard = change
    setTimeout(() => notifyAccess(heard), 0)
  }
})

/**
 * Is `userId` still the signed-in account, as the auth events last reported it?
 *
 * For code that captured the user, awaited (an upload) and is about to write the result
 * into the store. Sign-out wipes the store while that await is pending, and the
 * next account inherits whatever lands in it afterwards, a body photo included. Synchronous
 * and module-level on purpose: it still answers after the page that started the work has
 * unmounted, and the caller checks and writes in the same tick, so no sign-out can land in
 * between. Before the first auth event nothing has changed yet, so it answers yes.
 */
export const isSignedInAs = (userId: string): boolean =>
  authUserId === undefined || authUserId === userId

const cachedUrl = (path: string): string | null => {
  const hit = signedCache.get(path)
  if (!hit) return null
  if (hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) return hit.url
  signedCache.delete(path)
  return null
}

const flushBatch = async (jobs: Map<string, (url: string | null) => void>): Promise<void> => {
  const paths = [...jobs.keys()]
  const generation = authGeneration
  // Taken before the request, so the recorded expiry is never later than the real one.
  const issuedAt = Date.now()
  const urls = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Past the deadline every photo in the batch resolves null: the inflight entries clear,
    // the tiles move to 'failed', and its retries (timer, online, visibility) take over. A
    // late answer from the abandoned request is simply dropped.
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), SIGN_TIMEOUT_MS)
    })
    const result = await Promise.race([
      supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S),
      timeout,
    ])
    if (result === 'timeout') {
      console.error('Photo signing timed out')
    } else {
      if (result.error) console.error('Photo signing error:', result.error.message)
      result.data?.forEach((row, i) => {
        // Per-row failures (object missing, not the caller's) come back as row.error with
        // no usable URL; those paths simply resolve to null below.
        const path = row.path ?? paths[i]
        if (!row.error && row.signedUrl && path) urls.set(path, row.signedUrl)
      })
    }
  } catch (e) {
    console.error('Photo signing failed:', e)
  } finally {
    clearTimeout(timer)
  }

  // The account changed while this was on the wire: these URLs were signed for someone else.
  const stillCurrent = generation === authGeneration
  const expiresAt = issuedAt + SIGNED_URL_TTL_S * 1000
  let cachedAny = false
  for (const [path, resolve] of jobs) {
    const url = stillCurrent ? urls.get(path) ?? null : null
    if (url) {
      signedCache.set(path, { url, expiresAt })
      cachedAny = true
    }
    resolve(url)
  }
  if (cachedAny) notifyAccess('signed')
}

const signPath = (path: string): Promise<string | null> => {
  const hit = cachedUrl(path)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(path)
  if (pending) return pending

  const promise = new Promise<string | null>(resolve => {
    if (!pendingBatch) {
      const jobs = new Map<string, (url: string | null) => void>()
      pendingBatch = jobs
      queueMicrotask(() => {
        pendingBatch = null
        void flushBatch(jobs)
      })
    }
    pendingBatch.set(path, resolve)
  })
  inflight.set(path, promise)
  // Only this request's own entry: after an account change the map may already hold a
  // newer request for the same path, which must stay joinable.
  void promise.then(() => {
    if (inflight.get(path) === promise) inflight.delete(path)
  })
  return promise
}

/**
 * What an <img> can show for a stored photo value RIGHT NOW, without waiting: the inline
 * data URL itself, or a still-fresh cached signed URL. Null means resolvePhotoSrc() is needed.
 */
export const peekPhotoSrc = (stored: string | null | undefined): string | null => {
  if (!stored) return null
  if (isInlinePhoto(stored)) return stored
  const path = photoStoragePath(stored)
  return path ? cachedUrl(path) : null
}

/**
 * Turns a stored ProgressPhoto.dataUrl into something an <img> can show. Inline data URLs
 * pass straight through; references and legacy public URLs become signed URLs. Resolves
 * to null when the photo cannot be shown (signed out, offline, object gone, or a value
 * this code does not recognise). Never rejects.
 */
export const resolvePhotoSrc = async (stored: string | null | undefined): Promise<string | null> => {
  if (!stored) return null
  if (isInlinePhoto(stored)) return stored
  const path = photoStoragePath(stored)
  return path ? signPath(path) : null
}

/** Drops any cached signed URL for this photo, so the next resolve signs afresh. */
export const forgetPhotoSrc = (stored: string | null | undefined): void => {
  const path = photoStoragePath(stored)
  if (path) signedCache.delete(path)
}

/**
 * Delete a progress photo's file from Supabase Storage.
 *
 * Two paths are removed, deduplicated. The one inside the stored value covers references
 * and legacy public URLs alike. The canonical {userId}/{photoId}.jpg covers the photo whose
 * stored value says "inline" while a file exists anyway: an upload that reached the bucket
 * but lost its response (a timeout, a dropped connection) reported failure, so the photo
 * was kept as a data: URL. Trusting the stored value alone would leave that body photo in
 * the bucket, where no screen can show it or delete it. Removing a path that holds nothing
 * is a no-op, and RLS keeps both inside the caller's own folder.
 *
 * Resolves true only when Storage confirmed the removal, so a caller can keep the photo's
 * entry (and its only handle on the file) when it did not. Never rejects.
 */
export const deleteProgressPhoto = async (
  userId: string,
  photoId: string,
  stored: string,
): Promise<boolean> => {
  const paths = new Set([objectPath(userId, photoId)])
  const fromStored = photoStoragePath(stored)
  if (fromStored) paths.add(fromStored)
  try {
    // Without this account's session the request goes out as anon, the owner-only DELETE
    // policy matches no rows, and Storage answers success with an empty list: the file
    // stays while the caller is told it went.
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user.id !== userId) {
      console.error('Photo delete skipped: not signed in as the owner')
      return false
    }
    const { error } = await supabase.storage.from(BUCKET).remove([...paths])
    if (error) {
      console.error('Photo delete error:', error.message)
      return false
    }
    paths.forEach(path => signedCache.delete(path))
    return true
  } catch (e) {
    console.error('Photo delete failed:', e)
    return false
  }
}
