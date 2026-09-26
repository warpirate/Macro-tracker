import React, { createContext, useContext, useEffect, useState, useRef } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useStore, type AppState } from '../store/useStore'
import { describeAuthError, normalizeEmail, type AuthResult } from '../utils/authErrors'

type SyncStatus = 'idle' | 'saving' | 'saved' | 'error'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
  syncStatus: SyncStatus
  /**
   * A background fetch of the user's saved data is in flight.
   *
   * Only true for a sign-in that happens while the app is already running; the initial
   * load is covered by `loading`. Anything that branches on saved state — the setup flow
   * above all — has to wait for this, or a returning user is asked to set up an account
   * they finished configuring months ago.
   */
  hydrating: boolean
  /**
   * The account's saved data could not be read, so this tab does not know what the server
   * holds and is uploading nothing. Edits stay on this device; the read is retried in the
   * background and saving resumes the moment one succeeds.
   *
   * While this is true `syncStatus` is held at 'error'. When this device has no profile to
   * stand in for the account's, App.tsx shows a retry screen instead of the setup flow:
   * otherwise a returning user on a new browser is walked through setup again, and the
   * answers are replaced by the real account the moment a retry gets through.
   */
  loadFailed: boolean
  /** Retry a failed read now, rather than waiting out the backoff. */
  retryLoad: () => void
  /**
   * Edits made on this device were replaced by the account's saved data, because the
   * account had been written from somewhere else since this device last synced (or this
   * device never had), and uploading them would have overwritten that newer data. They
   * were not uploaded; a copy is kept in localStorage under BACKUP_KEY.
   *
   * App.tsx shows a notice for this. It comes back on every launch until dismissed, so the
   * copy never sits in storage without the user knowing it is there.
   */
  discardedLocalEdits: boolean
  /** The replaced edits as JSON, for the user to download. Null when there was no room to keep them. */
  readDiscardedLocalEdits: () => string | null
  /** Hide the notice and delete the copy. */
  dismissDiscardedLocalEdits: () => void
}

const AuthContext = createContext<AuthContextValue>(null!)

export const useAuth = () => useContext(AuthContext)

// Must stay identical to the syncFields list inside hydrateStore in useStore.ts —
// a key that is saved but not hydrated silently never comes back on a new device.
const SYNC_FIELDS = [
  'profile', 'currentWeightKg', 'goals', 'diary', 'weightLog',
  'mealTemplates', 'customFoods', 'recentFoodIds', 'streak',
  'darkMode', 'bodyMeasurements', 'fastingSession', 'progressPhotos',
  'recommendation', 'recommendationSeenAt', 'onboardedAt',
  'workoutLog', 'customLifts', 'workoutTemplates', 'activeWorkoutId',
  'trainingPrograms', 'activeProgramId',
] as const

/*
  How long one read may take before it counts as failed and is aborted, by attempt.

  The first is short because the launch screen waits on it. Later ones grow: a fixed cap
  means a link that is merely slow (a weak signal, a row carrying months of diary) times out
  on every attempt and this tab never saves again. Each attempt is aborted when it gives
  up, so abandoned downloads do not compete with the retry that replaces them.
*/
const LOAD_TIMEOUTS_MS = [8000, 15000, 30000, 60000]
/*
  How long a save may take before it is aborted and reported as an error: a base, plus time
  for the body at a floor of 16 bytes/ms (about 128 kbit/s). Every save uploads the whole
  store, which a year of diary puts in the megabytes, and uploads are the slow direction. A
  fixed cap means a heavy user on a weak signal has every save aborted and nothing reaches
  the server all session. A save aborted after the server committed it overwrites nothing
  later: the next one is conditional on the version this tab last saw, so it conflicts and
  re-reads instead (see sendSave).
*/
const SAVE_TIMEOUT_MS = 15000
const SAVE_MIN_BYTES_PER_MS = 16
const SAVE_DEBOUNCE_MS = 1500
/** First retry after a failed read; each further failure doubles it, up to the cap. */
const RETRY_BASE_MS = 5000
const RETRY_MAX_MS = 60000
/** How long sign-out waits for a pending save before deciding whether to keep local data. */
const SIGN_OUT_FLUSH_MS = 4000

/*
  What a read of the account told us, which decides whether this tab may write to it.

  'ok'     — the row came back and the store has been reconciled with it (see reconcile).
  'empty'  — the account has no row yet (a brand-new account). There is nothing on the
             server to lose, so saving is safe.
  'failed' — error, timeout, network failure, or no signed-in session to read with. We know
             nothing about the server, and the store holds whatever was on this device —
             defaults on a new browser. Saving from here would upload that over the
             account's real diary, weights and everything else, which is exactly the bug
             this gate exists to stop.
*/
type LoadOutcome = 'ok' | 'empty' | 'failed'

