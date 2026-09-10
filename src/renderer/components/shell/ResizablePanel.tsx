import { useState, type ReactNode } from 'react'

export function ResizablePanel({ children, storageKey, side = 'left', defaultWidth = 248 }: { children: ReactNode; storageKey: string; side?: 'left' | 'right'; defaultWidth?: number }) {
  const [width, setWidth] = useState(() => {
    try { const saved = Number(localStorage.getItem(storageKey)); return saved >= 190 && saved <= 420 ? saved : defaultWidth } catch { return defaultWidth }
  })
  function update(value: number) {
    const next = Math.max(190, Math.min(420, value)); setWidth(next)
    try { localStorage.setItem(storageKey, String(next)) } catch { /* Keep usable in memory. */ }
  }
  return <div className={`resizable-panel panel-${side}`} style={{ width }}>{children}<div role="separator" aria-label={`Resize ${side} panel`} aria-orientation="vertical" aria-valuemin={190} aria-valuemax={420} aria-valuenow={width} tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); update(width + (e.key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1)) } }}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.startX = String(e.clientX); e.currentTarget.dataset.startWidth = String(width) }}
    onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) update(Number(e.currentTarget.dataset.startWidth) + (e.clientX - Number(e.currentTarget.dataset.startX)) * (side === 'left' ? 1 : -1)) }}
    onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}/></div>
}
