import { findNode } from '@core/design-model/tree'
import { useEffect, useMemo, useRef } from 'react'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { ProjectVisuals } from '@shared/types/projectVisuals'
import { projectDocument } from '../../lib/projectSurface'
import { useDesignStore } from '../../state/designStore'

export function ProjectDesignSurface({ tree, visuals, breakpoint, maxWidth, active, onActivate, onInsert }: { tree: DesignNode; visuals: ProjectVisuals; breakpoint: Breakpoint; maxWidth?: number; active: boolean; onActivate: () => void; onInsert: (id: string) => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const selected = useDesignStore((s) => s.selectedId)
  const document = useMemo(() => projectDocument(tree, visuals, breakpoint, maxWidth), [tree, visuals, breakpoint, maxWidth])
  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    let cleanup = () => {}
    function bind() {
      cleanup()
      const doc = frame?.contentDocument
      if (!doc) return
      const selectedElement = active && selected ? doc.querySelector<HTMLElement>(`[data-frameui-node="${CSS.escape(selected)}"]`) : null
      doc.querySelectorAll('[data-frameui-selected]').forEach((el) => el.removeAttribute('data-frameui-selected'))
      selectedElement?.setAttribute('data-frameui-selected', '')
      let dragging = false
      let stopDrag = () => {}
      const click = (e: MouseEvent) => {
        if (dragging) { e.preventDefault(); return }
        if (!active) { e.preventDefault(); onActivate(); return }
        e.preventDefault(); e.stopPropagation(); onActivate()
        const element = (e.target as Element).closest('[data-frameui-node]')
        const id = element?.getAttribute('data-frameui-node')
        if (id) useDesignStore.getState().select(id, { additive: e.shiftKey || e.metaKey || e.ctrlKey })
      }
      const pointer = (e: PointerEvent) => {
        if (!active || e.button !== 0) return
        const el = (e.target as Element).closest<HTMLElement>('[data-frameui-node]')
        const id = el?.getAttribute('data-frameui-node')
        if (!id || !el) return
        const node = findNode(tree, id)
        if (!node || node.locked || node.id === tree.id) return
        const x = e.clientX, y = e.clientY
        const original = el.getAttribute('style') ?? ''
        const left = node.style?.left ?? 0, top = node.style?.top ?? 0
        const move = (event: PointerEvent) => {
          if (Math.hypot(event.clientX - x, event.clientY - y) < 4 && !dragging) return
          dragging = true; event.preventDefault()
          el.style.position = 'relative'; el.style.left = `${left + event.clientX - x}px`; el.style.top = `${top + event.clientY - y}px`
        }
        const up = (event: PointerEvent) => {
          stopDrag()
          if (dragging) {
            useDesignStore.getState().select(id)
            useDesignStore.getState().dispatch({ type: 'SetStyle', nodeId: id, style: { position: 'relative', left: left + event.clientX - x, top: top + event.clientY - y } })
          }
        }
        stopDrag = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); el.setAttribute('style', original) }
        doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up, { once: true })
      }
      const keyUp = (e: KeyboardEvent) => { if (e.code === 'Space') window.dispatchEvent(new KeyboardEvent('keyup', { key: e.key, code: e.code })) }
      const key = (e: KeyboardEvent) => {
        if (e.target instanceof Element && e.target.matches('input,textarea,select,[contenteditable]')) return
        if (['Backspace', 'Delete', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.metaKey || e.ctrlKey) { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })) }
      }
      const over = (e: DragEvent) => e.preventDefault()
      const drop = (e: DragEvent) => { e.preventDefault(); const id = e.dataTransfer?.getData('application/x-frameui-component'); if (id) onInsert(id) }
      doc.addEventListener('pointerdown', pointer); doc.addEventListener('keydown', key); doc.addEventListener('keyup', keyUp);
      doc.addEventListener('click', click); doc.addEventListener('dragover', over); doc.addEventListener('drop', drop)
      cleanup = () => { stopDrag(); doc.removeEventListener('pointerdown', pointer); doc.removeEventListener('keydown', key); doc.removeEventListener('keyup', keyUp); doc.removeEventListener('click', click); doc.removeEventListener('dragover', over); doc.removeEventListener('drop', drop) }
    }
    frame.addEventListener('load', bind); bind()
    return () => { frame.removeEventListener('load', bind); cleanup() }
  }, [document, onActivate, onInsert, active, selected, tree])
  useEffect(() => {
    const doc = ref.current?.contentDocument
    doc?.querySelectorAll('[data-frameui-selected]').forEach((el) => el.removeAttribute('data-frameui-selected'))
    if (active && selected) doc?.querySelector(`[data-frameui-node="${CSS.escape(selected)}"]`)?.setAttribute('data-frameui-selected', '')
  }, [active, selected, document])
  return <iframe ref={ref} title="Editable project design" sandbox="allow-same-origin" srcDoc={document} className="h-full w-full border-0 bg-white"/>
}