type StoredRow = { data: Record<string, unknown>; updatedAt: string | null }

/*
  Whose data the persisted store holds, and how it relates to the server's copy.

  The store lives in localStorage ('macrofit-storage') and outlives sign-outs, reloads and
  outages, but by itself it records nothing about where it came from. This marker does:

  userId    — the account the store belongs to. A different account signing in on this
              browser gets a clean store, instead of being shown someone else's diary,
              weights and photos and then uploading them into its own row on its first edit.
  updatedAt — the row version (user_data.updated_at, bumped by a trigger on every write)
              the store was last reconciled with, by a read or by a save from this browser.
  dirty     — the store holds edits the server has not accepted. Persisted, so edits made
              offline survive the tab being closed and are still published, or at least
              backed up, on the next launch.

  Together they answer the question a successful read has to settle whenever there are
  unsaved local edits: may they be kept? Only if the row still carries the version this
  store descends from. Then nothing was written anywhere else in between, the local copy is
  the server's plus the edits, and publishing it loses nothing. Any other version means the
  phone (or another browser) wrote since, and uploading this whole blob would silently
  erase that — so the server wins and the edits go to BACKUP_KEY.

  Two tabs of the app in one browser share this marker and the persisted store but not
  their in-memory state, so the marker on disk can describe another tab's store: a sign-out
  and a different sign-in there rewrite it while this tab still holds the old account in
  memory. So the marker is trusted once per page, as it stood when the store was loaded
  (markerAtLoad), and after that a tab goes by what its own memory holds (see claimStore).
  Two tabs can still overwrite each other's persisted store; they cannot overwrite each
  other's saves, which are conditional on the row version (see sendSave).
*/
const SYNC_MARKER_KEY = 'macrofit-sync'
const BACKUP_KEY = 'macrofit-unsynced-backup'

type SyncMarker = { userId: string; updatedAt: string | null; dirty: boolean }

const readMarker = (): SyncMarker | null => {
  try {
    const raw = localStorage.getItem(SYNC_MARKER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SyncMarker> | null
    if (!parsed || typeof parsed.userId !== 'string') return null
    return {
      userId: parsed.userId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      dirty: parsed.dirty === true,
    }
  } catch {
    return null
  }
}

const writeMarker = (marker: SyncMarker | null) => {
  try {
    if (marker) localStorage.setItem(SYNC_MARKER_KEY, JSON.stringify(marker))
    else localStorage.removeItem(SYNC_MARKER_KEY)
  } catch {
    // Storage unavailable: the store is not being persisted either, so there is nothing
    // on disk for the marker to describe.
  }
}

/*
  The marker as it stood when the persisted store was loaded. useStore is imported above, so
  zustand has already read the store from localStorage (synchronously) by the time this line
  runs: this copy describes the store in memory. A marker read later may have been rewritten
  by another tab since.
*/
const markerAtLoad = readMarker()

const clearBackup = () => {
  try {
    localStorage.removeItem(BACKUP_KEY)
  } catch {
    // Nothing was stored.
  }
}

const readBackup = (): string | null => {
  try {
    return localStorage.getItem(BACKUP_KEY)
  } catch {
    return null
  }
}

const backupOwner = (): string | null => {
  const raw = readBackup()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown } | null
    return typeof parsed?.userId === 'string' ? parsed.userId : null
  } catch {
    return null
  }
}

const collectSyncFields = (): Record<string, unknown> => {
  const state = useStore.getState() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of SYNC_FIELDS) out[key] = state[key]
  return out
}

/** Equality of two JSON values, ignoring object key order (jsonb stores keys reordered). */
const sameJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = Object.keys(ra)
  if (keys.length !== Object.keys(rb).length) return false
  return keys.every(k => Object.prototype.hasOwnProperty.call(rb, k) && sameJson(ra[k], rb[k]))
}

/**
 * Does the row already hold exactly what the store holds? True after a save that landed
 * but whose answer never arrived (the tab closed mid-flush, or it timed out), which leaves
 * the store dirty against an older version with nothing actually lost.
 */
const rowMatchesStore = (rowData: Record<string, unknown>) => {
  // Through JSON first, as the upload went: undefined fields drop out, dates become strings.
  const local = JSON.parse(JSON.stringify(collectSyncFields())) as Record<string, unknown>
  return SYNC_FIELDS.every(key => sameJson(local[key], rowData[key]))
}

