import React, { useMemo, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Dumbbell, Flame, Lightbulb, Loader2, Minus, Scale, Target,
  TrendingDown, TrendingUp, Trophy,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { Navbar } from '../components/Layout/Navbar'
import {
  formatDate, getDayNutrition, getLast7Days, getLast30Days, getTodayString, kgToLbs,
} from '../utils/calculations'
import { getPersonalRecords, weeklyVolumeByMuscle } from '../utils/workoutMath'
import { DiaryDay } from '../types'

type Period = '7d' | '30d'
type ChartType = 'calories' | 'macros' | 'weight' | 'training'

/**
 * Recharts paints SVG attributes, so grid and axis colours cannot come from a Tailwind
 * `dark:` class — they are resolved here from the store's dark-mode flag, which is the
 * same flag App.tsx uses to toggle the `.dark` class. Values are the literal stone
 * tokens from docs/DESIGN-SYSTEM.md §2; grid and axes stay deliberately recessive and
 * there is never a heavy black axis line.
 */
const CHART_INK = {
  light: {
    grid: '#E7E5E4',    // stone-200
    axis: '#78716C',    // stone-500
    strong: '#44403C',  // stone-700
    soft: '#D6D3D1',    // stone-300
  },
  dark: {
    grid: '#292524',    // stone-800
    axis: '#A8A29E',    // stone-400
    strong: '#D6D3D1',  // stone-300
    soft: '#57534E',    // stone-600
  },
} as const

/**
 * Macro series read the CSS custom properties, never a hex — the light and dark values
 * genuinely differ and a hardcoded hex would silently keep the light palette in dark mode.
 * Colour follows the macro: protein is always blue, carbs always amber, fat always plum.
 */
const MACRO_PAINT = {
  protein: 'var(--macro-protein)',
  carbs: 'var(--macro-carbs)',
  fat: 'var(--macro-fat)',
  fiber: 'var(--macro-fiber)',
} as const

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'calories', label: 'Calories' },
  { id: 'macros', label: 'Macros' },
  { id: 'weight', label: 'Weight' },
  { id: 'training', label: 'Training' },
]

// Simple linear regression: returns slope (units per day) and intercept
function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length
  if (n < 2) return null
  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

const formatNumber = (value: unknown, format?: (n: number) => string): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return format ? format(value) : value.toLocaleString('en-US')
  }
  return value == null ? '—' : String(value)
}

interface ChartTooltipProps {
  active?: boolean
  label?: React.ReactNode
  // Injected by Recharts when it clones this element.
  payload?: ReadonlyArray<any>
  unit?: string
  format?: (value: number) => string
  footnote?: (row: any) => React.ReactNode
}

/**
 * Tooltip styled to the app surface — stone card, hairline border, rounded-xl — instead
 * of the Recharts default white box, which is unreadable on a dark background.
 */
const ChartTooltip: React.FC<ChartTooltipProps> = ({
  active, label, payload, unit = '', format, footnote,
}) => {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 shadow-sm dark:shadow-none">
      {label != null && label !== '' && (
        <p className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">{label}</p>
      )}
      <ul className="space-y-1">
        {payload.map((item, i) => (
          <li key={`${String(item?.dataKey ?? i)}`} className="flex items-center gap-2.5 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item?.color ?? 'currentColor' }}
              aria-hidden="true"
            />
            <span className="text-stone-600 dark:text-stone-400">{item?.name}</span>
            <span className="ml-auto font-display font-semibold tabular-nums text-stone-900 dark:text-stone-100">
              {formatNumber(item?.value, format)}{unit}
            </span>
          </li>
        ))}
      </ul>
      {footnote && row && (
        <p className="mt-1.5 border-t border-stone-200 dark:border-stone-800 pt-1.5 text-xs tabular-nums text-stone-500 dark:text-stone-400">
          {footnote(row)}
        </p>
      )}
    </div>
  )
}

