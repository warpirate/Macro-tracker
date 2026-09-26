import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { forgetPhotoSrc, peekPhotoSrc, resolvePhotoSrc, subscribePhotoAccess } from '../lib/storage'

/*
  Progress photos live in a private bucket, so the value stored on a ProgressPhoto is not
  something an <img> can load by itself (see src/lib/storage.ts). Everything that shows a
  photo goes through this component, which resolves the stored value to a signed URL and
  owns the two states a plain <img> would get wrong: the moment before the URL exists
  (a shimmer, not an empty box) and a photo that cannot be shown (a quiet placeholder, not
  the browser's broken-image glyph).
*/

type PhotoPhase = 'loading' | 'ready' | 'failed'

/** Delays of the automatic retries after a photo fails; past the last, it waits for a reason. */
const AUTO_RETRY_DELAYS_MS = [2_000, 10_000]

interface PhotoSrcState {
  /** The stored value this state belongs to, so a stale result is never shown for a new photo. */
  stored: string | null | undefined
  src: string | null
  phase: PhotoPhase
}

const immediateState = (stored: string | null | undefined): PhotoSrcState => {
  const src = peekPhotoSrc(stored)
  return { stored, src, phase: src ? 'ready' : 'loading' }
}

/**
 * Resolves a stored ProgressPhoto.dataUrl to a displayable src. Inline and already-signed
 * photos are ready on the first render; the rest show `loading` until signing settles.
 *
 * `onImageError` belongs on the <img>: the first failure throws the cached signed URL away
 * and signs again (it may simply have expired while the tab slept); a second failure for
 * the same photo settles on `failed`.
 */
export function useProgressPhotoSrc(stored: string | null | undefined): {
  src: string | null
  phase: PhotoPhase
  onImageError: () => void
} {
  const [state, setState] = useState<PhotoSrcState>(() => immediateState(stored))
  const [attempt, setAttempt] = useState(0)
  /** The photo whose <img> has already been re-signed once; boxed so no initial value can match. */
  const retried = useRef<{ stored: string | null | undefined } | null>(null)
  /** Timed retries already spent on this photo, so a photo that is really gone stops asking. */
  const autoRetries = useRef<{ stored: string | null | undefined; count: number }>({ stored, count: 0 })

  useEffect(() => {
    const quick = immediateState(stored)
    if (quick.phase === 'ready') {
      setState(prev =>
        prev.stored === stored && prev.src === quick.src && prev.phase === 'ready' ? prev : quick,
      )
      return
    }

    let alive = true
    setState(prev => (prev.stored === stored && prev.phase === 'loading' ? prev : quick))
    void resolvePhotoSrc(stored).then(src => {
      if (alive) setState({ stored, src, phase: src ? 'ready' : 'failed' })
    })
    return () => {
      alive = false
    }
  }, [stored, attempt])

  const onImageError = useCallback(() => {
    forgetPhotoSrc(stored)
    if (retried.current !== null && retried.current.stored === stored) {
      setState({ stored, src: null, phase: 'failed' })
      return
    }
    retried.current = { stored }
    setState({ stored, src: null, phase: 'loading' })
    setAttempt(n => n + 1)
  }, [stored])

  // Between a change of photo and the effect catching up, never show the previous photo.
  const current = state.stored === stored ? state : immediateState(stored)
  const failed = current.phase === 'failed'

  /*
    `failed` is not final. Signing is batched, so a single network blip fails every tile at
    once, and without a way back they would all sit on the placeholder until the page
    remounted. A failed photo therefore tries again on its own (twice, on a short timer),
    whenever the connection comes back or the tab is shown again, and when a session is
    restored. It also picks up a URL another view has just cached for it, such as the
    full-size viewer opened from its tile, without a request of its own.

    Separately, whatever the phase, a 'revoked' change (sign-out, account switch) makes the
    photo resolve again: the URL it holds was signed for the previous account.
  */
  useEffect(() => {
    const retry = () => setAttempt(n => n + 1)
    const unsubscribe = subscribePhotoAccess(change => {
      if (change === 'revoked' || (failed && change === 'restored')) {
        retry()
      } else if (failed && change === 'signed') {
        const quick = immediateState(stored)
        if (quick.phase === 'ready') setState(quick)
      }
    })
    if (!failed) return unsubscribe

    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)

    if (autoRetries.current.stored !== stored) autoRetries.current = { stored, count: 0 }
    const delay = AUTO_RETRY_DELAYS_MS[autoRetries.current.count]
    const timer =
      delay === undefined
        ? undefined
        : window.setTimeout(() => {
            autoRetries.current.count++
            retry()
          }, delay)

    return () => {
      unsubscribe()
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearTimeout(timer)
    }
  }, [stored, failed])

  return { src: current.src, phase: current.phase, onImageError }
}

type Variant = 'tile' | 'viewer'

export interface ProgressPhotoImageProps {
  /** The value held in ProgressPhoto.dataUrl. */
  stored: string
  alt: string
  /** `tile` fills a gallery cell; `viewer` sits on the dark full-screen backdrop. */
  variant?: Variant
  className?: string
}

const SHIMMER: Record<Variant, string> = {
  tile: 'h-full w-full bg-stone-200 from-stone-200 via-stone-100 to-stone-200 dark:bg-stone-800 dark:from-stone-800 dark:via-stone-700 dark:to-stone-800',
  viewer: 'aspect-[3/4] w-[min(80vw,24rem)] rounded-2xl bg-stone-800 from-stone-800 via-stone-700 to-stone-800',
}

export const ProgressPhotoImage: React.FC<ProgressPhotoImageProps> = ({
  stored,
  alt,
  variant = 'tile',
  className,
}) => {
  const { src, phase, onImageError } = useProgressPhotoSrc(stored)

  // Spans throughout, not divs: the gallery tile renders this inside a <button>, which only
  // accepts phrasing content.
  if (phase === 'failed') {
    return variant === 'tile' ? (
      <span
        role="img"
        aria-label={`${alt}, could not be loaded`}
        className="flex h-full w-full flex-col items-center justify-center gap-1.5 pb-6 text-stone-500 dark:text-stone-400"
      >
        <ImageOff className="h-5 w-5" aria-hidden="true" />
        <span className="text-xs font-medium">Could not load</span>
      </span>
    ) : (
      <span role="alert" className="flex max-w-xs flex-col items-center gap-2 text-center text-stone-300">
        <ImageOff className="h-7 w-7" aria-hidden="true" />
        <span className="text-sm font-semibold text-stone-100">Could not load this photo</span>
        <span className="text-xs text-stone-400">
          Photos are private to your account. Check you are signed in and online, then open it again.
        </span>
      </span>
    )
  }

  if (phase === 'loading' || !src) {
    return (
      <span
        role="img"
        aria-label={`Loading ${alt}`}
        aria-busy="true"
        className={`block animate-shimmer bg-gradient-to-r bg-[length:200%_100%] ${SHIMMER[variant]}`}
      />
    )
  }

  return <img src={src} alt={alt} onError={onImageError} decoding="async" className={className} />
}
