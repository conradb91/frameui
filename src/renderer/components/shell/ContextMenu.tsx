import { useEffect, useRef } from 'react'
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; action: () => void; disabled?: boolean }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [onClose])
  return <div ref={ref} role="menu" aria-label="Screen actions" className="fixed z-[100] w-44 rounded border border-border-strong bg-panel p-1 shadow-sm" style={{ left: Math.min(x, window.innerWidth - 184), top: Math.min(y, window.innerHeight - items.length * 30 - 16) }} onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
      event.preventDefault()
      const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
  }}>{items.map(item => <button key={item.label} role="menuitem" disabled={item.disabled} className="block h-7 w-full rounded px-2 text-left text-xs text-text hover:bg-hover focus:bg-hover disabled:opacity-40" onClick={() => { item.action(); onClose() }}>{item.label}</button>)}</div>
}