/**
 * Put every synced field back to the store's shipped defaults — except the theme, which is
 * a display preference rather than anyone's data, and would otherwise flash the login
 * screen to light mode on every sign-out.
 */
const resetSyncedFields = () => {
  const initial = useStore.getInitialState() as unknown as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const key of SYNC_FIELDS) if (key !== 'darkMode') next[key] = initial[key]
  useStore.setState(next as Partial<AppState>)
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Read the account's row. Resolves to the row, `null` for an account with no row, or
 * 'failed' when the answer cannot be trusted.
 *
 * `.maybeSingle()` rather than `.single()` is deliberate: `.single()` raises PGRST116 for
 * an account with no row, which at the call site looks exactly like a network error.
 * `.maybeSingle()` returns `data: null` instead, so "new account" and "could not reach the
 * server" stay separate — and only the first is safe to save over.
 *
 * The request is pinned to the session's own token for the same reason. When a token
 * refresh fails with a retryable error, auth-js keeps the session but getSession() yields
 * none, and supabase-js then quietly sends the request with the anon key. Row-level
 * security filters an anonymous read down to zero rows with no error — indistinguishable
 * from a brand-new account — which would open the save gate and let the next upsert, sent
 * once auth recovers, overwrite the real row. With no session for this user there is no
 * read; with a pinned token an expired one fails loudly (401) instead of turning anonymous.
 */
