import type { WebContents } from 'electron'
import type { VisualObject } from '@shared/types/visualDesign'
import { cloneObject, visit } from '@core/visual/model'
import { normalizeVisual } from '@core/visual/normalize'
import { CAPTURE_SCRIPT } from '../../../renderer/lib/captureScript'
import { withDebugger } from './cdp/withDebugger'

/** Chromium forces CSS states without dispatching focus, click or application
 * events. Takes a plain `WebContents` rather than a `BrowserWindow` — a
 * `<webview>` guest resolved via `electron.webContents.fromId()` (the live
 * capture path) is a `WebContents`, not a `BrowserWindow`, and this only
 * ever touches `.debugger`/`.insertCSS`/`.executeJavaScript`, all of which
 * a `BrowserWindow`'s `webContents` also exposes identically — callers with
 * a `BrowserWindow` just pass `win.webContents`. */
export async function captureVisualStates(
  contents: WebContents,
  objects: VisualObject[],
) {
  const controls: VisualObject[] = []
  visit(objects, (o) => {
    if (
      o.source?.selector &&
      ['Button', 'Input', 'Select', 'Checkbox', 'Radio', 'Toggle'].includes(
        o.kind,
      ) &&
      o.variant?.State !== 'Disabled'
    )
      controls.push(o)
  })
  if (!controls.length) return
  let styleKey: string | undefined
  try {
    styleKey = await contents.insertCSS(
      '* { transition: none !important; animation: none !important; }',
    )
    await withDebugger(contents, '1.3', async (send) => {
      await send('DOM.enable')
      await send('CSS.enable')
      const { root } = await send<{ root: { nodeId: number } }>('DOM.getDocument')
      for (const control of controls.slice(0, 24)) {
        const { nodeId } = await send<{ nodeId: number }>('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: control.source!.selector,
        })
        if (!nodeId) continue
        const script = CAPTURE_SCRIPT.replace(
          'var captured = convert(document.body, 1)',
          `var captured = convert(document.querySelector(${JSON.stringify(control.source!.selector)}), 1)`,
        ).replace(
          'if (captured) { captured.rect.height = Math.max(captured.rect.height, innerHeight); captured.rect.width = Math.max(captured.rect.width, innerWidth) }',
          '',
        )
        const base = cloneObject(control)
        base.variants = undefined
        const variants: NonNullable<VisualObject['variants']> = [
          {
            id: crypto.randomUUID(),
            name: 'Normal',
            properties: { State: 'Normal' },
            objects: [base],
          },
        ]
        try {
          for (const state of ['hover', 'focus', 'active']) {
            await send('CSS.forcePseudoState', {
              nodeId,
              forcedPseudoClasses:
                state === 'active' ? ['hover', 'active'] : [state],
            })
            const captured = await contents.executeJavaScript(script)
            const [variant] = normalizeVisual(captured, control.source)
            if (!variant) continue
            const name =
              state === 'active'
                ? 'Active'
                : state[0].toUpperCase() + state.slice(1)
            variants.push({
              id: crypto.randomUUID(),
              name,
              properties: { State: name },
              objects: [variant],
            })
          }
        } finally {
          await send('CSS.forcePseudoState', {
            nodeId,
            forcedPseudoClasses: [],
          })
        }
        if (variants.length > 1) control.variants = variants
      }
    })
  } catch {
    /* A missing CSS debugger domain must not lose the verified default design. */
  } finally {
    if (styleKey && !contents.isDestroyed())
      await contents.removeInsertedCSS(styleKey)
  }
}
