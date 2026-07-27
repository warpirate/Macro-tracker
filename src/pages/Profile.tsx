import React, { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Bookmark,
  Camera,
  CheckCircle2,
  ChevronRight,
  Download,
  Flame,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Plus,
  Ruler,
  Scale,
  Smartphone,
  Target,
  Trash2,
  User,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../store/useStore'
import { useAuth } from '../contexts/AuthContext'
import { uploadProgressPhoto, deleteProgressPhoto } from '../lib/storage'
import { Navbar } from '../components/Layout/Navbar'
import {
  calculateBMI,
  getBMICategory,
  kgToLbs,
  cmToFeetInches,
  formatDate,
  getTodayString,
} from '../utils/calculations'
import { ActivityLevel, WeightGoal, UserProfile, PhotoPose, MealTemplate } from '../types'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Tab = 'profile' | 'weight' | 'body' | 'photos' | 'custom' | 'templates'

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (desk job)',
  lightly_active: 'Lightly Active (1-3x/week)',
  moderately_active: 'Moderately Active (3-5x/week)',
  very_active: 'Very Active (6-7x/week)',
  extra_active: 'Extra Active (2x/day)',
}

/* Each tab carries an icon as well as a label so the active state never rests on color. */
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'weight', label: 'Weight', icon: Scale },
  { id: 'body', label: 'Body', icon: Ruler },
  { id: 'photos', label: 'Photos', icon: Camera },
  { id: 'custom', label: 'Custom', icon: Utensils },
  { id: 'templates', label: 'Templates', icon: Bookmark },
]

type MeasurementKey =
  | 'neck' | 'shoulders' | 'chest' | 'waist' | 'hips' | 'leftArm' | 'rightArm' | 'leftThigh'

const MEASUREMENT_FIELDS: [MeasurementKey, string][] = [
  ['neck', 'Neck'], ['shoulders', 'Shoulders'], ['chest', 'Chest'], ['waist', 'Waist'],
  ['hips', 'Hips'], ['leftArm', 'Arm (L)'], ['rightArm', 'Arm (R)'], ['leftThigh', 'Thigh'],
]

/* Reserved status colors — docs/DESIGN-SYSTEM.md §2. Always shipped with an icon and text. */
const TONE_TEXT = {
  good: 'text-jade-600 dark:text-jade-400',
  warning: 'text-[#B45309] dark:text-[#F59E0B]',
  critical: 'text-[#B91C1C] dark:text-[#F87171]',
} as const

type Tone = keyof typeof TONE_TEXT

const TONE_ICON: Record<Tone, LucideIcon> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertCircle,
}

const getBmiTone = (bmi: number): Tone => {
  if (bmi < 18.5) return 'warning'
  if (bmi < 25) return 'good'
  if (bmi < 30) return 'warning'
  return 'critical'
}

