import { create } from 'zustand'

type Theme = 'dark' | 'light' | 'system'
const THEME_KEY = 'fireai.theme'

function readTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1917' : '#faf9f7')
}

interface UiState {
  theme: Theme
  setTheme: (t: Theme) => void
}

export const useUi = create<UiState>((set) => ({
  theme: readTheme(),
  setTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
    applyTheme(theme)
    set({ theme })
  },
}))
