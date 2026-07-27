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
  const { signIn, signUp, signInWithGoogle, signInWithGitHub, signInWithMagicLink } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [emailMode, setEmailMode] = useState<'password' | 'magic'>('password')
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

    if (emailMode === 'magic') {
      const { error } = await signInWithMagicLink(email)
      if (error) setError(error.message)
      else setMessage('Check your email — we sent you a sign-in link.')
    } else if (mode === 'signin') {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
    } else {
      const { error } = await signUp(email, password)
      if (error) setError(error.message)
      else setMessage('Check your email to confirm your account, then sign in.')
    }
    setLoading(false)
  }

  const handleGoogle = async () => {
    setError('')
    const { error } = await signInWithGoogle()
    if (error) setError(error.message)
  }

  const handleGitHub = async () => {
    setError('')
    const { error } = await signInWithGitHub()
    if (error) setError(error.message)
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
          {/* Social sign-in */}
          <button type="button" onClick={handleGoogle} className="btn-secondary w-full">
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <button type="button" onClick={handleGitHub} className="btn-secondary w-full">
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            Continue with GitHub
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
              or
            </span>
            <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          </div>

          {/* Mode tabs (only shown in password mode) */}
          {emailMode === 'password' && (
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
          )}

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

            {emailMode === 'password' && (
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
            )}

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
              ) : emailMode === 'magic' ? (
                'Send Magic Link'
              ) : mode === 'signin' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          {/* Toggle magic link / password */}
          <button
            type="button"
            onClick={() => {
              setEmailMode(m => (m === 'password' ? 'magic' : 'password'))
              setError('')
              setMessage('')
            }}
            className="btn-ghost w-full text-sm font-semibold text-jade-700 hover:text-jade-800 dark:text-jade-400 dark:hover:text-jade-300"
          >
            {emailMode === 'password' ? 'Sign in without a password →' : '← Use password instead'}
          </button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 px-4 text-center text-xs text-stone-500 dark:text-stone-500">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Your data is encrypted and synced securely across all your devices.
        </p>
      </div>
    </div>
  )
}
