import React from 'react'
import { Trophy } from 'lucide-react'

interface PRBadgeProps {
  /** Short label. Defaults to the quiet 'New PR'. */
  label?: string
  /** Optional number, e.g. '102.5 kg' — rendered in the display face like every other stat. */
  detail?: string
  className?: string
}

/**
 * Quiet celebration for a new personal record. It sits inline next to the set that
 * earned it, so it is deliberately small — the number is the reward, not the badge.
 * `motion-safe:` keeps the entrance animation off for anyone who asked for reduced
 * motion (the global reduce rule in index.css is a second line of defence).
 */
export const PRBadge: React.FC<PRBadgeProps> = ({ label = 'New PR', detail, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border border-jade-200 dark:border-jade-800 bg-jade-50 dark:bg-jade-900/30 px-2.5 py-1 text-xs font-semibold text-jade-700 dark:text-jade-300 motion-safe:animate-scale-in ${className}`}
  >
    <Trophy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
    <span>{label}</span>
    {detail && <span className="font-display font-semibold tabular-nums">{detail}</span>}
  </span>
)
