import React, { createContext, useContext, useEffect, useState, useRef } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
  signInWithMagicLink: (email: string) => Promise<{ error: Error | null }>
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

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: error as Error | null }
  }

  // No OAuth here on purpose: the Supabase project enables the `email` provider only, so a
  // Google or GitHub button would fail with "Unsupported provider" every time it is
  // pressed. Re-add both together with the provider credentials, never before.

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    flushSave()
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    userRef.current = null
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signInWithMagicLink, signOut, syncStatus, hydrating }}>
      {children}
    </AuthContext.Provider>
  )
}
