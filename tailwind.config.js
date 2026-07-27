/** @type {import('tailwindcss').Config} */

// Brand scale — see docs/DESIGN-SYSTEM.md §2. Do not invent values.
const jade = {
  50: '#EDFAF5',
  100: '#D3F3E6',
  200: '#A8E7CE',
  300: '#71D5AF',
  400: '#38BC8D',
  500: '#12A175',
  600: '#0C8261',
  700: '#0B674E',
  800: '#0B5240',
  900: '#0A4335',
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // `primary-*` is kept as an alias so existing markup keeps working.
        primary: jade,
        jade,
        // Macro categorical palette resolves through CSS custom properties so a
        // single class is correct in both light and dark mode.
        macro: {
          protein: 'var(--macro-protein)',
          carbs: 'var(--macro-carbs)',
          fat: 'var(--macro-fat)',
          fiber: 'var(--macro-fiber)',
        },
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
        sans: ['"Figtree Variable"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-soft': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}
