import React, { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, Loader2, Bot, User, Camera, Lightbulb, Check, Utensils, Scale, Droplets } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../../store/useStore'
import { getTodayString } from '../../utils/calculations'
import { Food, FoodCategory, MealType } from '../../types'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  actions?: LoggedAction[]
}

interface LoggedAction {
  type: 'food' | 'weight' | 'water'
  label: string
  value: number
  unit: string
  macros?: { protein: number; carbs: number; fat: number }
}

// API message format for Anthropic
interface ApiMessage {
  role: 'user' | 'assistant'
  content: string
}

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1)

/* Macro colors come from the CSS variables only — never a hardcoded hex —
   so the mark stays correct in dark mode. Identity is carried by the written
   macro name as well as the color. */
const MacroChip: React.FC<{ name: string; grams: number; dotClass: string }> = ({ name, grams, dotClass }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-1.5 py-0.5">
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
    <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">{name}</span>
    <span className="font-display text-[11px] font-semibold tabular-nums text-stone-800 dark:text-stone-200">
      {Math.round(grams)}
    </span>
    <span className="text-[10px] text-stone-500 dark:text-stone-400">g</span>
  </span>
)

export const ChatInterface: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hi! I'm your nutrition assistant. Tell me what you ate, your weight, or water intake and I'll log it automatically. Try: \"I had 1 cup of oatmeal and 2 eggs for breakfast\" or \"I weighed 185 lbs this morning\".",
      timestamp: Date.now(),
    },
  ])

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const { goals, diary, currentWeightKg, profile, addFoodEntry, removeFoodEntry, addWeightEntry, addWater, updateStreak } = useStore()

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when chat opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const getTodayCalories = () => {
    const day = diary[getTodayString()]
    if (!day) return 0
    return day.entries.reduce((sum, e) => sum + e.food.calories * e.servings, 0)
  }

  const getTodayEntries = () => {
    const day = diary[getTodayString()]
    if (!day) return []
    return day.entries.map(e => ({
      id: e.id,
      name: e.food.name,
      meal: e.mealType,
      calories: e.food.calories * e.servings,
    }))
  }

  const compressToBase64 = (file: File): Promise<string> =>
    new Promise(resolve => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const max = 1024
        const scale = Math.min(max / img.width, max / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/jpeg', 0.75).split(',')[1])
      }
      img.src = url
    })

  const handlePhotoUpload = async (file: File) => {
    const userMsg: ChatMessage = { id: uuidv4(), role: 'user', text: '📷 Analyzing meal photo…', timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)
    try {
      const imageBase64 = await compressToBase64(file)
      const res = await fetch('/api/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mealType: 'unknown' }),
      })
      const data = await res.json()
      const today = getTodayString()
      const loggedActions: LoggedAction[] = []

      for (const inp of (data.foods ?? [])) {
        const food: Food = {
          id: `photo_${uuidv4()}`,
          name: inp.name,
          category: (inp.category ?? 'Custom') as FoodCategory,
          servingSize: inp.servingSize,
          servingUnit: inp.servingUnit,
          calories: inp.calories / inp.servings,
          protein:  inp.protein  / inp.servings,
          carbs:    inp.carbs    / inp.servings,
          fat:      inp.fat      / inp.servings,
          fiber:    inp.fiber    / inp.servings,
          sugar:    inp.sugar    / inp.servings,
          sodium:   inp.sodium   / inp.servings,
          potassium: 0, cholesterol: 0, saturatedFat: 0, transFat: 0,
          vitaminA: 0, vitaminC: 0, calcium: 0, iron: 0,
          isCustom: true,
        }
        addFoodEntry(today, { foodId: food.id, food, servings: inp.servings, mealType: 'Lunch' as MealType })
        loggedActions.push({
          type: 'food',
          label: inp.name,
          value: Math.round(inp.calories),
          unit: 'kcal',
          macros: { protein: inp.protein ?? 0, carbs: inp.carbs ?? 0, fat: inp.fat ?? 0 },
        })
      }
      if (loggedActions.length > 0) updateStreak()

      const text = loggedActions.length > 0
        ? `Logged ${loggedActions.length} item${loggedActions.length > 1 ? 's' : ''} from your photo.`
        : "I couldn't identify food in that photo. Try a clearer shot."

      setMessages(prev => [...prev, { id: uuidv4(), role: 'assistant', text, timestamp: Date.now(), actions: loggedActions }])
    } catch {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'assistant', text: 'Photo analysis failed. Try again.', timestamp: Date.now() }])
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: uuidv4(), role: 'user', text, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    // Build API message history (exclude welcome message, use only real conversation)
    const apiMessages: ApiMessage[] = messages
      .filter(m => m.id !== 'welcome')
      .map(m => ({ role: m.role, content: m.text }))
    apiMessages.push({ role: 'user', content: text })

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          context: {
            goals: { calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fat: goals.fat },
            todayCalories: Math.round(getTodayCalories()),
            todayEntries: getTodayEntries(),
            currentWeight: `${(currentWeightKg * (profile.weightUnit === 'lbs' ? 2.20462 : 1)).toFixed(1)} ${profile.weightUnit}`,
            weightUnit: profile.weightUnit,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')

      // Execute the actions returned by Claude
      const loggedActions: LoggedAction[] = []
      const today = getTodayString()

      for (const action of data.actions ?? []) {
        if (action.tool === 'log_food') {
          const inp = action.input as {
            name: string; meal: string; servings: number
            servingSize: number; servingUnit: string
            calories: number; protein: number; carbs: number; fat: number
            fiber: number; sugar: number; sodium: number; category: string
          }

          const food: Food = {
            id: `chat_${uuidv4()}`,
            name: inp.name,
            category: inp.category as FoodCategory,
            servingSize: inp.servingSize,
            servingUnit: inp.servingUnit,
            calories: inp.calories / inp.servings,   // per-serving values
            protein: inp.protein / inp.servings,
            carbs: inp.carbs / inp.servings,
            fat: inp.fat / inp.servings,
            fiber: inp.fiber / inp.servings,
            sugar: inp.sugar / inp.servings,
            sodium: inp.sodium / inp.servings,
            potassium: 0,
            cholesterol: 0,
            saturatedFat: 0,
            transFat: 0,
            vitaminA: 0,
            vitaminC: 0,
            calcium: 0,
            iron: 0,
            isCustom: true,
          }

          addFoodEntry(today, {
            foodId: food.id,
            food,
            servings: inp.servings,
            mealType: inp.meal as MealType,
          })

          loggedActions.push({
            type: 'food',
            label: inp.name,
            value: Math.round(inp.calories),
            unit: 'kcal',
            macros: { protein: inp.protein ?? 0, carbs: inp.carbs ?? 0, fat: inp.fat ?? 0 },
          })
        }

        if (action.tool === 'remove_food') {
          const inp = action.input as { entry_id: string }
          removeFoodEntry(today, inp.entry_id)
          // no chip shown — it's a silent correction step
        }

        if (action.tool === 'log_weight') {
          const inp = action.input as { weight: number; unit: string; bodyFat?: number }
          addWeightEntry({
            date: today,
            weight: inp.weight,
            bodyFat: inp.bodyFat,
          })
          loggedActions.push({ type: 'weight', label: 'Weight', value: inp.weight, unit: inp.unit })
        }

        if (action.tool === 'log_water') {
          const inp = action.input as { amount_ml: number }
          addWater(today, Math.round(inp.amount_ml))
          loggedActions.push({ type: 'water', label: 'Water', value: Math.round(inp.amount_ml), unit: 'ml' })
        }
      }

      if (loggedActions.length > 0) updateStreak()

      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        text: data.text || 'Done!',
        timestamp: Date.now(),
        actions: loggedActions,
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong'
      setMessages(prev => [
        ...prev,
        { id: uuidv4(), role: 'assistant', text: `Sorry, I ran into an error: ${errMsg}`, timestamp: Date.now() },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const actionIcon = (type: LoggedAction['type']): LucideIcon =>
    type === 'food' ? Utensils : type === 'weight' ? Scale : Droplets

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-jade-600 text-white shadow-lg shadow-jade-900/25 border border-jade-700 hover:bg-jade-700 active:bg-jade-800 active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:border-jade-500/40 dark:shadow-none dark:focus-visible:ring-offset-stone-950"
        aria-label={open ? 'Close nutrition assistant' : 'Open nutrition assistant'}
        aria-expanded={open}
      >
        {open ? <X className="h-6 w-6" aria-hidden="true" /> : <MessageCircle className="h-6 w-6" aria-hidden="true" />}
      </button>

      {/* Chat window */}
      {open && (
        <div
          role="dialog"
          aria-label="Nutrition assistant"
          className="card shadow-xl fixed bottom-36 right-4 z-50 w-[min(380px,calc(100vw-2rem))] h-[min(560px,calc(100vh-12rem))] flex flex-col overflow-hidden animate-slide-up"
        >
          {/* Header */}
          <div className="flex items-center gap-3 shrink-0 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-jade-100 bg-jade-50 text-jade-700 dark:border-jade-800 dark:bg-jade-900/40 dark:text-jade-300">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold tracking-tight leading-tight text-stone-900 dark:text-stone-100">
                Nutrition Assistant
              </p>
              <p className="text-[11px] leading-tight text-stone-500 dark:text-stone-400">Powered by Claude AI</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-icon ml-auto"
              aria-label="Close nutrition assistant"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto bg-stone-50 dark:bg-stone-950 px-3 py-3 space-y-3"
            aria-live="polite"
            aria-busy={loading}
          >
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar — role is carried by icon and placement, not by color alone */}
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    msg.role === 'user'
                      ? 'bg-jade-600 text-white'
                      : 'border border-jade-100 bg-jade-50 text-jade-700 dark:border-jade-800 dark:bg-jade-900/40 dark:text-jade-300'
                  }`}
                >
                  {msg.role === 'user'
                    ? <User className="h-3.5 w-3.5" aria-hidden="true" />
                    : <Bot className="h-3.5 w-3.5" aria-hidden="true" />}
                </div>

                <div className={`flex min-w-0 max-w-[85%] flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'rounded-2xl rounded-tr-md bg-jade-600 text-white'
                        : 'rounded-2xl rounded-tl-md border border-stone-200 bg-white text-stone-800 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100 dark:shadow-none'
                    }`}
                  >
                    <span className="sr-only">{msg.role === 'user' ? 'You said: ' : 'Assistant said: '}</span>
                    {msg.text}
                  </div>

                  {/* Logged-action confirmations */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="w-full space-y-1.5 rounded-xl border border-jade-200 bg-jade-50 px-2.5 py-2 dark:border-jade-900 dark:bg-jade-900/20">
                      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-jade-700 dark:text-jade-400">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Logged
                      </p>

                      {msg.actions.map((a, i) => {
                        const Icon = actionIcon(a.type)
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex items-baseline gap-2">
                              <Icon className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-stone-800 dark:text-stone-100">
                                {a.label}
                              </p>
                              <p className="shrink-0 whitespace-nowrap">
                                <span className="font-display text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                                  {formatNumber(a.value)}
                                </span>
                                <span className="ml-0.5 text-[10px] font-medium text-stone-500 dark:text-stone-400">{a.unit}</span>
                              </p>
                            </div>

                            {a.macros && (
                              <div className="flex flex-wrap gap-1 pl-5">
                                <MacroChip name="Protein" grams={a.macros.protein} dotClass="bg-macro-protein" />
                                <MacroChip name="Carbs" grams={a.macros.carbs} dotClass="bg-macro-carbs" />
                                <MacroChip name="Fat" grams={a.macros.fat} dotClass="bg-macro-fat" />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-2">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-jade-100 bg-jade-50 text-jade-700 dark:border-jade-800 dark:bg-jade-900/40 dark:text-jade-300">
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-stone-200 bg-white px-3 py-2 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:shadow-none">
                  <Loader2 className="h-4 w-4 animate-spin text-stone-400 dark:text-stone-500" aria-hidden="true" />
                  <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Thinking…</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 space-y-2 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-3">
            {/* Quick actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setInput('What should I eat to hit my remaining macros today?')}
                className="pill min-h-[44px] px-3.5 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900"
              >
                <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Suggest a meal
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { handlePhotoUpload(f) } e.target.value = '' }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={loading}
                className="pill min-h-[44px] px-3.5 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900 disabled:opacity-40 disabled:pointer-events-none"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" /> Photo
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="What did you eat? Log weight, water…"
                aria-label="Message the nutrition assistant"
                className="input-field min-w-0 flex-1 text-sm"
                disabled={loading}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="btn-primary w-11 shrink-0 px-0 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
