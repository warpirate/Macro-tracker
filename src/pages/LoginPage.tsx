import React, { useState } from 'react'
import { AlertCircle, Loader2, MailCheck, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/**
 * The app mark: three concentric macro rings, mirroring public/icon-512.svg.
 * Drawn inline (never a raster) so it stays crisp and themes with the tile.
 * Stroke tints are palette tokens — stone-50, jade-50, jade-200.
 */
const RingMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 512 512" fill="none" className={className} aria-hidden="true">
    <g transform="rotate(-90 256 256)" strokeLinecap="round">
      <circle cx="256" cy="256" r="150" stroke="#FAFAF9" strokeOpacity="0.25" strokeWidth="30" />
      <circle
        cx="256"
        cy="256"
        r="150"
        stroke="#FAFAF9"
        strokeWidth="30"
        pathLength={100}
        strokeDasharray="78 22"
      />
      <circle cx="256" cy="256" r="106" stroke="#FAFAF9" strokeOpacity="0.25" strokeWidth="26" />
      <circle
        cx="256"
        cy="256"
        r="106"
        stroke="#EDFAF5"
        strokeWidth="26"
        pathLength={100}
        strokeDasharray="55 45"
      />
      <circle cx="256" cy="256" r="64" stroke="#FAFAF9" strokeOpacity="0.25" strokeWidth="22" />
      <circle
        cx="256"
        cy="256"
        r="64"
        stroke="#A8E7CE"
        strokeWidth="22"
        pathLength={100}
        strokeDasharray="35 65"
      />
    </g>
  </svg>
)

export const LoginPage: React.FC = () => {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m)
    setError('')
    setMessage('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const result = mode === 'signin' ? await signIn(email, password) : await signUp(email, password)
    setError(result.error ?? '')
    setMessage(result.notice ?? '')
    // A new account that still needs confirming cannot sign in yet, so leave the user on
    // the form they will need next rather than the one they just used.
    if (mode === 'signup' && result.notice) setMode('signin')
    setLoading(false)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-50 px-4 py-12 dark:bg-stone-950 sm:py-16">
      {/* Atmosphere: soft jade glow layered over the warm stone canvas, with the
          concentric-ring motif from the app icon drawn very faintly behind the card. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-16rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-jade-200/50 blur-3xl dark:bg-jade-800/25" />
        <div className="absolute bottom-[-18rem] left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-stone-200/70 blur-3xl dark:bg-stone-800/40" />
        <svg
          viewBox="0 0 400 400"
          fill="none"
          className="absolute left-1/2 top-1/2 h-[44rem] w-[44rem] max-w-none -translate-x-1/2 -translate-y-1/2 text-stone-300/60 dark:text-stone-800/80"
        >
          <circle cx="200" cy="200" r="196" stroke="currentColor" strokeWidth="1" />
          <circle cx="200" cy="200" r="148" stroke="currentColor" strokeWidth="1" />
          <circle cx="200" cy="200" r="100" stroke="currentColor" strokeWidth="1" />
          <circle
            cx="200"
            cy="200"
            r="148"
            className="text-jade-500/25 dark:text-jade-400/20"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="18 82"
            transform="rotate(-90 200 200)"
          />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Wordmark */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-jade-500 via-jade-600 to-jade-700 shadow-lg shadow-jade-900/20 dark:shadow-none">
            <RingMark className="h-9 w-9" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            MacroFit
          </h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Track your nutrition anywhere
          </p>
        </div>

        <div className="card animate-slide-up space-y-4 bg-white/85 p-6 backdrop-blur-xl dark:bg-stone-900/80">
          {/* Sign in / sign up */}
          <div className="flex gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-800/60">
              {(['signin', 'signup'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                  className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 ${
                    mode === m
                      ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100 dark:shadow-none'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200'
                  }`}
                >
                  {m === 'signin' ? 'Sign In' : 'Sign Up'}
                </button>
              ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="label-text">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="label-text">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                className="input-field"
              />
            </div>

            {/* Status colors are reserved (design system §2) and always ship an icon + text. */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-[#B91C1C]/25 bg-[#B91C1C]/[0.06] px-3 py-2.5 dark:border-[#F87171]/30 dark:bg-[#F87171]/10"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#B91C1C] dark:text-[#F87171]"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-[#B91C1C] dark:text-[#F87171]">{error}</p>
              </div>
            )}
            {message && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-jade-600/25 bg-jade-50 px-3 py-2.5 dark:border-jade-400/25 dark:bg-jade-900/25"
              >
                <MailCheck
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-jade-700 dark:text-jade-400"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-jade-700 dark:text-jade-400">{message}</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Please wait…
                </>
              ) : mode === 'signin' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>

        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 px-4 text-center text-xs text-stone-500 dark:text-stone-500">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Your data is encrypted and synced securely across all your devices.
        </p>
      </div>
    </div>
  )
}
