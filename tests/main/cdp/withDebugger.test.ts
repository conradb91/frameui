import { describe, expect, test } from 'bun:test'
import { withDebugger } from '../../../src/main/ipc/handlers/cdp/withDebugger'

/** A plain stub of a `WebContents.debugger` — no mocking framework,
 * matching this repo's existing test style. `withDebugger` takes a plain
 * `WebContents` directly (a `BrowserWindow`'s `.webContents`, or a
 * `<webview>` guest resolved via `electron.webContents.fromId()`), so the
 * stub is shaped like one rather than like a `BrowserWindow`. */
function makeDebuggerStub() {
  let attached = false
  const calls: string[] = []
  const debuggerApi = {
    attach(version: string) {
      calls.push(`attach:${version}`)
      if (attached) throw new Error('Debugger is already attached to this target.')
      attached = true
    },
    detach() {
      calls.push('detach')
      attached = false
    },
    isAttached() {
      return attached
    },
    async sendCommand(method: string) {
      calls.push(`send:${method}`)
      return {}
    },
  }
  const contents = { debugger: debuggerApi } as unknown as import('electron').WebContents
  return { contents, calls, isAttached: () => attached }
}

describe('withDebugger', () => {
  test('attaches before running fn and detaches after it resolves', async () => {
    const { contents, calls, isAttached } = makeDebuggerStub()
    const result = await withDebugger(contents, '1.3', async (send) => {
      expect(isAttached()).toBe(true)
      await send('DOM.enable')
      return 'done'
    })
    expect(result).toBe('done')
    expect(isAttached()).toBe(false)
    expect(calls).toEqual(['attach:1.3', 'send:DOM.enable', 'detach'])
  })

  test('still detaches when fn throws, and lets the error propagate', async () => {
    const { contents, calls, isAttached } = makeDebuggerStub()
    await expect(
      withDebugger(contents, '1.3', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(isAttached()).toBe(false)
    expect(calls).toEqual(['attach:1.3', 'detach'])
  })

  test('throws before attaching again if the debugger is already attached', async () => {
    const { contents, calls } = makeDebuggerStub()
    contents.debugger.attach('1.3')
    calls.length = 0
    await expect(
      withDebugger(contents, '1.3', async () => 'unreachable'),
    ).rejects.toThrow('already attached')
    // No second attach() call was made — the guard fires before that.
    expect(calls).toEqual([])
  })
})

test('cancelling a stuck debugger command releases ownership and permits immediate recapture',async()=>{
 const {contents,isAttached}=makeDebuggerStub(),controller=new AbortController()
 const original=contents.debugger.sendCommand
 contents.debugger.sendCommand=()=>new Promise(()=>{})
 const pending=withDebugger(contents,'1.3',async send=>{await send('DOMSnapshot.captureSnapshot');return true},controller.signal)
 const started=performance.now();controller.abort(new Error('Stopped'))
 await expect(pending).rejects.toThrow('Stopped')
 expect(performance.now()-started).toBeLessThan(1000)
 expect(isAttached()).toBe(false)
 contents.debugger.sendCommand=original
 expect(await withDebugger(contents,'1.3',async send=>{await send('DOM.enable');return 'recaptured'})).toBe('recaptured')
})
