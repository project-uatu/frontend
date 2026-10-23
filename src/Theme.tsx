import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ThemeContext, useTheme } from './useTheme'
import type { Appearance } from './useTheme'
const query = '(prefers-color-scheme: dark)'
function subscribe(callback: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
function systemDark() { return window.matchMedia(query).matches }
function savedAppearance(): Appearance {
  try {
    const value = localStorage.getItem('uatu.appearance')
    if (value === 'light' || value === 'dark') return value
  } catch {
    console.warn('Appearance preference storage is unavailable')
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setPreference] = useState(savedAppearance)
  const prefersDark = useSyncExternalStore(subscribe, systemDark, () => false)
  const dark = appearance === 'dark' || (appearance === 'system' && prefersDark)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  function setAppearance(value: Appearance) {
    setPreference(value)
    try {
      localStorage.setItem('uatu.appearance', value)
    } catch {
      console.warn('Appearance preference could not be saved')
    }
  }
  return <ThemeContext.Provider value={{ dark, appearance, setAppearance }}>{children}</ThemeContext.Provider>
}

export function AppearanceControl() {
  const { appearance, setAppearance } = useTheme()
  const id = useId()
  return <div className="appearance-control"><label htmlFor={id}>Appearance</label>
    <select id={id} value={appearance} onChange={event => {
      const value = event.target.value
      if (value === 'system' || value === 'light' || value === 'dark') setAppearance(value)
    }}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </div>
}
