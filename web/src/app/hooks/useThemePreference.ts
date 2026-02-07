import { createEffect, createMemo, createSignal } from 'solid-js'

export type ThemePreference = 'system' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'alloy.theme'

function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    // ignore
  }
  return 'system'
}

function readSystemPrefersDark(): boolean {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function useThemePreference() {
  const [themePref, setThemePref] = createSignal<ThemePreference>(readThemePreference())
  const [systemPrefersDark, setSystemPrefersDark] = createSignal<boolean>(readSystemPrefersDark())

  createEffect(() => {
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mql) return

    const onChange = (ev: MediaQueryListEvent) => setSystemPrefersDark(ev.matches)
    setSystemPrefersDark(mql.matches)

    try {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    } catch {
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    }
  })

  const theme = createMemo<'light' | 'dark'>(() => {
    const pref = themePref()
    if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light'
    return pref
  })

  const themeButtonTitle = createMemo(() => {
    const pref = themePref()
    const applied = theme()
    const appliedLabel = applied === 'dark' ? 'Dark' : 'Light'
    const current = pref === 'system' ? `System (${appliedLabel})` : pref === 'dark' ? 'Dark' : 'Light'
    const next = pref === 'system' ? 'Light' : pref === 'light' ? 'Dark' : 'System'
    return `Theme: ${current}. Click to switch to ${next}.`
  })

  createEffect(() => {
    document.documentElement.classList.toggle('dark', theme() === 'dark')
  })

  createEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePref())
    } catch {
      // ignore
    }
  })

  return {
    themePref,
    setThemePref,
    themeButtonTitle,
  }
}
