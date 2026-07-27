# MacroFit — Design System

**This file is authoritative.** Every UI change must build against these tokens.
Do not invent colors, fonts, spacing, or component classes. If something is missing
here, use the nearest token rather than adding a one-off value.

Direction: **warm editorial athletic**. Warm stone neutrals (never cold `gray-*`),
one confident jade brand, serif display numerals against a clean sans UI. The old
`#22c55e` neon-green-on-cold-gray look is being removed deliberately — it is the
default aesthetic of every generated fitness app.

---

## 1. Typography

Self-hosted via `@fontsource-variable/*` so the PWA works offline. Imported once in
`src/main.tsx`. Never load fonts from a CDN — the service worker cannot cache a
cross-origin font reliably and a strict CSP would block it.

| Role | Family | Tailwind class | Usage |
|---|---|---|---|
| Display | `Fraunces Variable` | `font-display` | Hero numerals, page titles, stat values, section headers |
| UI / body | `Figtree Variable` | `font-sans` | Everything else: labels, buttons, inputs, nav, body copy |

Rules:
- **Every number the user reads as data wears `font-display`** — calorie totals, macro
  grams, weight, set/rep counts, streak counts. This is the single strongest visual
  signature of the app. Add `tabular-nums` on anything that updates live or sits in a
  column, so digits do not jitter.
- Fraunces is a variable font with an optical-size axis. Use it at **600–700 weight**
  for numerals and titles. Do not use it below 14px.
- Body copy stays Figtree at 400/500. Labels and buttons at 500/600.
- Never use `Inter`, `Roboto`, `Arial`, or a raw system stack.

## 2. Color

### Neutrals — warm stone only

Use Tailwind's built-in `stone-*` scale. **Do not use `gray-*`, `slate-*`, or `zinc-*`
anywhere.** Replacing `gray-` with `stone-` is a required part of every file touched.

| Surface | Light | Dark |
|---|---|---|
| Page background | `stone-50` `#FAFAF9` | `stone-950` `#0C0A09` |
| Card / raised surface | `white` | `stone-900` `#1C1917` |
| Border / hairline | `stone-200` | `stone-800` |
| Primary text | `stone-900` | `stone-100` |
| Secondary text | `stone-600` | `stone-400` |
| Muted / hint text | `stone-500` | `stone-500` |

### Brand — jade

```
jade-50  #EDFAF5   jade-500 #12A175
jade-100 #D3F3E6   jade-600 #0C8261   ← primary actions
jade-200 #A8E7CE   jade-700 #0B674E   ← primary text on light
jade-300 #71D5AF   jade-800 #0B5240
jade-400 #38BC8D   jade-900 #0A4335
```

Exposed as `primary-*` in `tailwind.config.js` so existing `primary-` classes keep
working, plus a `jade-*` alias.

**Hard contrast rules — these were measured, not guessed:**
- White text on `jade-500` is **3.29:1 and FAILS WCAG AA**. Primary buttons must use
  `jade-600` (4.79:1). Never put white text on `jade-500` or lighter.
- Brand-colored text on a light surface: `jade-600` minimum (4.59:1), prefer `jade-700`.
- Brand-colored text on a dark surface: `jade-400` or `jade-300`.

### Macro categorical colors

Validated with the dataviz palette validator under `--pairs all` in **both** modes:
lightness band, chroma floor, CVD separation, normal-vision floor, and contrast vs
surface all PASS. **Do not substitute these values or re-order them by rank.**

| Macro | Light mode | Dark mode |
|---|---|---|
| Protein | `#168BE1` | `#2F9AF2` |
| Carbs | `#C97004` | `#DD7610` |
| Fat | `#9B204A` | `#DA5F8B` |
| Fiber | `#924BAC` | `#9851B2` |

Exposed as CSS custom properties so a single mark works in both themes:

```css
--macro-protein / --macro-carbs / --macro-fat / --macro-fiber
```

…redefined under `.dark`. Tailwind maps them to `text-macro-protein`,
`bg-macro-protein`, etc. **Charts and rings must read the CSS variable**, never a
hardcoded hex, or dark mode silently keeps the light values.

Rules that come with this palette:
- Color follows the macro, always. Protein is blue in every chart, forever. Never
  recolor by rank, sort order, or series count.
- **Sugar and sodium are NOT in the categorical palette.** They render as neutral
  `stone` bars with direct labels. Do not invent a 5th and 6th hue — a cycled palette
  breaks the CVD guarantee.
- For 2+ series a legend is always present, and with ≤4 series marks are also directly
  labeled. Identity is never carried by color alone.

### Status colors

Reserved. Never reused as a chart series.

| State | Light | Dark |
|---|---|---|
| Good / under budget | `jade-600` | `jade-400` |
| Warning / near limit | `#B45309` | `#F59E0B` |
| Over / critical | `#B91C1C` | `#F87171` |

Always ship status with an icon **and** a text label, never color alone.

## 3. Shape, depth, motion

- Radii: cards `rounded-2xl`, controls/buttons/inputs `rounded-xl`, pills `rounded-full`.
- Depth comes from a **hairline border + a very soft shadow**, not a heavy drop shadow.
  Light: `border-stone-200` + `shadow-sm`. Dark: `border-stone-800`, no shadow (shadows
  are invisible on dark; use the border and a lighter surface instead).
- Motion: 150ms for hover/press, 300ms for enter, 600ms for progress-bar fills. Respect
  `prefers-reduced-motion` — wrap non-essential animation in that media query.
- Touch targets ≥44px. This is a mobile-first PWA.

## 4. Component classes

Defined once in `src/index.css` under `@layer components`. Use these instead of
repeating utility strings:

`.card` · `.card-flush` · `.btn-primary` · `.btn-secondary` · `.btn-ghost` ·
`.btn-icon` · `.input-field` · `.label-text` · `.stat-value` · `.stat-label` ·
`.pill` · `.page-container` · `.section-title`

If a pattern appears three times, it belongs here.

## 5. Layout

- `.page-container` — `max-w-2xl`, centered, `px-4`, top padding, and bottom padding
  that clears the bottom nav.
- Mobile-first. The bottom nav is the primary navigation and must clear the iOS home
  indicator via `env(safe-area-inset-bottom)`.
- Content is glanceable: the most important number on any screen is the largest thing
  on it, in `font-display`.

## 6. Accessibility floor

- Body text ≥4.5:1, large text ≥3:1. Verified values are in §2.
- Every icon-only control needs `aria-label`.
- Visible `focus-visible` ring on every interactive element — `ring-2 ring-jade-500
  ring-offset-2` with a mode-appropriate offset color.
- Charts ship a legend and direct labels; never color alone.
