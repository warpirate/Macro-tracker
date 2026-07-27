import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { createAppState } from './appState'
import type { AppState } from './appState'

// All state logic lives in ./appState so the Expo app can share it verbatim. This file is
// the web binding: same creator, browser storage.
export type { AppState }

export const useStore = create<AppState>()(
  persist(immer(createAppState), {
    name: 'macrofit-storage',
    storage: createJSONStorage(() => localStorage),
  })
)