const readRow = async (userId: string, timeoutMs: number): Promise<StoredRow | null | 'failed'> => {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => {
        controller.abort()
        resolve('timeout')
      }, timeoutMs)
    })
    const read = (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || session.user.id !== userId) return 'unavailable' as const
      return await supabase
        .from('user_data')
        .select('data, updated_at')
        .eq('user_id', userId)
        .setHeader('Authorization', `Bearer ${session.access_token}`)
        .abortSignal(controller.signal)
        .maybeSingle()
    })().catch(() => 'unavailable' as const)

    const result = await Promise.race([read, timeout])
    if (result === 'timeout' || result === 'unavailable' || result.error) return 'failed'

    const row = result.data as { data?: unknown; updated_at?: unknown } | null
    if (!row) return null
    return {
      // A row whose data is unusable is still a row: reported as absent, the next save
      // would try to insert it, conflict with the row that is there, and re-read forever.
      data: row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : {},
      // Never null in practice: DEFAULT NOW() on insert and a trigger on every update.
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    }
  } catch {
    return 'failed'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/*
  auth-js keeps the stored session when the server half of sign-out fails (offline, a 5xx),
  returning the error instead. The app would still show the login screen, but the valid
  session stays in localStorage, and the next reload — or the SIGNED_IN auth-js emits on
  every tab return — signs the previous person straight back in for whoever uses this
  browser next. So the local half is finished here. The refresh token stays valid on the
  server until it expires, but nothing on this device holds it any more.

  storageKey is protected in the typings but is the key auth-js reads the session from on
  every call; nothing is removed if it is ever absent.
*/
const endStoredSession = () => {
  const key = (supabase.auth as unknown as { storageKey?: unknown }).storageKey
  if (typeof key !== 'string' || !key) return
  try {
    for (const suffix of ['', '-user', '-code-verifier']) localStorage.removeItem(key + suffix)
  } catch {
    // Storage unavailable: the session was never persisted.
  }
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null }

const clearTimer = (ref: TimerRef) => {
  if (ref.current) {
    clearTimeout(ref.current)
    ref.current = null
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [hydrating, setHydrating] = useState(false)
  const [loadFailed, setLoadFailedState] = useState(false)
  const [discardedLocalEdits, setDiscardedLocalEdits] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The pending "…and back to idle" after a save, tracked so it cannot clobber a newer status. */
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryAttemptRef = useRef(0)
  const userRef = useRef<User | null>(null)
  /** The signed-in account. Changes only when a different person signs in or out. */
  const activeUserIdRef = useRef<string | null>(null)
  /** The account whose data the in-memory store holds; null when unknown or wiped. */
  const storeOwnerRef = useRef<string | null>(null)
  /** The store in memory is still the one loaded from disk, which markerAtLoad describes. */
  const storeFromDiskRef = useRef(true)
  /** Suppresses the store echo of our own hydrate/reset so it is not taken for a user edit. */
  const isHydratingRef = useRef(false)
  /**
   * Saving is opt-in, not opt-out. It stays false until a read of the CURRENT account has
   * come back 'ok' or 'empty', so no path — debounced save, tab-hide flush, sign-out —
   * can upload a store that was never reconciled with the server.
   */
  const canSaveRef = useRef(false)
  const loadFailedRef = useRef(false)
  /** The store holds edits the server has not accepted. Mirrored into the sync marker. */
  const dirtyRef = useRef(false)
  /** The row version this store descends from; see SYNC_MARKER_KEY. */
  const syncedVersionRef = useRef<string | null>(null)
  /** Bumped by every user edit (not by hydration), so a save can tell whether one overtook it. */
  const changeSeqRef = useRef(0)
  /**
   * Bumped whenever the signed-in account changes. Every read carries the value it started
   * under and abandons itself if that has moved on, so a slow read for the account that just
   * signed out can never land in, or unlock saving for, the one that replaced it.
   */
  const generationRef = useRef(0)
  /** One read at a time per account: focus, visibility, SIGNED_IN and the timer all share it. */
  const loadInFlightRef = useRef<{
    generation: number
    promise: Promise<LoadOutcome | 'stale'>
  } | null>(null)
  /**
   * Reads of the current account whose answer has not been applied yet. Saves wait while
   * this is above zero. Zeroed when the account changes: a read abandoned by a sign-out can
   * hang for up to a minute, and counting it would silently hold the next account's saves.
   */
  const readsInFlightRef = useRef(0)
  /** The tail of the save queue. Saves run one after another, never overlapped. */
  const saveInFlightRef = useRef<Promise<void> | null>(null)

  const setLoadFailed = (value: boolean) => {
    loadFailedRef.current = value
    setLoadFailedState(value)
  }

  /** Run a store write of our own without it counting as a user edit. */
  const withoutEcho = (write: () => void) => {
    // zustand notifies subscribers synchronously, so the flag only has to cover the call
    // itself. Holding it longer (this used to wait 300 ms) swallows real edits made in
    // that window, which then sit unsaved until something else happens to trigger a save.
    isHydratingRef.current = true
    try {
      write()
    } finally {
      isHydratingRef.current = false
    }
  }

  const persistMarker = () => {
    const owner = storeOwnerRef.current
    if (!owner) return
    writeMarker({ userId: owner, updatedAt: syncedVersionRef.current, dirty: dirtyRef.current })
  }

  /**
   * Decide what the store holds for the account that just signed in, before anything can
   * read it, render it or upload it.
   */
  const claimStore = (userId: string) => {
    // Same person back in this tab (session expiry, or a sign-out that kept unsaved edits):
    // the in-memory bookkeeping still describes this store exactly.
    if (storeOwnerRef.current === userId) return

    /*
      Only the first claim of a page may take the marker's word, and only the marker as it
      was when the store was loaded. After that the store in memory is this tab's own doing
      (another account's data, or defaults after a wipe) whatever the marker on disk now
      says: another tab signing out and signing a different account in rewrites the marker
      for that account without touching this tab's memory. Believing it here showed the
      previous account's diary as the new one's and uploaded it into the new one's row.
    */
    const marker = storeFromDiskRef.current ? markerAtLoad : null
    storeFromDiskRef.current = false
    if (marker && marker.userId === userId) {
      dirtyRef.current = marker.dirty
      syncedVersionRef.current = marker.updatedAt
    } else {
      /*
        Anything else is not provably this account's: another account's data, a store from
        before the marker existed (the old sign-out never wiped, so it may be anyone's), or
        defaults. Reset, so none of it is shown to this account or uploaded into its row;
        the read that follows fills the store from the account itself. Such a store was
        never going to be kept anyway — the server's row, or its absence, always replaced it.
      */
      withoutEcho(resetSyncedFields)
      dirtyRef.current = false
      syncedVersionRef.current = null
    }
    // A backup is only ever of its owner's store; anyone else's goes.
    if (backupOwner() !== userId) clearBackup()
    storeOwnerRef.current = userId
    persistMarker()
  }

  /** Remove the signed-out account's data from this browser. */
  const wipeLocalData = () => {
    withoutEcho(resetSyncedFields)
    writeMarker(null)
    clearBackup()
    storeOwnerRef.current = null
    storeFromDiskRef.current = false
    dirtyRef.current = false
    syncedVersionRef.current = null
  }

  /**
   * Point the provider at whoever is signed in now, and close the save gate if that is a
   * different account (or nobody). Returns true when it was.
   */
  const adoptUser = (next: User | null): boolean => {
    userRef.current = next
    const nextId = next?.id ?? null
    if (nextId === activeUserIdRef.current) return false

    activeUserIdRef.current = nextId
    generationRef.current++
    canSaveRef.current = false
    retryAttemptRef.current = 0
    // A pending save belongs to the previous account and must not fire for the next one.
    // Its edits are not lost: dirty is persisted, and they are published (or backed up) the
    // next time that account reads its row on this browser.
    clearTimer(saveTimerRef)
    clearTimer(retryTimerRef)
    clearTimer(idleTimerRef)
    loadInFlightRef.current = null
    readsInFlightRef.current = 0
    // Nor is the previous account's save queue this one's to wait on: the first read for
    // the new account would sit behind an upload to the old row. Its result is ignored.
    saveInFlightRef.current = null
    setLoadFailed(false)
    setHydrating(false)
    setSyncStatus('idle')
    if (next) claimStore(next.id)
    // A copy of replaced edits keeps its notice across launches until the user dismisses it.
    setDiscardedLocalEdits(next !== null && backupOwner() === next.id)
    return true
  }

  const sendSave = async (): Promise<void> => {
    const current = userRef.current
    if (!current || isHydratingRef.current || !canSaveRef.current) return
    // Held while a read is in flight: until it lands we do not know whether this store is
    // still the newest copy. settleLoad publishes afterwards if it is.
    if (readsInFlightRef.current > 0) return
    // Nothing to send. Without this every tab hide re-uploads the whole store.
    if (!dirtyRef.current) return

    const generation = generationRef.current
    const seq = changeSeqRef.current
    // Read at send time, not captured when the edit happened: if a read reconciled the
    // store in between, a snapshot from before it is stale and must not be uploaded.
    const storeData = collectSyncFields()
    const version = syncedVersionRef.current
    // A save that settles after the account changed must not paint its status over the
    // new account's — least of all over the 'error' that says saving is blocked.
    const report = (status: SyncStatus) => {
      if (generation === generationRef.current) setSyncStatus(status)
    }
    report('saving')

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      /*
        Conditional on the row version this store descends from, never a blind overwrite.
        Every save uploads the whole store, so a tab that missed a write made elsewhere (the
        phone logged lunch while the laptop tab sat in the background) would otherwise erase
        it with its next edit. Re-reading at the right moments cannot close that on its
        own: a tab left visible all day gets no such moment, and a re-read can fail. So an
        update matches only the version this tab last read or saved, and a store with no
        version (an account with no row yet) may only insert.
      */
      const request =
        version === null
          ? supabase
              .from('user_data')
              .insert({ user_id: current.id, data: storeData })
              .select('updated_at')
              .abortSignal(controller.signal)
          : supabase
              .from('user_data')
              .update({ data: storeData })
              .eq('user_id', current.id)
              .eq('updated_at', version)
              .select('updated_at')
              .abortSignal(controller.signal)
      // A deadline of its own, sized to the upload (see SAVE_TIMEOUT_MS): reads and
      // sign-out wait on the save queue, so a save that never settles would stall them.
      const deadline = SAVE_TIMEOUT_MS + JSON.stringify(storeData).length / SAVE_MIN_BYTES_PER_MS
      const timeout = new Promise<'timeout'>(resolve => {
        timer = setTimeout(() => {
          controller.abort()
          resolve('timeout')
        }, deadline)
      })
      const result = await Promise.race([request, timeout])
      if (generation !== generationRef.current) return
      if (result === 'timeout') {
        report('error')
        return
      }

      const rows = result.data as Array<{ updated_at?: unknown }> | null
      // An update that matched no row, or an insert that met one (unique violation).
      const conflict = result.error ? result.error.code === '23505' : !rows?.length
      if (conflict) {
        /*
          The row was written elsewhere since this tab last saw it, and nothing was
          overwritten. Saving stays shut until a read has reconciled the store with what is
          there now: reconcile keeps these edits if the row turns out to hold them already
          (a save whose answer was lost), and otherwise backs them up and says so.
        */
        canSaveRef.current = false
        clearTimer(idleTimerRef)
        report('idle')
        void requestLoad()
        return
      }
      if (result.error) {
        report('error')
        return
      }

      // The row now holds this snapshot, so the store descends from the version it returned.
      const updatedAt = rows?.[0]?.updated_at
      syncedVersionRef.current = typeof updatedAt === 'string' ? updatedAt : null
      // Only clean if nothing changed while the upload was in flight; otherwise that later
      // edit would be marked as saved and never sent by anyone.
      if (changeSeqRef.current === seq) dirtyRef.current = false
      persistMarker()

      report('saved')
      clearTimer(idleTimerRef)
      idleTimerRef.current = setTimeout(() => setSyncStatus('idle'), 2000)
    } catch {
      report('error')
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * Send the store now if it has unsaved edits (tab hide, sign-out, the debounce itself).
   * Queued behind any save already in flight: two in flight at once would carry the same
   * row version, so whichever landed second would always conflict with the first.
   * A no-op until a read of this account has opened the save gate.
   */
  const flushSave = (): Promise<void> => {
    clearTimer(saveTimerRef)
    const previous = saveInFlightRef.current
    const pending = previous ? previous.then(sendSave) : sendSave()
    saveInFlightRef.current = pending
    void pending.finally(() => {
      if (saveInFlightRef.current === pending) saveInFlightRef.current = null
    })
    return pending
  }

  const scheduleSave = () => {
    clearTimer(saveTimerRef)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Apply a row (or its absence) to the store. Runs immediately after the read, with the
   * generation already checked, so nothing can slip in between the decision and the write.
   */
  const reconcile = (userId: string, row: StoredRow | null) => {
    const dirty = dirtyRef.current
    const descendsFromRow =
      row !== null && row.updatedAt !== null && row.updatedAt === syncedVersionRef.current

    if (row === null) {
      // No row (a new account): nothing to replace, and claimStore has made sure the store
      // is this account's own. Any edits are published by settleLoad.
    } else if (dirty && descendsFromRow) {
      /*
        Unsaved edits on top of exactly the version the server still holds: nothing was
        written elsewhere in between, so the local copy is the server's plus the edits.
        Keep it; settleLoad publishes it. This is the returning user who launched offline,
        or logged a workout while the read was failing, or tapped something while a
        tab-return refresh was in flight — their work survives.
      */
    } else if (dirty && rowMatchesStore(row.data)) {
      /*
        A newer version that holds exactly these edits: a save that landed without its
        answer arriving (the tab closed mid-flush, or the save timed out after the server
        committed). Nothing to publish and nothing lost, so no notice either — without this
        every such tab close was reported as lost work on the next launch.
      */
      dirtyRef.current = false
    } else {
      /*
        The server wins. Either there are no unsaved edits (the normal refresh), or the
        account was written from somewhere else since this store last synced — the phone,
        another browser — or this browser never synced it at all (a new browser, where the
        edits were made on top of defaults). Uploading the local blob would overwrite that
        newer data wholesale: diary, weights, everything. A per-entry merge would avoid
        both losses, but entries carry no timestamps and hydrateStore replaces fields
        wholesale.

        So the edits are not uploaded, but they are not discarded silently either: they
        are copied to BACKUP_KEY and `discardedLocalEdits` tells the UI.

        The copy is serialised before the hydrate replaces the store, but stored after it
        (with any older copy removed first): when storage cannot hold both, the account's
        data gets the room and the copy is what goes without.
      */
      const backup = dirty
        ? JSON.stringify({ userId, savedAt: Date.now(), data: collectSyncFields() })
        : null
      if (backup !== null) clearBackup()
      try {
        withoutEcho(() => useStore.getState().hydrateStore(row.data as Partial<AppState>))
      } catch {
        /*
          zustand's persist middleware writes to localStorage after updating the store, and
          lets a quota error escape. The store in memory already holds the row. Letting the
          error out of here would skip settleLoad and leave saving shut for the session,
          with no retry and no error shown.
        */
      }
      if (backup !== null) {
        try {
          localStorage.setItem(BACKUP_KEY, backup)
        } catch {
          // No room. The notice still says the edits were not kept; there is no copy to offer.
        }
        setDiscardedLocalEdits(true)
      }
      dirtyRef.current = false
    }

    storeOwnerRef.current = userId
    syncedVersionRef.current = row?.updatedAt ?? null
    persistMarker()
  }

  /** Read the account and reconcile the store with it. */
  const loadUserData = async (
    userId: string,
    generation: number,
    timeoutMs: number
  ): Promise<LoadOutcome> => {
    readsInFlightRef.current++
    try {
      /*
        A read never overlaps a save. New saves are held from here on (readsInFlight), and
        one already on the wire is waited out, bounded by its own deadline. Otherwise the
        select can run on the server before the upload commits yet answer after it, and
        reconcile would hydrate the pre-save row over the edits just saved.
      */
      const saving = saveInFlightRef.current
      if (saving) await saving.catch(() => undefined)
      if (generation !== generationRef.current) return 'failed'
      const row = await readRow(userId, timeoutMs)
      if (row === 'failed') return 'failed'
      // Checked here, immediately before the write, not by the caller afterwards: the read
      // can take a minute, and hydrateStore is a wholesale overwrite that the persist
      // middleware then writes to localStorage. A read for the account that just signed out
      // must not repopulate the store the next account is about to use.
      if (generation !== generationRef.current) return 'failed'
      reconcile(userId, row)
      return row ? 'ok' : 'empty'
    } finally {
      // adoptUser zeroes the count for the next account; a read it abandoned is not in it.
      if (generation === generationRef.current) readsInFlightRef.current--
    }
  }

  const scheduleRetry = () => {
    clearTimer(retryTimerRef)
    const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttemptRef.current, RETRY_MAX_MS)
    // Also selects the next read's timeout (LOAD_TIMEOUTS_MS), so each retry waits longer.
    retryAttemptRef.current++
    const generation = generationRef.current
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      if (generation !== generationRef.current || canSaveRef.current) return
      // A hidden tab waits: re-downloading the whole row every minute for a tab nobody is
      // looking at helps no one, and the visibility and focus handlers retry the moment it
      // is shown again.
      if (document.visibilityState === 'hidden') return
      void requestLoad()
    }, delay)
  }

  /** Apply a read's outcome to the save gate. Only called for a read that is still current. */
  const settleLoad = (outcome: LoadOutcome) => {
    if (outcome === 'failed') {
      /*
        A refresh that fails for an account this tab has already read leaves saving on: the
        store descends from the server's copy, not from defaults, so this is not the
        defaults-over-account case, and blocking would strand the user's edits every time
        the network blinks. If the row moved on meanwhile, the next save conflicts rather
        than overwriting it.
      */
      if (!canSaveRef.current) {
        setLoadFailed(true)
        clearTimer(idleTimerRef)
        setSyncStatus('error')
        scheduleRetry()
        return
      }
    } else {
      canSaveRef.current = true
      retryAttemptRef.current = 0
      clearTimer(retryTimerRef)
      if (loadFailedRef.current) {
        setLoadFailed(false)
        setSyncStatus('idle')
      }
    }
    // Saves were held while the read was in flight, and edits reconcile kept (or an 'empty'
    // account's first edits) have not been published yet.
    if (canSaveRef.current && dirtyRef.current) scheduleSave()
  }

  /**
   * Read the current account, sharing a read already in flight for it.
   *
   * Unsaved edits are not uploaded first. reconcile keeps them when the row is still the
   * version they were made on (settleLoad then publishes them) and backs them up when it
   * is not, so an upload first would only add a whole-store upload that, in the second
   * case, conflicts anyway. What happens to an edit is decided against the row version,
   * not by who was faster. loadUserData waits out an upload already on the wire.
   */
  const requestLoad = (): Promise<LoadOutcome | 'stale'> => {
    const current = userRef.current
    if (!current) return Promise.resolve('stale')
    const generation = generationRef.current
    const inFlight = loadInFlightRef.current
    if (inFlight && inFlight.generation === generation) return inFlight.promise
    clearTimer(retryTimerRef)
    const timeoutMs =
      LOAD_TIMEOUTS_MS[Math.min(retryAttemptRef.current, LOAD_TIMEOUTS_MS.length - 1)]

    const promise = (async (): Promise<LoadOutcome | 'stale'> => {
      const outcome = await loadUserData(current.id, generation, timeoutMs)
      if (generation !== generationRef.current) return 'stale'
      settleLoad(outcome)
      return outcome
    })()

    loadInFlightRef.current = { generation, promise }
    void promise.finally(() => {
      if (loadInFlightRef.current?.promise === promise) loadInFlightRef.current = null
    })
    return promise
  }

  /** Retry a failed read now, rather than waiting out the backoff. */
  const retryIfBlocked = () => {
    if (userRef.current && loadFailedRef.current && !canSaveRef.current) void requestLoad()
  }

  // Bootstrap session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      adoptUser(session?.user ?? null)
      if (session?.user) {
        // Joins the read the auth listener may already have started for this account.
        requestLoad().finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    // Deliberately not async: awaiting a Supabase call inside this callback can deadlock the
    // auth lock. requestLoad starts its work and returns.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      const next = session?.user ?? null
      const changed = adoptUser(next)
      if (!next) {
        /*
          Signed out, here or in another tab: auth-js broadcasts a sign-out to every tab of
          the browser. A tab that only heard about it kept the account's diary in memory, and
          wrote it back to localStorage with its next store write, after the tab that signed
          out had wiped it. Unsaved edits are kept, exactly as signOut keeps them.
        */
        if (changed && !dirtyRef.current) wipeLocalData()
        return
      }

      if (changed) {
        // A different account is now signed in, so the store holds defaults or a store
        // claimStore has just decided about. `hydrating` holds the router until we know
        // what this account looks like.
        const generation = generationRef.current
        setHydrating(true)
        requestLoad().finally(() => {
          if (generation === generationRef.current) setHydrating(false)
        })
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        /*
          The same account again. auth-js emits SIGNED_IN when the tab becomes visible with
          its token still good, and TOKEN_REFRESHED instead when the token had to be
          refreshed first (any absence longer than its remaining life, up to an hour) and on
          the periodic refresh of a tab that stays visible. Either is the moment to pick up
          what the phone wrote meanwhile. Missing it costs a stale screen, not data: saves
          are version-checked (see sendSave). It runs in the background, without
          `hydrating`, which would swap the whole app for a spinner (and unmount whatever
          was open) on every tab switch.
        */
        void requestLoad()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Flush save when tab is hidden (user switches app, closes tab, etc.), and retry a failed
  // read when the user comes back or the connection does.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flushSave()
      else retryIfBlocked()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', retryIfBlocked)
    window.addEventListener('online', retryIfBlocked)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', retryIfBlocked)
      window.removeEventListener('online', retryIfBlocked)
      clearTimer(retryTimerRef)
      clearTimer(idleTimerRef)
    }
  }, [])

  // Record every edit, and auto-sync it to Supabase (debounced) once the save gate is open.
  useEffect(() => {
    const unsubscribe = useStore.subscribe(() => {
      if (!userRef.current || isHydratingRef.current) return
      changeSeqRef.current++
      dirtyRef.current = true
      // Persisted with the edit, so it survives the tab closing before any save lands.
      persistMarker()
      // While the gate is closed the edit stays on this device; reconcile decides its fate.
      if (canSaveRef.current) scheduleSave()
    })

    return () => {
      unsubscribe()
      clearTimer(saveTimerRef)
    }
  }, [])

  const signIn = async (rawEmail: string, password: string): Promise<AuthResult> => {
    const email = normalizeEmail(rawEmail)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) return { error: null, notice: null }
    return { error: describeAuthError(error, email), notice: null }
  }

  const signUp = async (rawEmail: string, password: string): Promise<AuthResult> => {
    const email = normalizeEmail(rawEmail)
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: describeAuthError(error, email), notice: null }

    // GoTrue refuses to leak whether an address is registered: signing up an existing one
    // succeeds, returning a fabricated user whose `identities` array is empty.
    if (data.user && data.user.identities?.length === 0) {
      return { error: `${email} already has an account. Switch to Sign In.`, notice: null }
    }

    if (data.session) return { error: null, notice: null }

    return {
      error: null,
      notice: `Account created. Open the confirmation link we emailed to ${email}, then sign in.`,
    }
  }

  // Neither OAuth nor magic link here, and both for the same reason: the project cannot
  // serve them. Only the `email` provider is enabled, so a Google or GitHub button fails
  // with "Unsupported provider"; and the built-in mailer times out, so a magic link is a
  // button whose entire job is to send an email that never arrives. Password sign-in needs
  // no email at all once "Confirm email" is off, which is why it is the only one left.
  // Restore magic link the moment custom SMTP is configured — the code is one call.

  const signOut = async () => {
    // Publish anything still pending while this account's token is valid. Gated like every
    // other save, and bounded: an offline sign-out must not hang on a save that cannot land.
    if (dirtyRef.current || saveInFlightRef.current) {
      await Promise.race([flushSave(), wait(SIGN_OUT_FLUSH_MS)])
    }

    let failed = false
    try {
      failed = (await supabase.auth.signOut()).error !== null
    } catch {
      failed = true
    }
    if (failed) endStoredSession()

    /*
      The store outlives the session in localStorage, so a sign-out that leaves it behind
      leaves this person's diary, weights and photos on the device for whoever signs in
      next. It is wiped — unless it still holds edits the server never accepted, which
      would make the wipe destroy the only copy. Those are kept for this account's next
      sign-in (which publishes them), and claimStore wipes them if a different account
      signs in instead.
    */
    const keepLocal = dirtyRef.current
    setUser(null)
    setSession(null)
    adoptUser(null)
    if (!keepLocal) wipeLocalData()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        syncStatus,
        hydrating,
        loadFailed,
        retryLoad: retryIfBlocked,
        discardedLocalEdits,
        readDiscardedLocalEdits: () =>
          userRef.current && backupOwner() === userRef.current.id ? readBackup() : null,
        dismissDiscardedLocalEdits: () => {
          // Deleted with the notice: a second copy of the whole store, photos included,
          // otherwise sits in the storage quota the store itself needs, for nothing.
          clearBackup()
          setDiscardedLocalEdits(false)
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
