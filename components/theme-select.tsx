'use client'

import { useTheme } from './theme-provider'

export default function ThemeSelect() {
  const { theme, setTheme } = useTheme()
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span>Theme</span>
      <select
        value={theme}
        onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
        aria-label="Theme"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  )
}
