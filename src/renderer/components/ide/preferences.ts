import { useCallback, useState } from 'react'
export function useStoredValue<T>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      localStorage.setItem(key, JSON.stringify(next))
    },
    [key],
  )
  return [value, update]
}
