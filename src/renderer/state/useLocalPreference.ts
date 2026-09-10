import { useEffect, useState } from 'react'

/** Call from a component keyed to the document owning the preference. */
export function useLocalPreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); if (raw === null) return fallback; const saved: unknown = JSON.parse(raw); return typeof saved === typeof fallback ? saved as T : fallback } catch { return fallback }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Preferences remain usable in memory. */ } }, [key, value])
  return [value, setValue] as const
}
