import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

type Camera = { x: number; y: number; zoom: number }
type Update = Camera | ((camera: Camera) => Camera)

/** Navigation paints once per display frame without reconciling the editor.
 * Commit the final camera before editing so hit testing uses identical coordinates. */
export function useCanvasCamera(initial: Camera) {
  const [camera, commit] = useState(initial)
  const current = useRef(initial)
  const cameraGroup = useRef<SVGGElement>(null)
  const cameraOverlay = useRef<SVGGElement>(null)
  const frame = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const pending = useRef(false)
  const paint = useCallback(() => {
    frame.current = 0
    const c = current.current
    const transform = `translate(${c.x} ${c.y}) scale(${c.zoom})`
    cameraGroup.current?.setAttribute('transform', transform)
    cameraOverlay.current?.setAttribute('transform', transform)
  }, [])
  const finishCamera = useCallback(() => {
    if (!pending.current) return
    pending.current = false
    clearTimeout(timer.current)
    cancelAnimationFrame(frame.current)
    paint()
    flushSync(() => commit(current.current))
    cameraGroup.current?.closest('.ide-stage')?.classList.remove('ide-navigating')
  }, [paint])
  const setCamera = useCallback((update: Update) => {
    clearTimeout(timer.current)
    cancelAnimationFrame(frame.current)
    frame.current = 0
    pending.current = false
    current.current = typeof update === 'function' ? update(current.current) : update
    cameraGroup.current?.closest('.ide-stage')?.classList.remove('ide-navigating')
    commit(current.current)
  }, [])
  const navigateCamera = useCallback((update: Update) => {
    current.current = typeof update === 'function' ? update(current.current) : update
    pending.current = true
    cameraGroup.current?.closest('.ide-stage')?.classList.add('ide-navigating')
    if (!frame.current) frame.current = requestAnimationFrame(paint)
    clearTimeout(timer.current)
    timer.current = setTimeout(finishCamera, 120)
  }, [finishCamera, paint])
  useLayoutEffect(() => {
    if (pending.current) {
      cancelAnimationFrame(frame.current)
      paint()
    }
  })
  useLayoutEffect(() => () => {
    clearTimeout(timer.current)
    cancelAnimationFrame(frame.current)
  }, [])
  const getCamera=useCallback(()=>current.current,[])
  return { getCamera, camera, setCamera, navigateCamera, finishCamera, cameraGroup, cameraOverlay }
}
