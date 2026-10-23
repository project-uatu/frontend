import { createContext, useContext } from 'react'

export type Appearance = 'system' | 'light' | 'dark'
export const ThemeContext = createContext({
  dark: false,
  appearance: 'system' as Appearance,
  setAppearance: (_value: Appearance) => {},
})
export function useTheme() { return useContext(ThemeContext) }
