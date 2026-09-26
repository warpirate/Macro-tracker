import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useStore } from './store/useStore'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { BottomNav } from './components/Layout/BottomNav'
import { ChatInterface } from './components/Chat/ChatInterface'
import { Dashboard } from './pages/Dashboard'
import { Diary } from './pages/Diary'
import { Workout } from './pages/Workout'
import { Progress } from './pages/Progress'
import { Goals } from './pages/Goals'
import { Profile } from './pages/Profile'
import { LoginPage } from './pages/LoginPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { InstallPrompt } from './components/InstallPrompt'

/*
  Transient sync toast. It floats just under the sticky Navbar rather than on top
  of it, is pointer-events-none so it can never swallow a tap meant for the header
  controls, and offsets itself past env(safe-area-inset-top) on notched devices.
*/
const SyncIndicator: React.FC = () => {
  const { syncStatus, loadFailed } = useAuth()
  if (syncStatus === 'idle') return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ top: 'calc(3.75rem + env(safe-area-inset-top))' }}
      className="pointer-events-none fixed right-3 z-50 flex items-center gap-1.5 rounded-full border border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/90 px-3 py-1 text-xs font-medium text-stone-600 dark:text-stone-400 shadow-sm dark:shadow-none backdrop-blur-sm animate-fade-in"
    >
      {syncStatus === 'saving' && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400 dark:text-stone-500" aria-hidden="true" />
          Saving…
        </>
      )}
      {syncStatus === 'saved' && (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-jade-600 dark:text-jade-400" aria-hidden="true" />
          Saved
        </>
      )}
      {syncStatus === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
          {/* A failed read also holds every save, and is retried on its own. */}
          {loadFailed ? "Can't sync, retrying" : 'Sync error'}
        </>
      )}
    </div>
  )
}

/*
  Shown in place of the setup flow when the account could not be read and this device has
  no profile to stand in for it: a returning user on a new browser, or one whose store was
  cleared because it could not be shown as theirs. Setup here would ask a months-old
  account "what should we call you?", and whatever was entered would be replaced by the
  real account the moment a retry got through.
*/
const LoadFailedScreen: React.FC = () => {
  const { retryLoad, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center px-4">
      <div className="flex w-full max-w-xs flex-col items-center gap-3 text-center">
        <AlertCircle className="w-7 h-7 text-red-700 dark:text-red-400" aria-hidden="true" />
        <div role="alert">
          <p className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Couldn't load your data
          </p>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Check your connection. We'll keep trying in the background.
          </p>
        </div>
        <div className="mt-2 flex w-full items-center gap-2">
          <button onClick={() => void signOut()} className="btn-ghost flex-1">
            Sign out
          </button>
          <button onClick={retryLoad} className="btn-primary flex-1">
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}

const saveTextFile = (text: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoked later, not at once: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/*
  Edits made on this device were replaced by the account's saved data rather than uploaded
  over it (see discardedLocalEdits in AuthContext). Says so, and hands over the copy that
  was kept, so the loss is never silent. It sits above the bottom nav like InstallPrompt.
*/
const DiscardedEditsNotice: React.FC = () => {
  const { readDiscardedLocalEdits, dismissDiscardedLocalEdits } = useAuth()
  // Checked once: the copy only changes when the notice is raised again.
  const [hasCopy] = useState(() => readDiscardedLocalEdits() !== null)

  const download = () => {
    const copy = readDiscardedLocalEdits()
    if (copy) saveTextFile(copy, `macrofit-unsynced-${new Date().toISOString().slice(0, 10)}.json`)
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 px-3"
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
    >
      <div
        role="region"
        aria-labelledby="discarded-edits-title"
        className="card pointer-events-auto mx-auto w-full max-w-md animate-slide-up p-4"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p id="discarded-edits-title" className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Some changes weren't kept
            </p>
            <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">
              Changes made on this device couldn't sync before your account was updated
              elsewhere, so your saved data was loaded instead.
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={dismissDiscardedLocalEdits} className="btn-ghost flex-1">
            Dismiss
          </button>
          {hasCopy && (
            <button onClick={download} className="btn-primary flex-1">
              Download copy
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const AppContent: React.FC = () => {
  const darkMode = useStore(s => s.darkMode)
  const onboardedAt = useStore(s => s.onboardedAt)
  const { user, loading, hydrating, loadFailed, discardedLocalEdits } = useAuth()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  // `hydrating` is the fetch that follows a fresh sign-in. Waiting for it is what stops a
  // returning user being shown the setup flow for half a second before their saved
  // profile lands.
  if (loading || hydrating) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2
            className="w-7 h-7 animate-spin text-jade-600 dark:text-jade-400"
            aria-hidden="true"
          />
          <p className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            MacroFit Pro
          </p>
          <p className="stat-label">Loading your data</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  if (loadFailed && onboardedAt === null) {
    return <LoadFailedScreen />
  }

  if (onboardedAt === null) {
    return <OnboardingPage />
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 transition-colors duration-200">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/diary" element={<Diary />} />
        <Route path="/workout" element={<Workout />} />
        <Route path="/progress" element={<Progress />} />
        {/* /goals left the bottom nav but stays reachable from the coach card and Profile. */}
        <Route path="/goals" element={<Goals />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
      <BottomNav />
      <ChatInterface />
      <SyncIndicator />
      {/* One card above the nav at a time, and a notice about lost edits outranks install. */}
      {discardedLocalEdits ? <DiscardedEditsNotice /> : <InstallPrompt />}
    </div>
  )
}

export const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  </BrowserRouter>
)
