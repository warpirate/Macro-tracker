import React, { useEffect } from 'react'
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
import { InstallPrompt } from './components/InstallPrompt'

/*
  Transient sync toast. It floats just under the sticky Navbar rather than on top
  of it, is pointer-events-none so it can never swallow a tap meant for the header
  controls, and offsets itself past env(safe-area-inset-top) on notched devices.
*/
const SyncIndicator: React.FC = () => {
  const { syncStatus } = useAuth()
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
          Sync error
        </>
      )}
    </div>
  )
}

const AppContent: React.FC = () => {
  const darkMode = useStore(s => s.darkMode)
  const { user, loading } = useAuth()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  if (loading) {
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
      <InstallPrompt />
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