/* Destructive twin of .btn-icon: same 44px target, critical status color on hover. */
const DANGER_ICON_BUTTON =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-500 dark:text-stone-400 transition-colors duration-150 hover:bg-[#B91C1C]/10 hover:text-[#B91C1C] dark:hover:bg-[#F87171]/10 dark:hover:text-[#F87171] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950'

const ROW = 'flex items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-800 px-4 py-3 last:border-b-0'

/* Header of a .card-flush list: sits above the first row, so it owns the hairline below it. */
const LIST_HEADER = 'flex items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-800 px-4 py-3'

const templateCalories = (template: MealTemplate): number =>
  Math.round(template.entries.reduce((sum, entry) => sum + (entry.food?.calories ?? 0) * entry.servings, 0))

export const Profile: React.FC = () => {
  const profile = useStore(s => s.profile)
  const currentWeightKg = useStore(s => s.currentWeightKg)
  const weightLog = useStore(s => s.weightLog)
  const streak = useStore(s => s.streak)
  const customFoods = useStore(s => s.customFoods)
  const mealTemplates = useStore(s => s.mealTemplates)
  const updateProfile = useStore(s => s.updateProfile)
  const setCurrentWeight = useStore(s => s.setCurrentWeight)
  const addWeightEntry = useStore(s => s.addWeightEntry)
  const removeWeightEntry = useStore(s => s.removeWeightEntry)
  const removeCustomFood = useStore(s => s.removeCustomFood)
  const deleteMealTemplate = useStore(s => s.deleteMealTemplate)
  const addCustomFood = useStore(s => s.addCustomFood)
  const recalculateGoals = useStore(s => s.recalculateGoals)
  const bodyMeasurements = useStore(s => s.bodyMeasurements)
  const addBodyMeasurement = useStore(s => s.addBodyMeasurement)
  const removeBodyMeasurement = useStore(s => s.removeBodyMeasurement)
  const progressPhotos = useStore(s => s.progressPhotos)
  const addProgressPhoto = useStore(s => s.addProgressPhoto)
  const removeProgressPhoto = useStore(s => s.removeProgressPhoto)

  const { user, signOut } = useAuth()

  const [activeTab, setActiveTab] = useState<Tab>('profile')

  // PWA install state
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [pwaInstalled, setPwaInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches
  )
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallEvent(e as BeforeInstallPromptEvent) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setPwaInstalled(true))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  const [newWeight, setNewWeight] = useState('')
  const [newBodyFat, setNewBodyFat] = useState('')
  const [saved, setSaved] = useState(false)
  const [showCustomFoodForm, setShowCustomFoodForm] = useState(false)
  const [viewPhoto, setViewPhoto] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [photoNote, setPhotoNote] = useState('')
  const [photoPose, setPhotoPose] = useState<PhotoPose>('front')

  const compressImage = (file: File): Promise<string> =>
    new Promise(resolve => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const max = 800
        const scale = Math.min(max / img.width, max / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/jpeg', 0.65))
      }
      img.src = url
    })

  const displayWeight = profile.weightUnit === 'lbs' ? kgToLbs(currentWeightKg) : currentWeightKg
  const bmi = calculateBMI(currentWeightKg, profile.heightCm)
  const bmiCat = getBMICategory(bmi)
  const bmiTone = getBmiTone(bmi)
  const BmiIcon = TONE_ICON[bmiTone]

  const handleSaveProfile = (updates: Partial<UserProfile>) => {
    updateProfile(updates)
    recalculateGoals()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleLogWeight = () => {
    const w = parseFloat(newWeight)
    if (!w) return
    addWeightEntry({
      date: getTodayString(),
      weight: w,
      bodyFat: newBodyFat ? parseFloat(newBodyFat) : undefined,
    })
    setNewWeight('')
    setNewBodyFat('')
  }

  return (
    <>
      <Navbar title="Profile" />

      <div className="page-container space-y-4">

        {/* Identity + headline stats */}
        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-jade-50 dark:bg-jade-900/30">
              <User className="h-7 w-7 text-jade-700 dark:text-jade-300" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                {profile.name || 'Your Name'}
              </h2>
              <p className="text-sm text-stone-600 dark:text-stone-400">
                <span className="font-display tabular-nums">{profile.age}</span>y · {profile.gender} ·{' '}
                <span className="font-display tabular-nums">
                  {profile.heightUnit === 'cm'
                    ? `${profile.heightCm}cm`
                    : cmToFeetInches(profile.heightCm)}
                </span>
              </p>
              {user?.email && (
                <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-500">{user.email}</p>
              )}
            </div>
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              className={DANGER_ICON_BUTTON}
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-2 py-3 text-center dark:border-stone-800 dark:bg-stone-950/60">
              <p className="stat-value">{displayWeight}</p>
              <p className="stat-label mt-1">{profile.weightUnit}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-2 py-3 text-center dark:border-stone-800 dark:bg-stone-950/60">
              <p className={`stat-value ${TONE_TEXT[bmiTone]}`}>{bmi}</p>
              <p className="stat-label mt-1">BMI</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-2 py-3 text-center dark:border-stone-800 dark:bg-stone-950/60">
              <p className="stat-value flex items-center justify-center gap-1.5">
                <Flame className="h-4 w-4 text-amber-700 dark:text-amber-500" aria-hidden="true" />
                {streak.current}
              </p>
              <p className="stat-label mt-1">Day streak</p>
            </div>
          </div>
          <p className={`mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold ${TONE_TEXT[bmiTone]}`}>
            <BmiIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {bmiCat.label}
          </p>
        </section>

        {/* Achievements */}
        <section className="card p-4">
          <h3 className="section-title flex items-center gap-2">
            <Award className="h-4 w-4 text-amber-700 dark:text-amber-500" aria-hidden="true" /> Achievements
          </h3>
          <div className="flex flex-wrap gap-2">
            {streak.current >= 7 && <Badge label="Day Streak" value={streak.current} emoji="🔥" />}
            {streak.longest >= 30 && <Badge label="30 Day Warrior" emoji="⚔️" />}
            {weightLog.length >= 10 && <Badge label="Scale Tracker" emoji="⚖️" />}
            {weightLog.length === 0 && streak.current === 0 && (
              <p className="text-sm text-stone-600 dark:text-stone-400">
                Log your first meal to earn achievements.
              </p>
            )}
            {streak.current > 0 && <Badge label="First Log" emoji="🌱" />}
            {streak.current >= 3 && <Badge label="3 Day Streak" emoji="🔥" />}
          </div>
        </section>

        {/* Tabs — scrollable on narrow screens, 44px targets, icon + fill for the active state */}
        <div
          role="group"
          aria-label="Profile sections"
          className="card flex gap-1 overflow-x-auto p-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-pressed={isActive}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900 ${
                  isActive
                    ? 'bg-jade-600 font-semibold text-white'
                    : 'font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </div>

        {/* Profile tab */}
        {activeTab === 'profile' && (
          <div className="space-y-4">
            <section className="card space-y-4 p-4">
              <h3 className="section-title mb-0">Your details</h3>

              <FormField label="Name">
                <input
                  type="text"
                  defaultValue={profile.name}
                  onBlur={e => handleSaveProfile({ name: e.target.value })}
                  className="input-field"
                  placeholder="Your name"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Age">
                  <input
                    type="number"
                    defaultValue={profile.age}
                    onBlur={e => handleSaveProfile({ age: Number(e.target.value) })}
                    className="input-field"
                    min={13} max={100}
                  />
                </FormField>

                <FormField label="Gender">
                  <select
                    defaultValue={profile.gender}
                    onChange={e => handleSaveProfile({ gender: e.target.value as UserProfile['gender'] })}
                    className="input-field"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label={`Height (${profile.heightUnit})`}>
                  <input
                    type="number"
                    defaultValue={profile.heightCm}
                    onBlur={e => handleSaveProfile({ heightCm: Number(e.target.value) })}
                    className="input-field"
                    min={100} max={250}
                  />
                </FormField>

                <FormField label="Units">
                  <select
                    defaultValue={profile.weightUnit}
                    onChange={e => handleSaveProfile({ weightUnit: e.target.value as 'lbs' | 'kg' })}
                    className="input-field"
                  >
                    <option value="lbs">lbs</option>
                    <option value="kg">kg</option>
                  </select>
                </FormField>
              </div>

              <FormField label="Activity Level">
                <select
                  defaultValue={profile.activityLevel}
                  onChange={e => handleSaveProfile({ activityLevel: e.target.value as ActivityLevel })}
                  className="input-field"
                >
                  {(Object.entries(ACTIVITY_LABELS) as [ActivityLevel, string][]).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </FormField>

              <FormField label="Goal">
                <select
                  defaultValue={profile.goal}
                  onChange={e => handleSaveProfile({ goal: e.target.value as WeightGoal })}
                  className="input-field"
                >
                  <option value="lose">Lose Weight</option>
                  <option value="maintain">Maintain Weight</option>
                  <option value="gain">Gain Weight</option>
                </select>
              </FormField>

              {saved && (
                <p
                  role="status"
                  className="flex items-center justify-center gap-1.5 text-sm font-semibold text-jade-600 dark:text-jade-400 animate-fade-in"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved
                </p>
              )}
            </section>

            <Link
              to="/goals"
              className="card flex items-center gap-3 p-4 transition-colors duration-150 hover:border-jade-300 dark:hover:border-jade-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jade-50 dark:bg-jade-900/30">
                <Target className="h-5 w-5 text-jade-700 dark:text-jade-300" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-stone-900 dark:text-stone-100">Goals &amp; targets</span>
                <span className="block text-sm text-stone-600 dark:text-stone-400">
                  Calories, macros and how they are worked out
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true" />
            </Link>

            {/* App / Install section */}
            <section className="card space-y-3 p-4">
              <h3 className="section-title mb-0 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-jade-700 dark:text-jade-300" aria-hidden="true" /> Get the app
              </h3>
              {pwaInstalled ? (
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-jade-600 dark:text-jade-400" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">MacroFit is installed</p>
                    <p className="text-xs text-stone-600 dark:text-stone-400">Running as a native app on this device</p>
                  </div>
                </div>
              ) : installEvent ? (
                <div className="space-y-3">
                  <p className="text-sm text-stone-600 dark:text-stone-400">
                    Install MacroFit on your home screen for fast, offline access — no app store needed.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await installEvent.prompt()
                      const { outcome } = await installEvent.userChoice
                      if (outcome === 'accepted') { setPwaInstalled(true); setInstallEvent(null) }
                    }}
                    className="btn-primary w-full"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" /> Install on this device
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-stone-600 dark:text-stone-400">
                    Add MacroFit to your home screen for quick access.
                  </p>
                  <ul className="list-inside list-disc space-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <li><strong className="font-semibold text-stone-700 dark:text-stone-300">Chrome / Android:</strong> tap the ⋮ menu → "Add to Home screen"</li>
                    <li><strong className="font-semibold text-stone-700 dark:text-stone-300">Safari / iOS:</strong> tap the share icon → "Add to Home Screen"</li>
                    <li><strong className="font-semibold text-stone-700 dark:text-stone-300">Edge / Desktop:</strong> click the install icon in the address bar</li>
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Weight log tab */}
        {activeTab === 'weight' && (
          <div className="space-y-4">
            <section className="card p-4">
              <h3 className="section-title flex items-center gap-2">
                <Scale className="h-4 w-4 text-jade-700 dark:text-jade-300" aria-hidden="true" /> Log weight
              </h3>
              <div className="flex gap-2">
                <label className="block flex-1">
                  <span className="label-text">Weight ({profile.weightUnit})</span>
                  <input
                    type="number"
                    placeholder={`Weight (${profile.weightUnit})`}
                    value={newWeight}
                    onChange={e => setNewWeight(e.target.value)}
                    className="input-field font-display tabular-nums"
                    step="0.1"
                  />
                </label>
                <label className="block w-28 shrink-0">
                  <span className="label-text">Body fat %</span>
                  <input
                    type="number"
                    placeholder="Optional"
                    value={newBodyFat}
                    onChange={e => setNewBodyFat(e.target.value)}
                    className="input-field font-display tabular-nums"
                    step="0.1" min="3" max="50"
                  />
                </label>
              </div>
              <button type="button" onClick={handleLogWeight} className="btn-primary mt-3 w-full">
                <Plus className="h-4 w-4" aria-hidden="true" /> Log weight
              </button>
            </section>

            {/* Weight history */}
            <section className="card-flush">
              <div className={LIST_HEADER}>
                <h3 className="section-title mb-0">Weight history</h3>
                {weightLog.length > 0 && (
                  <span className="pill">
                    <span className="font-display tabular-nums">{weightLog.length}</span>
                    {weightLog.length === 1 ? 'entry' : 'entries'}
                  </span>
                )}
              </div>
              {weightLog.length === 0 ? (
                <EmptyState
                  icon={Scale}
                  title="No weigh-ins yet"
                  hint="Log your weight above — the same time of day each time gives the cleanest trend line."
                />
              ) : (
                <ul>
                  {weightLog.slice(0, 20).map(entry => (
                    <li key={entry.id} className={ROW}>
                      <div className="min-w-0">
                        <p className="font-display text-lg font-semibold tabular-nums leading-tight text-stone-900 dark:text-stone-100">
                          {entry.weight}
                          <span className="ml-1 font-sans text-xs font-medium text-stone-500 dark:text-stone-400">
                            {profile.weightUnit}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                          {formatDate(entry.date)}
                          {entry.bodyFat ? (
                            <>
                              {' · '}
                              <span className="font-display tabular-nums">{entry.bodyFat}</span>% body fat
                            </>
                          ) : null}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeWeightEntry(entry.id)}
                        aria-label={`Delete weigh-in from ${formatDate(entry.date)}`}
                        className={DANGER_ICON_BUTTON}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* Body measurements tab */}
        {activeTab === 'body' && (
          <div className="space-y-4">
            <BodyMeasurementForm onSave={m => addBodyMeasurement({ ...m, date: getTodayString() })} />
            <section className="card-flush">
              <div className={LIST_HEADER}>
                <h3 className="section-title mb-0 flex items-center gap-2">
                  <Ruler className="h-4 w-4 text-jade-700 dark:text-jade-300" aria-hidden="true" /> Measurement history
                </h3>
                {bodyMeasurements.length > 0 && (
                  <span className="pill">
                    <span className="font-display tabular-nums">{bodyMeasurements.length}</span>
                    logged
                  </span>
                )}
              </div>
              {bodyMeasurements.length === 0 ? (
                <EmptyState
                  icon={Ruler}
                  title="No measurements yet"
                  hint="Tape measurements catch progress the scale misses — a waist that drops while weight holds is muscle gained."
                />
              ) : (
                <ul>
                  {bodyMeasurements.slice(0, 20).map(m => (
                    <li key={m.id} className="border-b border-stone-200 px-4 py-3 last:border-b-0 dark:border-stone-800">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{formatDate(m.date)}</p>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                            {MEASUREMENT_FIELDS.map(([key, label]) => {
                              const value = m[key]
                              if (value === undefined) return null
                              return (
                                <span key={key} className="text-sm text-stone-600 dark:text-stone-400">
                                  {label}{' '}
                                  <span className="font-display font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                    {value}
                                  </span>
                                </span>
                              )
                            })}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeBodyMeasurement(m.id)}
                          aria-label={`Delete measurements from ${formatDate(m.date)}`}
                          className={DANGER_ICON_BUTTON}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* Progress photos tab */}
        {activeTab === 'photos' && (
          <div className="space-y-4">
            <section className="card space-y-3 p-4">
              <h3 className="section-title mb-0 flex items-center gap-2">
                <Camera className="h-4 w-4 text-jade-700 dark:text-jade-300" aria-hidden="true" /> Add progress photo
              </h3>

              <div>
                <span className="label-text" id="pose-label">Pose</span>
                <div
                  role="group"
                  aria-labelledby="pose-label"
                  className="grid grid-cols-3 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-800"
                >
                  {(['front', 'side', 'back'] as PhotoPose[]).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPhotoPose(p)}
                      aria-pressed={photoPose === p}
                      className={`min-h-[44px] rounded-lg text-sm capitalize transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 ${
                        photoPose === p
                          ? 'bg-white font-semibold text-jade-700 shadow-sm dark:bg-stone-900 dark:text-jade-300 dark:shadow-none'
                          : 'font-medium text-stone-600 dark:text-stone-400'
                      }`}
                    >{p}</button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="label-text">Note</span>
                <input
                  value={photoNote}
                  onChange={e => setPhotoNote(e.target.value)}
                  placeholder="Optional note..."
                  className="input-field text-sm"
                />
              </label>

              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setPhotoUploading(true)
                  try {
                    const photoId = uuidv4()
                    const dataUrl = await compressImage(file)
                    // Try Supabase Storage first; fall back to base64 if not configured
                    const storageUrl = user
                      ? await uploadProgressPhoto(user.id, photoId, dataUrl)
                      : null
                    addProgressPhoto({
                      id: photoId,
                      date: getTodayString(),
                      dataUrl: storageUrl ?? dataUrl,
                      pose: photoPose,
                      notes: photoNote || undefined,
                    })
                    setPhotoNote('')
                  } finally {
                    setPhotoUploading(false)
                    e.target.value = ''
                  }
                }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
                className="btn-primary w-full"
              >
                {photoUploading
                  ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Uploading…</>
                  : <><Plus className="h-4 w-4" aria-hidden="true" /> Take / upload photo</>
                }
              </button>
              {progressPhotos.length >= 18 && (
                <p className={`flex items-center justify-center gap-1.5 text-xs font-semibold ${TONE_TEXT.warning}`}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Near the 20-photo limit. Remove old photos to add more.
                </p>
              )}
            </section>

            {/* Photo gallery */}
            {progressPhotos.length === 0 ? (
              <section className="card-flush">
                <EmptyState
                  icon={ImageIcon}
                  title="No progress photos yet"
                  hint="Shoot a front, side and back photo today — same light, same spot. In six weeks they will show what the scale cannot."
                />
              </section>
            ) : (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="section-title mb-0">Gallery</h3>
                  <span className="pill">
                    <span className="font-display tabular-nums">{progressPhotos.length}</span>
                    <span className="font-normal text-stone-500 dark:text-stone-400">of 20</span>
                  </span>
                </div>
                <div
                  className={`grid gap-2 ${
                    progressPhotos.length === 1 ? 'max-w-xs grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'
                  }`}
                >
                  {progressPhotos.map(p => (
                    <figure
                      key={p.id}
                      className="relative aspect-square overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-800"
                    >
                      <button
                        type="button"
                        onClick={() => setViewPhoto(p.dataUrl)}
                        aria-label={`View ${p.pose} photo from ${formatDate(p.date)}`}
                        className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-jade-500"
                      >
                        <img
                          src={p.dataUrl}
                          alt={`${p.pose} progress photo from ${formatDate(p.date)}`}
                          className="h-full w-full object-cover"
                        />
                      </button>
                      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-8">
                        <span className="text-xs font-semibold capitalize text-white">{p.pose}</span>
                        <span className="font-display text-xs tabular-nums text-white/85">{formatDate(p.date)}</span>
                      </figcaption>
                      <button
                        type="button"
                        onClick={() => {
                          removeProgressPhoto(p.id)
                          if (user) deleteProgressPhoto(user.id, p.id)
                        }}
                        aria-label={`Delete ${p.pose} photo from ${formatDate(p.date)}`}
                        className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-jade-500"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-950/60 text-white transition-colors duration-150 hover:bg-[#B91C1C]">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      </button>
                    </figure>
                  ))}
                </div>
              </section>
            )}

            {/* Full-screen photo viewer */}
            {viewPhoto && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Progress photo"
                className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/95 p-4 animate-fade-in"
                onClick={() => setViewPhoto(null)}
              >
                <img src={viewPhoto} alt="Progress photo" className="max-h-full max-w-full object-contain" />
                <button
                  type="button"
                  onClick={() => setViewPhoto(null)}
                  aria-label="Close photo"
                  style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
                  className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full bg-stone-900/80 text-stone-100 transition-colors duration-150 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Custom foods tab */}
        {activeTab === 'custom' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setShowCustomFoodForm(!showCustomFoodForm)}
              aria-expanded={showCustomFoodForm}
              className="btn-primary w-full"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Create custom food
            </button>

            {showCustomFoodForm && (
              <CustomFoodForm
                onSave={(food) => { addCustomFood(food); setShowCustomFoodForm(false) }}
                onCancel={() => setShowCustomFoodForm(false)}
              />
            )}

            <section className="card-flush">
              <div className={LIST_HEADER}>
                <h3 className="section-title mb-0 flex items-center gap-2">
                  <Utensils className="h-4 w-4 text-jade-700 dark:text-jade-300" aria-hidden="true" /> Custom foods
                </h3>
                <span className="pill">
                  <span className="font-display tabular-nums">{customFoods.length}</span>
                  saved
                </span>
              </div>
              {customFoods.length === 0 ? (
                <EmptyState
                  icon={Utensils}
                  title="No custom foods yet"
                  hint="Add the things you eat that no database gets right — your protein shake, your mum's curry — once, then log them in a tap."
                />
              ) : (
                <ul>
                  {customFoods.map(food => (
                    <li key={food.id} className={ROW}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{food.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-stone-500 dark:text-stone-400">
                          <span>
                            <span className="font-display font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                              {food.calories}
                            </span> kcal
                          </span>
                          <span>P <span className="font-display tabular-nums">{food.protein}</span>g</span>
                          <span>C <span className="font-display tabular-nums">{food.carbs}</span>g</span>
                          <span>F <span className="font-display tabular-nums">{food.fat}</span>g</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCustomFood(food.id)}
                        aria-label={`Delete custom food ${food.name}`}
                        className={DANGER_ICON_BUTTON}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* Templates tab */}
        {activeTab === 'templates' && (
          <section className="card-flush">
            <div className={LIST_HEADER}>
              <h3 className="section-title mb-0 flex items-center gap-2">
                <Bookmark className="h-4 w-4 text-jade-700 dark:text-jade-300" aria-hidden="true" /> Meal templates
              </h3>
              <span className="pill">
                <span className="font-display tabular-nums">{mealTemplates.length}</span>
                saved
              </span>
            </div>
            {mealTemplates.length === 0 ? (
              <EmptyState
                icon={Bookmark}
                title="No meal templates yet"
                hint="Templates are made in your diary: build a meal you eat often, then save it as a template. It shows up here and as a one-tap quick add at the top of the diary."
              />
            ) : (
              <ul>
                {mealTemplates.map(template => (
                  <li key={template.id} className={ROW}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{template.name}</p>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                        <span className="font-display tabular-nums">{template.entries.length}</span>
                        {template.entries.length === 1 ? ' item · ' : ' items · '}
                        <span className="font-display tabular-nums">{templateCalories(template)}</span> kcal
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteMealTemplate(template.id)}
                      aria-label={`Delete template ${template.name}`}
                      className={DANGER_ICON_BUTTON}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  )
}

/* Wrapping the control in the <label> associates the two without threading ids around. */
const FormField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="label-text">{label}</span>
    {children}
  </label>
)

const Badge: React.FC<{ label: string; emoji: string; value?: number }> = ({ label, emoji, value }) => (
  <span className="pill">
    <span aria-hidden="true">{emoji}</span>
    {value !== undefined && <span className="font-display tabular-nums">{value}</span>}
    {label}
  </span>
)

const EmptyState: React.FC<{ icon: LucideIcon; title: string; hint: string }> = ({ icon: Icon, title, hint }) => (
  <div className="px-4 py-10 text-center">
    <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-100 dark:bg-stone-800">
      <Icon className="h-5 w-5 text-stone-500 dark:text-stone-400" aria-hidden="true" />
    </span>
    <p className="font-display text-base font-semibold text-stone-900 dark:text-stone-100">{title}</p>
    <p className="mx-auto mt-1 max-w-xs text-sm text-stone-600 dark:text-stone-400">{hint}</p>
  </div>
)

const BodyMeasurementForm: React.FC<{ onSave: (m: Record<string, number | undefined>) => void }> = ({ onSave }) => {
  const [form, setForm] = useState<Record<string, string>>({})
  const n = (v: string) => v ? parseFloat(v) : undefined
  const handleSave = () => {
    const data = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, n(v)]))
    if (Object.values(data).every(v => v === undefined)) return
    onSave(data)
    setForm({})
  }
  return (
    <section className="card space-y-3 p-4">
      <h3 className="section-title mb-0 flex items-center gap-2">
        <Ruler className="h-4 w-4 text-jade-700 dark:text-jade-300" aria-hidden="true" /> Log measurements (cm)
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {MEASUREMENT_FIELDS.map(([key, label]) => (
          <label key={key} className="block">
            <span className="label-text mb-1">{label}</span>
            <input
              type="number" step="0.1" min="0"
              value={form[key] ?? ''}
              onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
              className="input-field font-display text-sm tabular-nums"
              placeholder="—"
            />
          </label>
        ))}
      </div>
      <button type="button" onClick={handleSave} className="btn-primary w-full">
        <Plus className="h-4 w-4" aria-hidden="true" /> Save measurements
      </button>
    </section>
  )
}

const CustomFoodForm: React.FC<{ onSave: (food: any) => void; onCancel: () => void }> = ({ onSave, onCancel }) => {
  const [form, setForm] = useState({
    name: '', servingSize: 100, servingUnit: 'g', calories: 0,
    protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0,
    sodium: 0, potassium: 0, cholesterol: 0, saturatedFat: 0, transFat: 0,
    vitaminA: 0, vitaminC: 0, calcium: 0, iron: 0,
    category: 'Custom' as const,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return
    onSave(form)
  }

  const f = (key: string, label: string, type = 'number') => (
    <label className="block">
      <span className="label-text mb-1">{label}</span>
      <input
        type={type}
        value={(form as any)[key]}
        onChange={e => setForm(p => ({ ...p, [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
        className={`input-field text-sm ${type === 'number' ? 'font-display tabular-nums' : ''}`}
        step={type === 'number' ? '0.1' : undefined}
        required={key === 'name'}
      />
    </label>
  )

  return (
    <form onSubmit={handleSubmit} className="card space-y-3 p-4">
      <h3 className="section-title mb-0">New custom food</h3>
      {f('name', 'Food name *', 'text')}
      <div className="grid grid-cols-2 gap-3">
        {f('servingSize', 'Serving size')}
        {f('servingUnit', 'Unit (g, ml, oz...)', 'text')}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {f('calories', 'Calories (kcal)')}
        {f('protein', 'Protein (g)')}
        {f('carbs', 'Carbs (g)')}
        {f('fat', 'Fat (g)')}
        {f('fiber', 'Fiber (g)')}
        {f('sugar', 'Sugar (g)')}
        {f('sodium', 'Sodium (mg)')}
        {f('potassium', 'Potassium (mg)')}
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1">Save food</button>
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
      </div>
    </form>
  )
}
