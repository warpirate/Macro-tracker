import React from 'react'
import { Moon, Sun, Flame } from 'lucide-react'
import { useStore } from '../../store/useStore'

interface NavbarProps {
  title?: string
  subtitle?: string
  action?: React.ReactNode
}

export const Navbar: React.FC<NavbarProps> = ({ title = 'MacroFit Pro', subtitle, action }) => {
  const darkMode = useStore(s => s.darkMode)
  const toggleDarkMode = useStore(s => s.toggleDarkMode)
  const streak = useStore(s => s.streak)

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/90 backdrop-blur-sm">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100 truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-stone-500 dark:text-stone-500 truncate">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {streak.current > 0 && (
            <span className="pill">
              <Flame className="w-3.5 h-3.5 text-amber-700 dark:text-amber-500" aria-hidden="true" />
              <span className="font-display font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                {streak.current}
              </span>
              <span className="sr-only">day logging streak</span>
            </span>
          )}

          {action}

          <button
            onClick={toggleDarkMode}
            className="btn-icon"
            aria-label="Toggle dark mode"
          >
            {darkMode
              ? <Sun className="w-5 h-5 text-amber-500" />
              : <Moon className="w-5 h-5" />
            }
          </button>
        </div>
      </div>
    </header>
  )
}