export const Progress: React.FC = () => {
  const [period, setPeriod] = useState<Period>('7d')
  const [chartType, setChartType] = useState<ChartType>('calories')
  const [insights, setInsights] = useState<string | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  const diary = useStore(s => s.diary)
  const goals = useStore(s => s.goals)
  const weightLog = useStore(s => s.weightLog)
  const profile = useStore(s => s.profile)
  const workoutLog = useStore(s => s.workoutLog)
  const darkMode = useStore(s => s.darkMode)

  const ink = darkMode ? CHART_INK.dark : CHART_INK.light
  const weightUnit = profile.weightUnit

  const axisProps = {
    tick: { fill: ink.axis, fontSize: 11 },
    tickLine: false,
    axisLine: false,
    stroke: ink.axis,
  }

  // A legend is always present for 2+ series so identity is never carried by colour alone.
  const legendProps = {
    iconSize: 8,
    iconType: 'circle' as const,
    wrapperStyle: { fontSize: '11px', paddingTop: '6px' },
    formatter: (value: string) => (
      <span className="text-stone-600 dark:text-stone-400">{value}</span>
    ),
  }

  const dates = period === '7d' ? getLast7Days() : getLast30Days()

  const chartData = useMemo(() => {
    return dates.map(date => {
      const day: DiaryDay = diary[date] ?? { date, entries: [], waterIntake: 0, exercises: [] }
      const n = getDayNutrition(day)
      return {
        date: formatDate(date),
        calories: n.calories,
        protein: Math.round(n.protein),
        carbs: Math.round(n.carbs),
        fat: Math.round(n.fat),
        fiber: Math.round(n.fiber),
        burned: n.caloriesBurned,
        net: n.netCalories,
        water: Math.round(day.waterIntake / 1000 * 10) / 10,
      }
    })
  }, [dates, diary])

  const weightData = useMemo(() => {
    return weightLog
      .filter(w => dates.includes(w.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(w => ({ date: formatDate(w.date), weight: w.weight, bodyFat: w.bodyFat }))
  }, [weightLog, dates])

  const bodyFatData = useMemo(
    () => weightData.filter(w => typeof w.bodyFat === 'number' && w.bodyFat > 0),
    [weightData]
  )

  const stats = useMemo(() => {
    const days = chartData.filter(d => d.calories > 0)
    if (days.length === 0) return null
    const avgCal = Math.round(days.reduce((s, d) => s + d.calories, 0) / days.length)
    const avgProtein = Math.round(days.reduce((s, d) => s + d.protein, 0) / days.length)
    const avgCarbs = Math.round(days.reduce((s, d) => s + d.carbs, 0) / days.length)
    const avgFat = Math.round(days.reduce((s, d) => s + d.fat, 0) / days.length)
    const daysLogged = days.length
    return { avgCal, avgProtein, avgCarbs, avgFat, daysLogged }
  }, [chartData])

  const weightStats = useMemo(() => {
    if (weightLog.length < 2) return null
    const sorted = [...weightLog].sort((a, b) => a.date.localeCompare(b.date))
    const first = sorted[0].weight
    const last = sorted[sorted.length - 1].weight
    const change = last - first
    return { first, last, change, trend: change < 0 ? 'down' : 'up' }
  }, [weightLog])

  // Trend prediction using linear regression on all weight entries
  const trendPrediction = useMemo(() => {
    if (weightLog.length < 5) return null
    const sorted = [...weightLog].sort((a, b) => a.date.localeCompare(b.date))
    const origin = new Date(sorted[0].date).getTime()
    const points = sorted.map(w => ({
      x: (new Date(w.date).getTime() - origin) / 86400000,
      y: w.weight,
    }))
    const reg = linearRegression(points)
    if (!reg) return null
    const ratePerWeek = reg.slope * 7
    if (Math.abs(ratePerWeek) < 0.05) return { type: 'maintain' as const, ratePerWeek }
    return { type: ratePerWeek < 0 ? 'losing' as const : 'gaining' as const, ratePerWeek }
  }, [weightLog])

  // ── Training volume ────────────────────────────────────────────────────────
  // The period selector drives the window: 7d → 1 week, 30d → 4 weeks. `today` is
  // passed explicitly so the window lines up with the nutrition charts above.
  const volumeWeeks = period === '7d' ? 1 : 4

  const volumeData = useMemo(() => {
    return weeklyVolumeByMuscle(workoutLog, volumeWeeks, getTodayString()).map(row => ({
      muscleGroup: row.muscleGroup,
      volume: weightUnit === 'lbs' ? kgToLbs(row.volumeKg) : Math.round(row.volumeKg * 10) / 10,
      sets: row.sets,
    }))
  }, [workoutLog, volumeWeeks, weightUnit])

  const volumeTotals = useMemo(() => ({
    volume: Math.round(volumeData.reduce((s, r) => s + r.volume, 0)),
    sets: volumeData.reduce((s, r) => s + r.sets, 0),
  }), [volumeData])

  // Most recently achieved records first — "what did I just beat", not an all-time table.
  const personalRecords = useMemo(() => {
    return getPersonalRecords(workoutLog)
      .slice()
      .sort((a, b) =>
        b.achievedOn.localeCompare(a.achievedOn) || b.bestEstimated1RM - a.bestEstimated1RM
      )
      .slice(0, 5)
      .map(pr => ({
        ...pr,
        bestWeight: weightUnit === 'lbs' ? kgToLbs(pr.bestWeightKg) : Math.round(pr.bestWeightKg * 10) / 10,
        best1RM: weightUnit === 'lbs' ? kgToLbs(pr.bestEstimated1RM) : Math.round(pr.bestEstimated1RM * 10) / 10,
      }))
  }, [workoutLog, weightUnit])

  const hasWorkoutHistory = workoutLog.length > 0

  const getInsights = async () => {
    setInsightsLoading(true)
    setInsights(null)
    try {
      const last30 = getLast30Days()
      const summaries = last30.map(date => {
        const day: DiaryDay = diary[date] ?? { date, entries: [], waterIntake: 0, exercises: [] }
        const n = getDayNutrition(day)
        return `${date}: ${Math.round(n.calories)}kcal, P:${Math.round(n.protein)}g, C:${Math.round(n.carbs)}g, F:${Math.round(n.fat)}g`
      }).filter(s => !s.includes(': 0kcal')).join('\n')

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Analyze my last 30 days of nutrition data and give me 3-5 specific, actionable insights about patterns, consistency, and areas to improve. Be concise.\n\nData:\n${summaries}\n\nGoals: ${goals.calories}kcal, P:${goals.protein}g, C:${goals.carbs}g, F:${goals.fat}g`,
          }],
          context: { goals, todayEntries: [] },
        }),
      })
      const data = await res.json()
      setInsights(data.text || 'No insights available.')
    } catch {
      setInsights('Failed to load insights. Try again.')
    } finally {
      setInsightsLoading(false)
    }
  }

  const periodLabel = period === '7d' ? 'last 7 days' : 'last 30 days'

  return (
    <>
      <Navbar title="Progress" />

      <div className="page-container space-y-4">

        {/* Period selector */}
        <div className="flex gap-2" role="group" aria-label="Time period">
          {(['7d', '30d'] as Period[]).map(p => (
            <Segment key={p} tone="brand" active={period === p} onClick={() => setPeriod(p)}>
              {p === '7d' ? 'Last 7 days' : 'Last 30 days'}
            </Segment>
          ))}
        </div>

        {/* Chart type selector */}
        <div className="flex gap-2" role="group" aria-label="Metric">
          {CHART_TYPES.map(ct => (
            <Segment
              key={ct.id}
              tone="neutral"
              active={chartType === ct.id}
              onClick={() => setChartType(ct.id)}
            >
              {ct.label}
            </Segment>
          ))}
        </div>

        {/* Stats summary cards */}
        {stats && (chartType === 'calories' || chartType === 'macros') && (
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Avg. calories"
              value={stats.avgCal.toLocaleString('en-US')}
              goal={`${goals.calories.toLocaleString('en-US')} kcal`}
              icon={<Flame className="h-4 w-4" />}
            />
            <StatCard
              label="Days logged"
              value={`${stats.daysLogged}`}
              goal={period === '7d' ? '7 days' : '30 days'}
              icon={<Target className="h-4 w-4" />}
            />
          </div>
        )}

        {/* ── Calories ─────────────────────────────────────────────────────── */}
        {chartType === 'calories' && (
          <>
            <ChartCard title="Calorie intake" caption={`Eaten vs. burned, ${periodLabel}`}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip
                    cursor={{ fill: ink.grid, fillOpacity: 0.4 }}
                    content={<ChartTooltip unit=" kcal" />}
                  />
                  <Legend {...legendProps} />
                  <Bar dataKey="calories" fill={ink.strong} radius={[4, 4, 0, 0]} name="Eaten" />
                  <Bar dataKey="burned" fill={ink.soft} radius={[4, 4, 0, 0]} name="Burned" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Net calories" caption="Eaten minus burned, per day">
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip
                    cursor={{ stroke: ink.grid, strokeWidth: 1 }}
                    content={<ChartTooltip unit=" kcal" />}
                  />
                  <Line
                    type="monotone"
                    dataKey="net"
                    stroke={ink.strong}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: ink.strong }}
                    name="Net calories"
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Water intake" caption="Litres per day">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip
                    cursor={{ fill: ink.grid, fillOpacity: 0.4 }}
                    content={<ChartTooltip unit=" L" format={v => v.toFixed(1)} />}
                  />
                  <Bar dataKey="water" fill={ink.strong} radius={[4, 4, 0, 0]} name="Water" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </>
        )}

        {/* ── Macros ───────────────────────────────────────────────────────── */}
        {chartType === 'macros' && (
          <>
            <ChartCard title="Macronutrients" caption={`Grams per day, ${periodLabel}`}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip
                    cursor={{ stroke: ink.grid, strokeWidth: 1 }}
                    content={<ChartTooltip unit=" g" />}
                  />
                  <Legend {...legendProps} />
                  <Area
                    type="monotone" dataKey="protein" stackId="1"
                    stroke={MACRO_PAINT.protein} strokeWidth={2}
                    fill={MACRO_PAINT.protein} fillOpacity={0.14}
                    name="Protein"
                  />
                  <Area
                    type="monotone" dataKey="carbs" stackId="2"
                    stroke={MACRO_PAINT.carbs} strokeWidth={2}
                    fill={MACRO_PAINT.carbs} fillOpacity={0.14}
                    name="Carbs"
                  />
                  <Area
                    type="monotone" dataKey="fat" stackId="3"
                    stroke={MACRO_PAINT.fat} strokeWidth={2}
                    fill={MACRO_PAINT.fat} fillOpacity={0.14}
                    name="Fat"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {stats && (
              <section className="card p-4">
                <h3 className="section-title">Average daily macros</h3>
                <div className="grid grid-cols-2 gap-3">
                  <MacroStatCard label="Protein" avg={stats.avgProtein} goal={goals.protein} barClass="bg-macro-protein" />
                  <MacroStatCard label="Carbs" avg={stats.avgCarbs} goal={goals.carbs} barClass="bg-macro-carbs" />
                  <MacroStatCard label="Fat" avg={stats.avgFat} goal={goals.fat} barClass="bg-macro-fat" />
                  <MacroStatCard
                    label="Fiber"
                    avg={Math.round(chartData.reduce((s, d) => s + d.fiber, 0) / Math.max(chartData.filter(d => d.calories > 0).length, 1))}
                    goal={goals.fiber}
                    barClass="bg-macro-fiber"
                  />
                </div>
              </section>
            )}
          </>
        )}

        {/* ── Weight ───────────────────────────────────────────────────────── */}
        {chartType === 'weight' && (
          <>
            <ChartCard title="Weight" caption={`${weightUnit}, ${periodLabel}`}>
              {weightData.length === 0 ? (
                <EmptyState
                  icon={<Scale className="h-7 w-7 text-jade-700 dark:text-jade-300" aria-hidden="true" />}
                  title="No weigh-ins yet"
                  body={`Nothing was logged in the ${periodLabel}. Add a weigh-in from your Profile — a few entries a week is enough for the trend line to mean something.`}
                />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={weightData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} vertical={false} />
                    <XAxis dataKey="date" {...axisProps} />
                    <YAxis {...axisProps} domain={['dataMin - 2', 'dataMax + 2']} />
                    <Tooltip
                      cursor={{ stroke: ink.grid, strokeWidth: 1 }}
                      content={<ChartTooltip unit={` ${weightUnit}`} format={v => v.toFixed(1)} />}
                    />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      stroke={ink.strong}
                      strokeWidth={2}
                      // Each point is a manual weigh-in, so dotting is meaningful — but only
                      // while they stay countable. Past that the line reads better clean.
                      dot={weightData.length <= 10 ? { r: 4, strokeWidth: 0, fill: ink.strong } : false}
                      activeDot={{ r: 5, strokeWidth: 0, fill: ink.strong }}
                      name={`Weight (${weightUnit})`}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Body fat is a percentage — a different scale entirely, so it gets its own
                chart rather than a second axis. */}
            {bodyFatData.length > 0 && (
              <ChartCard title="Body fat" caption="Percentage, same weigh-ins">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={bodyFatData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} vertical={false} />
                    <XAxis dataKey="date" {...axisProps} />
                    <YAxis {...axisProps} domain={['dataMin - 1', 'dataMax + 1']} />
                    <Tooltip
                      cursor={{ stroke: ink.grid, strokeWidth: 1 }}
                      content={<ChartTooltip unit="%" format={v => v.toFixed(1)} />}
                    />
                    <Line
                      type="monotone"
                      dataKey="bodyFat"
                      stroke={ink.strong}
                      strokeWidth={2}
                      dot={bodyFatData.length <= 10 ? { r: 4, strokeWidth: 0, fill: ink.strong } : false}
                      activeDot={{ r: 5, strokeWidth: 0, fill: ink.strong }}
                      name="Body fat %"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {weightStats && (
              <section className="card p-4">
                <h3 className="section-title">Weight summary</h3>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="stat-label">Starting</p>
                    <p className="stat-value mt-1 text-xl">
                      {weightStats.first}
                      <span className="ml-1 font-sans text-xs font-medium text-stone-500 dark:text-stone-400">{weightUnit}</span>
                    </p>
                  </div>
                  <div>
                    <p className="stat-label">Current</p>
                    <p className="stat-value mt-1 text-xl">
                      {weightStats.last}
                      <span className="ml-1 font-sans text-xs font-medium text-stone-500 dark:text-stone-400">{weightUnit}</span>
                    </p>
                  </div>
                  <div>
                    <p className="stat-label">Change</p>
                    <p className="mt-1 flex items-center justify-center gap-1 text-stone-900 dark:text-stone-100">
                      {weightStats.trend === 'down'
                        ? <TrendingDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                        : <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      <span className="font-display text-xl font-semibold tabular-nums leading-tight">
                        {Math.abs(weightStats.change).toFixed(1)}
                      </span>
                      <span className="font-sans text-xs font-medium text-stone-500 dark:text-stone-400">{weightUnit}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      {weightStats.change < 0 ? 'lost' : 'gained'}
                    </p>
                  </div>
                </div>

                {trendPrediction && (
                  <div className="mt-4 border-t border-stone-200 dark:border-stone-800 pt-3">
                    <p className="stat-label">Trend prediction</p>
                    {trendPrediction.type === 'maintain' ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-stone-300">
                        <Minus className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Maintaining — change is under{' '}
                        <span className="font-display tabular-nums">0.05</span> {weightUnit}/week
                      </p>
                    ) : (
                      <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-stone-300">
                        {trendPrediction.type === 'losing'
                          ? <TrendingDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                          : <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />}
                        {trendPrediction.type === 'losing' ? 'Losing' : 'Gaining'}
                        {' '}
                        <span className="font-display font-semibold tabular-nums">
                          {Math.abs(trendPrediction.ratePerWeek).toFixed(2)}
                        </span>
                        {' '}{weightUnit}/week at the current pace
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* ── Training ─────────────────────────────────────────────────────── */}
        {chartType === 'training' && (
          <>
            {!hasWorkoutHistory ? (
              <div className="card p-6">
                <EmptyState
                  icon={<Dumbbell className="h-7 w-7 text-jade-700 dark:text-jade-300" aria-hidden="true" />}
                  title="No training logged yet"
                  body="Head to the Workout tab, start a session and log each set as weight × reps. Once a set is ticked off, this page shows how much volume every muscle group is getting and tracks your personal records."
                />
              </div>
            ) : (
              <>
                <ChartCard
                  title="Training volume"
                  caption={`Volume load by muscle group, ${periodLabel} (${weightUnit})`}
                >
                  {volumeData.length === 0 ? (
                    <EmptyState
                      icon={<Dumbbell className="h-7 w-7 text-jade-700 dark:text-jade-300" aria-hidden="true" />}
                      title={`Nothing logged in the ${periodLabel}`}
                      body="Volume counts completed working sets only — warmups and unticked sets are ignored. Log a session, or switch to Last 30 days to look further back."
                    />
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={Math.max(150, volumeData.length * 36 + 16)}>
                        <BarChart
                          data={volumeData}
                          layout="vertical"
                          margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} horizontal={false} />
                          <XAxis type="number" {...axisProps} />
                          <YAxis type="category" dataKey="muscleGroup" width={86} {...axisProps} />
                          <Tooltip
                            cursor={{ fill: ink.grid, fillOpacity: 0.4 }}
                            content={
                              <ChartTooltip
                                unit={` ${weightUnit}`}
                                footnote={row => `${row.sets} working set${row.sets === 1 ? '' : 's'}`}
                              />
                            }
                          />
                          <Bar dataKey="volume" fill={ink.strong} radius={[0, 4, 4, 0]} name="Volume">
                            <LabelList
                              dataKey="volume"
                              position="right"
                              fill={ink.axis}
                              fontSize={11}
                              style={{ fontVariantNumeric: 'tabular-nums' }}
                              formatter={(value: number) => Math.round(value).toLocaleString('en-US')}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>

                      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-200 dark:border-stone-800 pt-3">
                        <div>
                          <p className="stat-label">Total volume</p>
                          <p className="stat-value mt-1 text-xl">
                            {volumeTotals.volume.toLocaleString('en-US')}
                            <span className="ml-1 font-sans text-xs font-medium text-stone-500 dark:text-stone-400">{weightUnit}</span>
                          </p>
                        </div>
                        <div>
                          <p className="stat-label">Working sets</p>
                          <p className="stat-value mt-1 text-xl">{volumeTotals.sets}</p>
                        </div>
                      </div>
                    </>
                  )}
                </ChartCard>

                <section className="card p-4">
                  <h3 className="section-title flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-jade-700 dark:text-jade-400" aria-hidden="true" />
                    Recent personal records
                  </h3>
                  {personalRecords.length === 0 ? (
                    <p className="text-sm text-stone-600 dark:text-stone-400">
                      No records yet. Log a set with a weight on it — bodyweight-only sets build
                      volume but cannot set a strength record.
                    </p>
                  ) : (
                    <ul className="divide-y divide-stone-200 dark:divide-stone-800">
                      {personalRecords.map(pr => (
                        <li key={pr.liftId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                              {pr.liftName}
                            </p>
                            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                              <span className="font-display tabular-nums">{pr.bestWeight}</span> {weightUnit} best set
                              {pr.achievedOn ? ` · ${formatDate(pr.achievedOn)}` : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-display text-lg font-semibold tabular-nums leading-tight text-stone-900 dark:text-stone-100">
                              {pr.best1RM}
                            </p>
                            <p className="stat-label">est. 1RM {weightUnit}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        )}

        {/* Pattern insights */}
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="section-title mb-0 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-jade-700 dark:text-jade-400" aria-hidden="true" />
              AI pattern insights
            </h3>
            <button
              type="button"
              onClick={getInsights}
              disabled={insightsLoading}
              className="btn-primary shrink-0 px-3 text-sm"
            >
              {insightsLoading
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Lightbulb className="h-4 w-4" aria-hidden="true" />}
              {insightsLoading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
          {insights ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-stone-700 dark:text-stone-300">
              {insights}
            </p>
          ) : (
            <p className="text-sm text-stone-600 dark:text-stone-400">
              Analyze reads your last 30 days of food logs and calls out the patterns you cannot
              see day to day — consistency, protein gaps, the days that always run over.
            </p>
          )}
        </section>
      </div>
    </>
  )
}

const Segment: React.FC<{
  active: boolean
  tone: 'brand' | 'neutral'
  onClick: () => void
  children: React.ReactNode
}> = ({ active, tone, onClick, children }) => {
  const activeClass = tone === 'brand'
    ? 'bg-jade-600 text-white border-jade-600'
    : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 border-stone-900 dark:border-stone-100'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 min-h-[44px] rounded-xl border px-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950 ${
        active
          ? activeClass
          : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100'
      }`}
    >
      {children}
    </button>
  )
}

const ChartCard: React.FC<{
  title: string
  caption?: string
  children: React.ReactNode
}> = ({ title, caption, children }) => (
  <section className="card p-4">
    <div className="mb-4">
      <h3 className="section-title mb-0">{title}</h3>
      {caption && <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{caption}</p>}
    </div>
    {children}
  </section>
)

const EmptyState: React.FC<{
  icon: React.ReactNode
  title: string
  body: string
}> = ({ icon, title, body }) => (
  <div className="space-y-3 py-4 text-center">
    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-jade-50 dark:bg-jade-900/30">
      {icon}
    </span>
    <div className="space-y-1.5">
      <p className="font-display text-base font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        {title}
      </p>
      <p className="mx-auto max-w-sm text-sm leading-relaxed text-stone-600 dark:text-stone-400">
        {body}
      </p>
    </div>
  </div>
)

const StatCard: React.FC<{
  label: string
  value: string
  goal: string
  icon: React.ReactNode
}> = ({ label, value, goal, icon }) => (
  <div className="card p-4">
    <div className="flex items-center gap-2">
      <span className="text-stone-500 dark:text-stone-400" aria-hidden="true">{icon}</span>
      <span className="stat-label">{label}</span>
    </div>
    <p className="stat-value mt-1.5">{value}</p>
    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
      Goal <span className="font-display tabular-nums">{goal}</span>
    </p>
  </div>
)

const MacroStatCard: React.FC<{
  label: string
  avg: number
  goal: number
  barClass: string
}> = ({ label, avg, goal, barClass }) => {
  const pct = Math.round((avg / Math.max(goal, 1)) * 100)
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-stone-700 dark:text-stone-300">{label}</span>
        <span className="font-display text-xs font-semibold tabular-nums text-stone-500 dark:text-stone-400">
          {pct}%
        </span>
      </div>
      <p className="stat-value mt-1 text-xl">
        {avg}
        <span className="ml-0.5 font-sans text-xs font-medium text-stone-500 dark:text-stone-400">g</span>
      </p>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Goal <span className="font-display tabular-nums">{goal}</span>g
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
        <div
          className={`progress-bar-fill h-full rounded-full ${barClass}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}
