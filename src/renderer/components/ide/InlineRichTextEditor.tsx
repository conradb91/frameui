import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import { applyTextStyle, normalizeTextRuns, restoreTextRange, textRangeWithin, textSegments } from '@core/visual/richText'
import type { TextStyleRun } from '@shared/types/richText'

export interface InlineRichTextEditorHandle {
  applyTextStyle: (style: Pick<TextStyleRun, 'fontWeight' | 'color'>) => boolean
}

export const InlineRichTextEditor = forwardRef<InlineRichTextEditorHandle, {
  text: string
  textRuns?: TextStyleRun[]
  style: CSSProperties
  className: string
  shellStyle?: CSSProperties
  onCommit: (text: string, runs: TextStyleRun[]) => void
  onCancel: () => void
}>(function InlineRichTextEditor({
  text,
  textRuns,
  style,
  className,
  shellStyle,
  onCommit,
  onCancel,
}, forwardedRef) {
  const shell = useRef<HTMLDivElement>(null)
  const element = useRef<HTMLDivElement>(null)
  const draft = useRef(text)
  const savedSelection = useRef({ start: 0, end: text.length })
  const restoreSelection = useRef<{ start: number; end: number } | null>(null)
  const finished = useRef(false)
  const [runs, setRuns] = useState(() => normalizeTextRuns(text, textRuns))

  const finish = (cancel = false) => {
    if (finished.current) return
    finished.current = true
    if (cancel) onCancel()
    else onCommit(draft.current.replace(/\n$/, ''), normalizeTextRuns(draft.current.replace(/\n$/, ''), runs))
  }

  function rememberSelection() {
    const selection = window.getSelection()
    if (!element.current || !selection?.rangeCount) return
    const offsets = textRangeWithin(element.current, selection.getRangeAt(0))
    if (offsets) savedSelection.current = offsets
  }

  function apply(stylePatch: Pick<TextStyleRun, 'fontWeight' | 'color'>): boolean {
    rememberSelection()
    const selected = savedSelection.current
    if (selected.start === selected.end) return false
    restoreSelection.current = selected
    setRuns((current) => applyTextStyle(draft.current, current, selected.start, selected.end, stylePatch))
    return true
  }

  useImperativeHandle(forwardedRef, () => ({ applyTextStyle: apply }))

  useEffect(() => {
    const node = element.current
    if (!node) return
    // React deliberately renders no children inside contentEditable. The
    // browser owns typing mutations; we only rebuild safe text/span nodes
    // when a formatting command changes the run model.
    node.replaceChildren(...textSegments(draft.current, runs).map((segment) => {
      if (!segment.fontWeight && !segment.color) return document.createTextNode(segment.text)
      const span = document.createElement('span')
      span.textContent = segment.text
      if (segment.fontWeight) span.style.fontWeight = segment.fontWeight
      if (segment.color) span.style.color = segment.color
      return span
    }))
    const selected = restoreSelection.current ?? { start: 0, end: draft.current.length }
    restoreSelection.current = null
    node.focus()
    restoreTextRange(node, selected.start, selected.end)
  }, [runs])

  useEffect(() => {
    const finishOutside = (event: PointerEvent) => {
      // Wheel/trackpad gestures and synthetic hover pointers must never
      // commit the draft. Only a real primary-button press outside does.
      if (!event.isPrimary || event.button !== 0 || event.buttons !== 1) return
      const target = event.target as Element
      // Inspector fields format the current text selection. Keep the editor
      // and its saved DOM range alive while the user works in that panel.
      if (target.closest?.('.ide-inspector')) return
      if (shell.current && !shell.current.contains(target)) finish()
    }
    document.addEventListener('pointerdown', finishOutside, true)
    return () => document.removeEventListener('pointerdown', finishOutside, true)
  })

  return (
    <div className="ide-rich-text-shell" ref={shell} style={shellStyle}>
      <div
        ref={element}
        className={className}
        style={style}
        role="textbox"
        aria-label="Edit text"
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => { draft.current = event.currentTarget.innerText }}
        onPointerUp={rememberSelection}
        onKeyUp={rememberSelection}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') { event.preventDefault(); finish(true) }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish() }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
            event.preventDefault()
            rememberSelection()
            const selected = savedSelection.current
            const baseWeight = String(style.fontWeight ?? '400')
            const selectedSegments = textSegments(draft.current, runs, selected.start, selected.end)
            const isBold = selectedSegments.length > 0 && selectedSegments.every((segment) => Number(segment.fontWeight ?? baseWeight) >= 600)
            apply({ fontWeight: isBold ? '400' : '700' })
          }
        }}
      />
    </div>
  )
})
