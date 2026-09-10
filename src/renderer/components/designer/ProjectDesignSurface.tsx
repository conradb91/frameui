import { findNode, findParent } from '@core/design-model/tree'
import { useEffect, useMemo, useRef } from 'react'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { ProjectVisuals } from '@shared/types/projectVisuals'
import { projectDocument } from '../../lib/projectSurface'
import { useDesignStore } from '../../state/designStore'

export function ProjectDesignSurface({ tree, visuals, breakpoint, maxWidth, active, onActivate, onInsert }: { tree: DesignNode; visuals: ProjectVisuals; breakpoint: Breakpoint; maxWidth?: number; active: boolean; onActivate: () => void; onInsert: (id: string) => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const callbacks = useRef({ onActivate, onInsert })
  callbacks.current = { onActivate, onInsert }
  const spaceHeld = useRef(false)
  const selectedIds = useDesignStore(s => s.selectedIds)
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
        if (!active) { e.preventDefault(); callbacks.current.onActivate(); return }
        e.preventDefault(); e.stopPropagation(); callbacks.current.onActivate()
        const element = (e.target as Element).closest('[data-frameui-node]')
        const id = element?.getAttribute('data-frameui-node')
        if (id) useDesignStore.getState().select(id, { additive: e.shiftKey || e.metaKey || e.ctrlKey })
      }
      const pointer = (e: PointerEvent) => {
        if (spaceHeld.current || e.button === 1) {
          e.preventDefault()
          const bounds = frame!.getBoundingClientRect()
          const scale = bounds.width / (frame!.clientWidth || bounds.width)
          const input = (event: PointerEvent) => ({ bubbles: true, cancelable: true, pointerId: event.pointerId, button: event.button, buttons: event.buttons, clientX: bounds.left + event.clientX * scale, clientY: bounds.top + event.clientY * scale })
          frame!.dispatchEvent(new PointerEvent('pointerdown', input(e)))
          const move = (event: PointerEvent) => window.dispatchEvent(new PointerEvent('pointermove', input(event)))
          const up = (event: PointerEvent) => { window.dispatchEvent(new PointerEvent('pointerup', input(event))); stopDrag() }
          stopDrag = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up) }
          doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up, { once: true })
          return
        }
        if (!active || e.button !== 0 || (e.target as Element)?.closest('[contenteditable=true]')) return
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
      const keyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { spaceHeld.current = false; window.dispatchEvent(new KeyboardEvent('keyup', { key: e.key, code: e.code })) } }
      const key = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !(e.target as Element)?.closest('[contenteditable=true],input,textarea')) spaceHeld.current = true
        if (e.key === 'Escape' && !(e.target as Element)?.closest('[contenteditable=true]')) { e.preventDefault(); const current = useDesignStore.getState().selectedId; useDesignStore.getState().select(current ? findParent(tree, current)?.parent.id ?? null : null); return }
        if (e.key === 'Tab') { e.preventDefault(); const ids = [...doc.querySelectorAll('[data-frameui-node]')].map(el => el.getAttribute('data-frameui-node')!); const current = ids.indexOf(useDesignStore.getState().selectedId ?? ''); useDesignStore.getState().select(ids[(current + (e.shiftKey ? -1 : 1) + ids.length) % ids.length] ?? null); return }
        if ((e.target as Element | null)?.closest?.('input,textarea,select,[contenteditable=true]')) return
        if (['Backspace', 'Delete', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 't', 'T', 'f', 'F', 'v', 'V', 'Escape'].includes(e.key) || e.metaKey || e.ctrlKey) { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })) }
      }
      const wheel = (e: WheelEvent) => {
        e.preventDefault()
        const bounds = frame!.getBoundingClientRect()
        const scale = bounds.width / (frame!.clientWidth || bounds.width)
        frame!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, metaKey: e.metaKey, clientX: bounds.left + e.clientX * scale, clientY: bounds.top + e.clientY * scale }))
      }
      const doubleClick = (e: MouseEvent) => {
        const el = (e.target as Element).closest<HTMLElement>('[data-frameui-node]')
        const id = el?.getAttribute('data-frameui-node')
        const node = id ? findNode(tree, id) : null
        if (!active || !el || !id || !node || (node.kind !== 'text' && !(node.kind === 'placeholder' && !node.children.length)) || node.locked) return
        e.preventDefault(); e.stopPropagation()
        el.contentEditable = 'true'; el.focus()
        const original = node.kind === 'text' ? node.content : 'textPreview' in node ? node.textPreview ?? '' : ''
        const finish = (save: boolean) => {
          const content = el.textContent ?? ''
          el.removeAttribute('contenteditable'); el.removeEventListener('keydown', editingKey); el.removeEventListener('blur', blur)
          if (save && content !== original) useDesignStore.getState().dispatch({ type: 'SetText', nodeId: id, content })
          else if (!save) el.textContent = original
        }
        const editingKey = (event: KeyboardEvent) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finish(false) } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true) } }
        const blur = () => finish(true)
        el.addEventListener('keydown', editingKey); el.addEventListener('blur', blur, { once: true })
      }
      doc.addEventListener('wheel', wheel, { passive: false }); doc.addEventListener('dblclick', doubleClick)
      const over = (e: DragEvent) => e.preventDefault()
      const drop = (e: DragEvent) => { e.preventDefault(); const id = e.dataTransfer?.getData('application/x-frameui-component'); if (id) callbacks.current.onInsert(id) }
      doc.addEventListener('pointerdown', pointer); doc.addEventListener('keydown', key); doc.addEventListener('keyup', keyUp);
      doc.addEventListener('click', click); doc.addEventListener('dragover', over); doc.addEventListener('drop', drop)
      cleanup = () => { stopDrag(); doc.removeEventListener('wheel', wheel); doc.removeEventListener('dblclick', doubleClick); doc.removeEventListener('pointerdown', pointer); doc.removeEventListener('keydown', key); doc.removeEventListener('keyup', keyUp); doc.removeEventListener('click', click); doc.removeEventListener('dragover', over); doc.removeEventListener('drop', drop) }
    }
    frame.addEventListener('load', bind); bind()
    return () => { frame.removeEventListener('load', bind); cleanup() }
  }, [document, active, selected, tree])
  useEffect(() => {
    const doc = ref.current?.contentDocument
    doc?.querySelectorAll('[data-frameui-selected]').forEach((el) => el.removeAttribute('data-frameui-selected'))
    if (active) for (const id of selectedIds) doc?.querySelector(`[data-frameui-node="${CSS.escape(id)}"]`)?.setAttribute('data-frameui-selected', '')
  }, [active, selectedIds, document])
  return <iframe ref={ref} title="Editable project design" sandbox="allow-same-origin" srcDoc={document} className="h-full w-full border-0 bg-artboard"/>
}
