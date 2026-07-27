import React from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import type { CoachAlert } from '../../types'

export interface CoachAlertsProps {
  /** Alerts from `getCoachAlerts`, most severe first. Nothing renders when empty. */
  alerts: CoachAlert[]
  /** Extra layout classes for the list wrapper. */
  className?: string
}

/*
  Status colors are the reserved warning tokens from docs/DESIGN-SYSTEM.md §2
  (#B45309 light / #F59E0B dark). They are not in the Tailwind scale on purpose —
  they must never be reused as a chart series — so they are written as the exact
  documented hex values here.
*/
const WARNING_SURFACE =
  'border-[#B45309]/30 bg-[#B45309]/5 dark:border-[#F59E0B]/30 dark:bg-[#F59E0B]/10'
const WARNING_TEXT = 'text-[#B45309] dark:text-[#F59E0B]'

const INFO_SURFACE = 'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-800/40'
const INFO_TEXT = 'text-stone-700 dark:text-stone-300'
const INFO_ICON = 'text-stone-500 dark:text-stone-400'

/**
 * Renders the coach's alert list. Severity is carried by an icon and a screen-reader
 * prefix as well as color, so the meaning survives without it.
 */
export const CoachAlerts: React.FC<CoachAlertsProps> = ({ alerts, className }) => {
  if (!Array.isArray(alerts) || alerts.length === 0) return null

  return (
    <ul className={['space-y-2', className].filter(Boolean).join(' ')}>
      {alerts.map(alert => {
        const isWarning = alert.severity === 'warning'
        const Icon = isWarning ? AlertTriangle : Info

        return (
          <li
            key={alert.id}
            className={`flex items-start gap-3 rounded-xl border p-3 ${isWarning ? WARNING_SURFACE : INFO_SURFACE}`}
          >
            <Icon
              className={`mt-0.5 h-5 w-5 shrink-0 ${isWarning ? WARNING_TEXT : INFO_ICON}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${isWarning ? WARNING_TEXT : INFO_TEXT}`}>
                <span className="sr-only">{isWarning ? 'Warning: ' : 'Note: '}</span>
                {alert.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                {alert.detail}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
