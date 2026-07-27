import React, { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const InstallPrompt: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('pwa-install-dismissed') === 'true')
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    // Already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setInstallEvent(null)
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem('pwa-install-dismissed', 'true')
  }

  if (installed || dismissed || !installEvent) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 px-3"
      // Sits above the fixed bottom nav and clears the iOS home indicator.
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
    >
      <div
        role="region"
        aria-label="Install MacroFit"
        className="card pointer-events-auto mx-auto w-full max-w-md animate-slide-up p-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jade-50 dark:bg-jade-900/40">
            <Download className="h-5 w-5 text-jade-700 dark:text-jade-400" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Install MacroFit</p>
            <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">
              Add it to your home screen for quick, offline access.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
            className="btn-icon -mr-2 -mt-2 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button onClick={handleDismiss} className="btn-ghost flex-1">
            Not now
          </button>
          <button onClick={handleInstall} className="btn-primary flex-1">
            Install
          </button>
        </div>
      </div>
    </div>
  )
}
