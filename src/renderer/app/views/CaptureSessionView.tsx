import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { FrameMark, ChevronRightIcon, AlertCircleIcon } from '../../components/icons/icons'
import type { FrameUiWebviewElement } from '../../types/webview'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import { CAPTURE_SCRIPT, START_JOURNEY_RECORDING_SCRIPT, STOP_JOURNEY_RECORDING_SCRIPT, TAKE_JOURNEY_RECORDING_EVENTS_SCRIPT } from '../../lib/captureScript'
import { cancelJourneyRecording, getJourneyRecordingRequest, saveRecordedJourney, type RecordedJourneyEvent } from '../../lib/journeyRecording'

type Phase = 'starting' | 'ready' | 'error'
type CaptureStatus = { kind: 'idle' } | { kind: 'capturing' } | { kind: 'done'; count: number; screenshotSaved: boolean } | { kind: 'error'; message: string }

function countElements(el: CapturedElement): number {
  return 1 + el.children.reduce((sum, child) => sum + countElements(child), 0)
}

/**
 * V2 spec §4 "Capture Session": an embedded browser so the user can sign
 * into their own running application inside FrameUI, the way they normally
 * would. FrameUI never sees or stores the password — it just renders the
 * page; the user types into it like any other login form. The session
 * (cookies) persists per-project via a dedicated partition, isolated from
 * FrameUI's own session and from every other project.
 *
 * This view only opens the browser and keeps the session alive — it does
 * not (yet) capture DOM/CSS/screenshots. That's the next slice of work.
 */
