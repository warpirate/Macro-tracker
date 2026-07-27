import React from 'react'
import { NavLink } from 'react-router-dom'
import { Home, BookOpen, Dumbbell, TrendingUp, User } from 'lucide-react'

/*
  Five items is the maximum for a comfortable mobile bottom nav — see
  docs/SPEC-COACH-AND-WORKOUT.md §3. Goals is intentionally absent: its route
  stays alive and is reached from the Dashboard coach card and from Profile.
*/
const navItems = [
  { to: '/', icon: Home, label: 'Dashboard' },
  { to: '/diary', icon: BookOpen, label: 'Diary' },
  { to: '/workout', icon: Dumbbell, label: 'Workout' },
  { to: '/progress', icon: TrendingUp, label: 'Progress' },
  { to: '/profile', icon: User, label: 'Profile' },
]

export const BottomNav: React.FC = () => (
  <nav
    aria-label="Primary"
    // Clears the iOS home indicator without shrinking the touch targets above it.
    style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    className="fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 dark:border-stone-800 bg-white/95 dark:bg-stone-900/95 backdrop-blur-sm"
  >
    <div className="max-w-2xl mx-auto flex">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `relative flex-1 min-h-[56px] flex flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-jade-500 ${
              isActive
                ? 'text-jade-700 dark:text-jade-300'
                : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {/* Active state never rests on color alone: indicator bar + icon
                  weight + label weight + the aria-current NavLink sets. */}
              <span
                aria-hidden="true"
                className={`absolute top-0 h-0.5 w-8 rounded-full bg-jade-600 dark:bg-jade-400 transition-opacity duration-150 ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.25 : 1.75} aria-hidden="true" />
              <span
                className={`w-full text-center text-[11px] leading-none truncate ${
                  isActive ? 'font-bold' : 'font-medium'
                }`}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  </nav>
)
