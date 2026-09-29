/**
 * The ACTIVITY section appears when the phone sends activity, is absent when it does not, and
 * the no-eat-back rule is always in the prompt.
 *
 *   npx tsx scripts/check-coach-activity.ts
 */
import { buildCoachPrompt, type CoachContext } from '../api/_coach'

const withActivity: CoachContext = {
  coach: {
    now: 'Tuesday 29 Sep, 15:00',
    activity: {
      water: { todayMl: 600, goalMl: 3000, avg7Ml: 2250 },
      steps: null,
      training: {
        today: { planned: 'Legs', done: null },
        week: [{ date: '2026-09-27', name: 'Legs', topSets: 'Squat 100×5, RDL 80×8', prs: ['Squat'] }],
        weeklyGoal: { done: 2, target: 4 },
      },
    },
  },
}

const checks: [string, boolean][] = []
const on = buildCoachPrompt(withActivity)
const off = buildCoachPrompt({ coach: { now: 'Tuesday 29 Sep, 15:00' } })

checks.push(['section present', on.includes('ACTIVITY (context for WHAT and WHEN to eat')])
checks.push(['water line', on.includes('Water: 0.6 L of 3.0 L today, 7-day average 2.3 L')])
checks.push(['steps not connected', on.includes('Steps: not connected')])
checks.push(['training today', on.includes('Training today: planned: Legs')])
checks.push(['weekly goal', on.includes('This week: 2 of 4 sessions')])
checks.push(['session line', on.includes('2026-09-27 Legs: Squat 100×5, RDL 80×8 | PRs: Squat')])
checks.push(['behind pace is spelled out', on.includes('BEHIND pace (about 1.6 L expected by 15:00)')])
checks.push(['planned is not mistaken for done', on.includes('planned: Legs, not done yet')])
const onPace = buildCoachPrompt({
  coach: { ...withActivity.coach, activity: { ...withActivity.coach!.activity!, water: { todayMl: 1400, goalMl: 3000, avg7Ml: 2250 } } },
})
// Rule 8 itself mentions BEHIND, so these read the Water line only.
const waterLine = (prompt: string): string => prompt.split('\n').find(line => line.startsWith('  Water:')) ?? ''
checks.push(['on pace: says so, no BEHIND', waterLine(onPace).endsWith('; on pace')])
const noClock = buildCoachPrompt({ coach: { ...withActivity.coach, now: undefined } })
checks.push(['no time of day: no pace verdict', !/BEHIND|on pace/.test(waterLine(noClock)) && waterLine(noClock) !== ''])
checks.push(['section absent without activity', !off.includes('ACTIVITY (')])
checks.push(['rule always present', off.includes('never add calories for steps or workouts')])

let failed = 0
for (const [name, ok] of checks) {
  if (!ok) failed += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`)
}
process.exit(failed ? 1 : 0)