export function CaptureSessionView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const setView = useUiStore((s) => s.setView)
  const webviewRef = useRef<FrameUiWebviewElement | null>(null)

  const [phase, setPhase] = useState<Phase>('starting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [addressDraft, setAddressDraft] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>({ kind: 'idle' })
  const recordingRequest = useRef(getJourneyRecordingRequest())
  const recordedEvents = useRef<RecordedJourneyEvent[]>([])
  const [recordingCount, setRecordingCount] = useState(0)
  const [stoppingRecording, setStoppingRecording] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function ensureAppRunning() {
      const snapshot = await window.frameui.preview.getStatus()
      if (cancelled) return
      if (snapshot.status === 'running' && snapshot.url) {
        setCurrentUrl(snapshot.url)
        setPhase('ready')
        return
      }
      if (snapshot.status === 'running' && !snapshot.url) {
        return // running, just hasn't printed a URL yet — onUrlDetected below will catch it
      }
      const result = await window.frameui.preview.start()
      if (cancelled) return
      if (!result.ok && result.message && result.message !== 'Preview is already running.') {
        setPhase('error')
        setErrorMessage(result.message)
      }
    }
    void ensureAppRunning()

    const offUrl = window.frameui.preview.onUrlDetected(({ url }) => {
      setCurrentUrl(url)
      setPhase('ready')
    })
    const offStatus = window.frameui.preview.onStatus(({ status, detail }) => {
      if (status === 'error') {
        setPhase('error')
        setErrorMessage(detail ?? 'The application could not be started.')
      }
    })

    return () => {
      cancelled = true
      offUrl()
      offStatus()
    }
  }, [])

  useEffect(() => {
    if (currentUrl) setAddressDraft(currentUrl)
  }, [currentUrl])

  // Electron's <webview> fires DOM CustomEvents, not React synthetic props
  // — must be wired via addEventListener on the element itself.
  useEffect(() => {
    const el = webviewRef.current
    if (!el || phase !== 'ready') return
    const onNav = () => updateNavState()
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    return () => {
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [phase, currentUrl])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || phase !== 'ready' || !recordingRequest.current) return
    let disposed = false
    const collect = async (script = TAKE_JOURNEY_RECORDING_EVENTS_SCRIPT) => {
      try {
        const batch = (await webview.executeJavaScript(script)) as RecordedJourneyEvent[]
        if (!disposed && Array.isArray(batch) && batch.length > 0) {
          recordedEvents.current.push(...batch)
          setRecordingCount(recordedEvents.current.length)
        }
      } catch {
        // Navigations briefly destroy the guest context. The did-finish-load
        // listener below reinstalls recording in the replacement document.
      }
    }
    const install = () => { void webview.executeJavaScript(START_JOURNEY_RECORDING_SCRIPT).catch(() => undefined) }
    webview.addEventListener('did-finish-load', install)
    install()
    const timer = window.setInterval(() => { void collect() }, 500)
    return () => {
      disposed = true
      window.clearInterval(timer)
      webview.removeEventListener('did-finish-load', install)
    }
  }, [phase, currentUrl])

  function navigateTo(url: string) {
    const withScheme = /^https?:\/\//.test(url) ? url : `http://${url}`
    void webviewRef.current?.loadURL(withScheme)
  }

  function updateNavState() {
    setCanGoBack(webviewRef.current?.canGoBack() ?? false)
    setCanGoForward(webviewRef.current?.canGoForward() ?? false)
  }

  async function captureThisPage() {
    const webview = webviewRef.current
    if (!webview || !activeProject) return
    setCaptureStatus({ kind: 'capturing' })

    let root: CapturedElement
    const captureId = crypto.randomUUID()
    try {
      root = (await webview.executeJavaScript(CAPTURE_SCRIPT)) as CapturedElement
    } catch (err) {
      setCaptureStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Capture failed.' })
      return
    }

    // The screenshot step is independent — its failure must not undo or
    // fail the DOM capture above, so it gets its own try/catch.
    let screenshotFileName: string | undefined
    try {
      const image = await webview.capturePage()
      const dataUrl = image.toDataURL()
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      await window.frameui.capture.saveScreenshot(activeProject.id, captureId, base64)
      screenshotFileName = `${captureId}.png`
    } catch {
      // Screenshot is best-effort — the DOM capture below still saves.
    }

    try {
      await window.frameui.capture.save({
        id: captureId,
        projectId: activeProject.id,
        url: webview.getURL(),
        capturedAt: new Date().toISOString(),
        root,
        screenshotFileName,
      })
      setCaptureStatus({ kind: 'done', count: countElements(root), screenshotSaved: !!screenshotFileName })
    } catch (err) {
      setCaptureStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Capture failed.' })
    }
  }

  async function stopJourneyRecording() {
    const request = recordingRequest.current
    const webview = webviewRef.current
    if (!request || !webview || !activeIndex) return
    setStoppingRecording(true)
    try {
      const finalBatch = (await webview.executeJavaScript(STOP_JOURNEY_RECORDING_SCRIPT)) as RecordedJourneyEvent[]
      if (Array.isArray(finalBatch)) recordedEvents.current.push(...finalBatch)
    } catch {
      // A navigation can be between documents; events already collected are
      // still a valid partial recording and are converted below.
    }
    try {
      await saveRecordedJourney(request, recordedEvents.current, activeIndex.projectModel)
      setView('feature-workspace')
    } finally {
      setStoppingRecording(false)
    }
  }

  function leaveCaptureSession() {
    if (recordingRequest.current) cancelJourneyRecording()
    setView(recordingRequest.current ? 'feature-workspace' : 'workspace')
  }

  if (!activeProject) return null

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-bg-raised px-3.5">
        <button type="button" onClick={leaveCaptureSession} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover">
          <ChevronRightIcon className="h-3.5 w-3.5 rotate-180 text-text-2" />
        </button>
        <FrameMark className="h-3 w-3 text-accent-2" />
        <span className="font-mono text-[12px] text-text-3">{activeProject.name}</span>
        <ChevronRightIcon className="h-2.5 w-2.5 text-text-3" />
        <span className="text-[12.5px] font-semibold text-text">{recordingRequest.current ? 'Record Journey' : 'Capture Session'}</span>

        {phase === 'ready' && !recordingRequest.current && (
          <div className="ml-4 flex flex-1 items-center gap-1.5">
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => webviewRef.current?.goBack()}
              className="rounded px-1.5 py-1 text-text-2 hover:text-text disabled:opacity-30"
              title="Back"
            >
              ←
            </button>
            <button
              type="button"
              disabled={!canGoForward}
              onClick={() => webviewRef.current?.goForward()}
              className="rounded px-1.5 py-1 text-text-2 hover:text-text disabled:opacity-30"
              title="Forward"
            >
              →
            </button>
            <button type="button" onClick={() => webviewRef.current?.reload()} className="rounded px-1.5 py-1 text-text-2 hover:text-text" title="Reload">
              ⟳
            </button>
            <input
              value={addressDraft}
              onChange={(e) => setAddressDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigateTo(addressDraft)
              }}
              className="flex-1 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-[12px] text-text-2 outline-none focus:border-accent-2"
            />
          </div>
        )}

        {phase === 'ready' && recordingRequest.current && (
          <div className="ml-2 flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-danger"><span className="h-2 w-2 animate-pulse rounded-full bg-danger" /> Recording · {recordingCount} events</span>
            <button type="button" onClick={() => void stopJourneyRecording()} disabled={stoppingRecording || !activeIndex} className="rounded-md bg-danger px-3 py-1.5 text-[12px] font-semibold text-on-accent disabled:opacity-50">{stoppingRecording ? 'Saving…' : 'Stop Recording'}</button>
          </div>
        )}

        {phase === 'ready' && !recordingRequest.current && (
          <div className="ml-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void captureThisPage()}
              disabled={captureStatus.kind === 'capturing'}
              className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] font-medium text-text-2 hover:text-text disabled:opacity-50"
            >
              {captureStatus.kind === 'capturing' ? 'Capturing…' : 'Capture This Page'}
            </button>
            {captureStatus.kind === 'done' && (
              <span className="text-[12px] text-success">
                Captured — {captureStatus.count} elements{captureStatus.screenshotSaved ? '' : ' (screenshot failed)'}
              </span>
            )}
            {captureStatus.kind === 'error' && <span className="text-[12px] text-danger">{captureStatus.message}</span>}
          </div>
        )}

        <div className="ml-auto text-[12px] text-text-3">FrameUI never sees or stores your password.</div>
      </div>

      <div className="relative flex-1">
        {phase === 'starting' && (
          <div className="flex h-full items-center justify-center text-[12.5px] text-text-3">Starting your application…</div>
        )}
        {phase === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <AlertCircleIcon className="h-6 w-6 text-danger" />
            <div className="text-[13px] text-text">Couldn't start the application automatically.</div>
            <div className="max-w-md text-[12px] text-text-3">{errorMessage}</div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={addressDraft}
                onChange={(e) => setAddressDraft(e.target.value)}
                placeholder="http://localhost:8080"
                className="w-64 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-[12px] text-text outline-none focus:border-accent-2"
              />
              <button
                type="button"
                onClick={() => {
                  if (!addressDraft.trim()) return
                  setCurrentUrl(addressDraft.trim())
                  setPhase('ready')
                }}
                className="rounded-md border border-accent bg-accent   px-3 py-1.5 text-[12px] font-semibold text-on-accent"
              >
                Open
              </button>
            </div>
          </div>
        )}
        {phase === 'ready' && currentUrl && (
          <webview ref={webviewRef} src={currentUrl} partition={`persist:project-${activeProject.id}`} className="absolute inset-0 h-full w-full" />
        )}
      </div>
    </div>
  )
}
