import React, { createContext, useContext, useEffect, useState, useRef } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { describeAuthError, normalizeEmail, type AuthResult } from '../utils/authErrors'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
  syncStatus: 'idle' | 'saving' | 'saved' | 'error'
  /**
   * A background fetch of the user's saved data is in flight.
   *
   * Only true for a sign-in that happens while the app is already running; the initial
   * load is covered by `loading`. Anything that branches on saved state — the setup flow
   * above all — has to wait for this, or a returning user is asked to set up an account
   * they finished configuring months ago.
   */
  hydrating: boolean
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
] as const

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [hydrating, setHydrating] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userRef = useRef<User | null>(null)
  const isHydratingRef = useRef(false)

  const loadUserData = async (userId: string) => {
    try {
      // Race the query against an 8-second timeout so loading never hangs forever
      const result = await Promise.race([
        supabase.from('user_data').select('data').eq('user_id', userId).single(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 8000)),
      ])

      if (!result || !('data' in result) || result.error || !result.data?.data) return

      isHydratingRef.current = true
      useStore.getState().hydrateStore(result.data.data)
      // Give React time to flush the hydrated state before re-enabling saves
      await new Promise(r => setTimeout(r, 300))
      isHydratingRef.current = false
    } catch {
      // No existing data for user — start fresh
    }
  }

  const saveUserData = async (userId: string, storeData: Record<string, unknown>) => {
    setSyncStatus('saving')
    try {
      const { error } = await supabase
        .from('user_data')
        .upsert({ user_id: userId, data: storeData }, { onConflict: 'user_id' })

      setSyncStatus(error ? 'error' : 'saved')
      if (!error) setTimeout(() => setSyncStatus('idle'), 2000)
    } catch {
      setSyncStatus('error')
    }
  }

  /** Flush any pending debounced save immediately (used on tab close / sign-out). */
  const flushSave = () => {
    if (!userRef.current || isHydratingRef.current) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const state = useStore.getState() as unknown as Record<string, unknown>
    const storeData: Record<string, unknown> = {}
    for (const key of SYNC_FIELDS) storeData[key] = state[key]
    saveUserData(userRef.current.id, storeData)
  }

  // Bootstrap session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      userRef.current = session?.user ?? null
      if (session?.user) {
        loadUserData(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      userRef.current = session?.user ?? null

      // SIGNED_IN fires on explicit sign-in AND on token refresh.
      // Don't touch loading here — getSession() already handles the initial load.
      // For fresh sign-ins (loading is already false), hydrate in the background.
      if (event === 'SIGNED_IN' && session?.user) {
        setHydrating(true)
        loadUserData(session.user.id).finally(() => setHydrating(false))
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Flush save when tab is hidden (user switches app, closes tab, etc.)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushSave()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Auto-sync store changes to Supabase (debounced 1.5s)
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state) => {
      if (!userRef.current || isHydratingRef.current) return

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        const storeData: Record<string, unknown> = {}
        for (const key of SYNC_FIELDS) {
          storeData[key] = (state as unknown as Record<string, unknown>)[key]
        }
        saveUserData(userRef.current!.id, storeData)
      }, 1500)
    })

    return () => {
      unsubscribe()
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
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
    flushSave()
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    userRef.current = null
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut, syncStatus, hydrating }}>
      {children}
    </AuthContext.Provider>
  )
}
