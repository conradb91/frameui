import {connectApplication} from '../../lib/connectApplication'
import { userFacingError } from '../../lib/userFacingError'
import { RuntimeSettings } from './RuntimeSettings'
import { normalizeVisual } from '@core/visual/normalize'
import type { FrameUiWebviewElement } from '../../types/webview'
import {
  Monitor,
  Loader2,
  ArrowRight,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Pencil,
} from 'lucide-react'
import { visit } from '@core/visual/model'
import { useEffect, useRef, useState } from 'react'
import type { VisualDocument, CaptureStage } from '@shared/types/visualDesign'
import { ImportApplication } from './ImportApplication'
import { useStoredValue } from './preferences'
import { CaptureProgressModal } from './CaptureProgressModal'

type ViewportPreset = 'Desktop' | 'Tablet' | 'Mobile' | 'Custom'
const VIEWPORT_PRESETS: Record<Exclude<ViewportPreset, 'Custom'>, { width: number; height: number }> = {
  Desktop: { width: 1440, height: 1024 },
  Tablet: { width: 768, height: 1024 },
  Mobile: { width: 390, height: 844 },
}

function normalizeCaptureAddress(value?: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || /^about:blank\/?$/i.test(trimmed)) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function stateNameFromAddress(value?: string): string {
  const normalized = normalizeCaptureAddress(value)
  if (!normalized) return 'Home'
  try {
    const url = new URL(normalized)
    const segment = url.pathname.split('/').filter(Boolean).at(-1)
    return segment ? decodeURIComponent(segment).replace(/[-_]+/g, ' ').trim() || 'Home' : 'Home'
  } catch {
    return 'Home'
  }
}

function frameNameFromAddress(value?: string): string {
  return stateNameFromAddress(value).replace(/\b\w/g, (character) => character.toUpperCase())
}

function CaptureSessionTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const finish = () => {
    const next = draft.trim()
    if (next && next !== name) onRename(next)
    else setDraft(name)
    setEditing(false)
  }
  if (editing) return (
    <input
      autoFocus
      className="ide-capture-session-name-input"
      aria-label="Capture title"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish()
        if (event.key === 'Escape') { setDraft(name); setEditing(false) }
      }}
    />
  )
  return (
    <button
      type="button"
      className="ide-capture-session-name"
      aria-label={`Rename capture ${name}`}
      title="Rename capture"
      onClick={() => { setDraft(name); setEditing(true) }}
    >
      <span>{name}</span>
      <Pencil size={12} aria-hidden="true" />
    </button>
  )
}

/**
 * Capture is not a destination of its own — it's a tool reached from New
 * Design ("Capture from application") or from inside a design ("Capture
 * page"). This component is mounted on demand each time a capture session
 * is opened and unmounted on Done/Cancel; nothing forces a remount *during*
 * an open session, so the embedded `<webview>`'s live browsing session
 * (URL, viewport, captured-this-session thumbnails) survives for as long as
 * the session is open, which is all that's needed.
 *
 * The multi-route headless batch capture flow doesn't need that kind of
 * persistence (it's a one-shot bulk operation) and stays a modal, launched
 * from here via `ImportApplication`.
 */
export function CaptureWorkspace({
  document,
  onCapture,
  onDone,
  focusRoute,
}: {
  document: VisualDocument
  onCapture: (document: VisualDocument) => void
  onDone: (lastCapturedPageId?: string) => void
  /** Pre-navigates the live browser to a specific route once, e.g. "capture
   * this page" from the Pages section. */
  focusRoute?: string
  /** True when this session's document was just created via "Capture from
   * application" with no real pages yet — the first capture seeds the
   * document's name and replaces the still-blank placeholder page instead
   * of sitting alongside it. */
}) {
  const stateBrowser = useRef<FrameUiWebviewElement | null>(null)
  const viewportFrame = useRef<HTMLDivElement | null>(null)
  const initialAddress = normalizeCaptureAddress(document.appUrl)
  const requestedAddress = useRef(initialAddress)
  const stateNameEdited = useRef(false)
  const [address, setAddress] = useState(initialAddress)
  const [addressDraft, setAddressDraft] = useState(initialAddress)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [viewport, setViewport] = useState<{ preset: ViewportPreset; width: number; height: number }>({
    preset: 'Desktop',
    ...VIEWPORT_PRESETS.Desktop,
  })
  const [profile, setProfile] = useState<'standard' | 'admin' | 'super-admin'>('standard')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [stateName, setStateName] = useState(() => stateNameFromAddress(initialAddress))
  const [previewScale, setPreviewScale] = useState(1)
  const [captureStage, setCaptureStage] = useState<CaptureStage | null>(null)
  const captureCancelled = useRef(false)
  const [sessionCaptures, setSessionCaptures] = useState<{ id: string; name: string; state: string; thumbnail?: string; matchedComponents: number }[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  useEffect(()=>{if(document.appUrl)void connectApplication(document.appUrl).catch(e=>setError(userFacingError(e)))},[document.projectId,document.appUrl])
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredValue('frameui:capture-sidebar-collapsed', false)

  function renameSessionCapture(id: string, name: string) {
    setSessionCaptures((captures) => captures.map((capture) => capture.id === id ? { ...capture, name } : capture))
    onCapture({
      ...document,
      updatedAt: new Date().toISOString(),
      pages: document.pages.map((page) => page.id === id ? { ...page, name, edited: true } : page),
    })
  }

  function navigateTo(url: string) {
    const trimmed = url.trim()
    if (!trimmed) return
    const withScheme = normalizeCaptureAddress(trimmed)
    if (!withScheme) return
    requestedAddress.current = withScheme
    setAddress(withScheme)
    setAddressDraft(withScheme)
    if (!stateNameEdited.current) setStateName(stateNameFromAddress(withScheme))
    setError('')
    void connectApplication(withScheme).then(url=>stateBrowser.current?.loadURL(url)).catch(() => {
      setError(`Could not load ${withScheme}. Check the URL and that the app is running.`)
    })
  }

  // "Capture this page" elsewhere in the project (e.g. the Pages section, or
  // the in-editor "Capture page" toolbar button) requests a specific route.
  // This component is mounted fresh per session, so a mount-only effect is
  // enough — no requestId-keyed re-trigger machinery needed.
  useEffect(() => {
    if (!focusRoute) return
    const base = document.appUrl || address
    if (!base) return
    try {
      navigateTo(new URL(focusRoute, base).toString())
    } catch {
      // Not a valid combination — leave the browser where it is.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Electron's <webview> fires DOM CustomEvents, not React synthetic props
  // — must be wired via addEventListener on the element itself. Re-attached
  // whenever the webview remounts under a different session (profile change).
  useEffect(() => {
    const el = stateBrowser.current
    if (!el) return
    const onNav = () => {
      setCanGoBack(el.canGoBack())
      setCanGoForward(el.canGoForward())
      const url = el.getURL()
      // A newly mounted Electron webview can emit a transient about:blank
      // navigation before its real `src` begins loading. Never let that
      // internal page replace the saved/requested project URL.
      if (url && !/^about:blank\/?$/i.test(url)) {
        requestedAddress.current = url
        setAddress(url)
        setAddressDraft(url)
        if (!stateNameEdited.current) setStateName(stateNameFromAddress(url))
      }
    }
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    return () => {
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [profile])

  // The guest retains the selected capture dimensions; only its on-screen
  // preview is scaled so the capture workspace never gains a left-to-right
  // scrollbar on narrower windows.
  useEffect(() => {
    const frame = viewportFrame.current
    if (!frame) return
    const fit = () => {
      const availableWidth = Math.max(1, frame.clientWidth - 32)
      const availableHeight = Math.max(1, frame.clientHeight - 32)
      setPreviewScale(Math.min(1, availableWidth / viewport.width, availableHeight / viewport.height))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [viewport.width, viewport.height])

  // `src` normally starts this navigation. Explicitly enforce the intended
  // address as well because Electron may finish its initial about:blank load
  // after React has assigned the real source.
  useEffect(() => {
    const el = stateBrowser.current
    const target = requestedAddress.current
    if (!el || !target) return
    const enforceRequestedAddress = () => {
      const current = el.getURL()
      if (!current || /^about:blank\/?$/i.test(current)) {
        void el.loadURL(target).catch(() => {
          setError(`Could not load ${target}. Check the URL and that the app is running.`)
        })
      }
    }
    el.addEventListener('dom-ready', enforceRequestedAddress, { once: true })
    return () => el.removeEventListener('dom-ready', enforceRequestedAddress)
  }, [profile])

  async function signInWithCredentials() {
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setBusy('Signing in…')
    setError('')
    try {
      const auth = await window.frameui.design.login({
        url: address.trim(),
        profile,
        username: username.trim(),
        password,
      })
      setPassword('')
      setUsername('')
      if (!auth.ok) {
        setError(auth.message)
        return
      }
      stateBrowser.current?.reload()
    } catch (e) {
      setError(userFacingError(e))
    } finally {
      setBusy('')
    }
  }

  async function captureCurrentState() {
    const guest = stateBrowser.current
    if (!guest || !stateName.trim()) return
    captureCancelled.current = false
    setBusy('Capturing current state…')
    setError('')
    setCaptureStage('layout')
    const offStage = window.frameui.design.onCaptureStage(setCaptureStage)
    try {
      const {root,metadata,thumbnail,fullPageScreenshot,canvasPreview,fonts,warnings,url: capturedUrl,structured} = await window.frameui.design.captureCurrentState(guest.getWebContentsId())
      setCaptureStage('building')
      const url = new URL(capturedUrl)
      const route = url.pathname + url.search + url.hash
      const parent = document.pages.find(p => p.route === route && (p.authProfile || 'standard') === profile)
      const normalized = normalizeVisual(root, {route})
      // Best-effort: forces hover/focus/active on matched controls so a
      // real :hover state can be preserved even though clicking "Capture
      // screen" requires moving the mouse off whatever's hovered in the
      // webview. Falls back to the plain normalized tree on any failure.
      const objects = await window.frameui.design.captureLiveVisualStates(guest.getWebContentsId(), normalized).catch(() => normalized)
      let matchedComponents = 0
      visit(objects, (o) => { if (o.source?.component) matchedComponents++ })
      const capturedName = frameNameFromAddress(capturedUrl)
      const capturedState = `${metadata.width >= 1100 ? 'Desktop' : metadata.width >= 600 ? 'Tablet' : 'Mobile'} · ${stateName.trim()}`
      const newPage = {
        id: crypto.randomUUID(), name: capturedName,
        route, authProfile: profile, folder: parent?.folder || 'Application', pinned: false,
        state: capturedState,
        width: metadata.width, height: structured?.height??Math.max(1,Math.ceil(root.rect.height)), objects,
        // The real, live-canvas-rendered content — `objects` above stays
        // populated regardless (SVG export, the Layers panel, and
        // rendering any page without `structured` all still need it).
        structured,
        importedObjects: structuredClone(objects), capturedAt: new Date().toISOString(), thumbnail, fullPageScreenshot,canvasPreview, fonts, captureWarnings: warnings,
      }
      // Any untouched one-page design is still just its generated placeholder.
      // The first real capture replaces it, including when Capture page was
      // opened from the editor toolbar rather than the new-design flow.
      const isStillPlaceholder = document.pages.length === 1 && document.pages.every((p) => !p.capturedAt && p.objects.length === 0)
      onCapture({
        ...document,
        appUrl: normalizeCaptureAddress(address) || initialAddress || undefined,
        updatedAt: new Date().toISOString(),
        name: isStillPlaceholder ? capturedName : document.name,
        pages: isStillPlaceholder ? [newPage] : [...document.pages, newPage],
      })
      setSessionCaptures((prev) => [...prev, { id: newPage.id, name: capturedName, state: capturedState, thumbnail, matchedComponents }])
      setError(warnings.length ? `State captured. ${warnings.join(' ')}` : matchedComponents ? `State captured. ${matchedComponents} component${matchedComponents === 1 ? '' : 's'} matched to source.` : '')
      stateNameEdited.current = false
      setStateName(stateNameFromAddress(capturedUrl))
    } catch (e) { if (!captureCancelled.current) setError(`Could not capture this state: ${userFacingError(e)}`) }
    finally { setBusy(''); setCaptureStage(null); offStage() }
  }

  return (
    <div className="ide-capture-workspace ide-capture-shell">
    <div className="ide-capture-main">
      <div className="ide-capture-toolbar">
        <button type="button" title="Back" disabled={!canGoBack} onClick={() => stateBrowser.current?.goBack()}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" title="Forward" disabled={!canGoForward} onClick={() => stateBrowser.current?.goForward()}>
          <ChevronRight size={15} />
        </button>
        <button type="button" title="Reload" onClick={() => stateBrowser.current?.reload()}>
          <RefreshCw size={14} />
        </button>
        <input
          aria-label="Address"
          className="ide-capture-address"
          placeholder="http://localhost:3000"
          value={addressDraft}
          onChange={(e) => setAddressDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigateTo(addressDraft) }}
        />
        <button type="button" title="Go" aria-label="Go" onClick={() => navigateTo(addressDraft)}>
          <ArrowRight size={14} />
        </button>
        <div className="ide-viewport-switcher" role="group" aria-label="Viewport">
          {(['Desktop', 'Tablet', 'Mobile'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className={viewport.preset === preset ? 'selected' : ''}
              onClick={() => setViewport({ preset, ...VIEWPORT_PRESETS[preset] })}
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            className={viewport.preset === 'Custom' ? 'selected' : ''}
            onClick={() => setViewport((v) => ({ ...v, preset: 'Custom' }))}
          >
            Custom
          </button>
        </div>
        {viewport.preset === 'Custom' && (
          <div className="ide-viewport-custom">
            <input
              type="number"
              aria-label="Custom width"
              min={200}
              value={viewport.width}
              onChange={(e) => setViewport((v) => ({ ...v, width: Number(e.target.value) || v.width }))}
            />
            <span>×</span>
            <input
              type="number"
              aria-label="Custom height"
              min={200}
              value={viewport.height}
              onChange={(e) => setViewport((v) => ({ ...v, height: Number(e.target.value) || v.height }))}
            />
          </div>
        )}
      </div>
      <div className="ide-capture-viewport-frame" ref={viewportFrame}>
        <div
          className="ide-capture-viewport-scaler"
          style={{ width: viewport.width * previewScale, height: viewport.height * previewScale }}
        >
          <webview
            ref={stateBrowser}
            src={address || initialAddress || 'about:blank'}
            key={profile}
            partition={`persist:project-${document.projectId}${profile === 'standard' ? '' : `-${profile}`}`}
            className="ide-capture-webview"
            style={{
              width: viewport.width,
              height: viewport.height,
              transform: `scale(${previewScale})`,
            }}
          />
        </div>

      </div>
      <details className="ide-connect-optional">
        <summary><h3>Sign-in options</h3></summary>
        <label>
          Username or email
          <input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="ide-actions">
          <button disabled={!!busy || !username.trim() || !password} onClick={() => void signInWithCredentials()}>
            Sign in
          </button>
        </div>
        <p role="note">
          FrameUI does not save your login details. Multi-factor
          authentication may still require completing sign-in in the
          browser above.
        </p>
      </details>
      {busy && (
        <p className="ide-busy-inline" role="status">
          <Loader2 size={14} className="ide-spin" />
          {busy}
        </p>
      )}
      {error && <p className="ide-connect-hint" role="status">{error}</p>}
    </div>
    <aside className="ide-capture-sidebar" aria-label="Capture controls and history">
      <RuntimeSettings url={addressDraft} onChange={setAddressDraft} />
      <div className="ide-capture-controls">
        <h3>Capture screen</h3><p className="studio-capture-hint">Save this page as editable layers, using your project’s fonts and assets.</p>
        <label>
          Session
          <select value={profile} disabled={!!busy} onChange={(e) => setProfile(e.target.value as typeof profile)}>
            <option value="standard">Standard User</option>
            <option value="admin">Admin</option>
            <option value="super-admin">Super Admin</option>
          </select>
        </label>
        <label>
          State name
          <input
            value={stateName}
            onChange={(e) => { stateNameEdited.current = true; setStateName(e.target.value) }}
            placeholder="Notifications open"
          />
        </label>
        <button className="primary" disabled={!!busy || !stateName.trim()} onClick={() => void captureCurrentState()}>
          {busy === 'Capturing current state…' ? <Loader2 size={14} className="ide-spin" /> : <Monitor size={14} />}
          Capture screen
        </button>
      </div>
      <div className="ide-capture-session-list">
        <div className="ide-capture-session-header">
          <span className="ide-capture-session-label">Captured this session ({sessionCaptures.length})</span>
          <button
            type="button"
            className="ide-capture-sidebar-toggle"
            title={sidebarCollapsed ? 'Show captured screens' : 'Hide captured screens'}
            aria-label={sidebarCollapsed ? 'Show captured screens' : 'Hide captured screens'}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
        {!sidebarCollapsed && (
          <div className="ide-capture-session-thumbs">
            {sessionCaptures.map((c) => (
              <div key={c.id} className="ide-capture-session-thumb" title={`${c.name} — ${c.state}${c.matchedComponents ? ` · ${c.matchedComponents} components matched` : ''}`}>
                {c.thumbnail ? <img src={c.thumbnail} alt="" /> : <Monitor size={16} />}
                <CaptureSessionTitle name={c.name} onRename={(name) => renameSessionCapture(c.id, name)} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ide-capture-sidebar-footer">
        <button className="primary" onClick={() => onDone(sessionCaptures[sessionCaptures.length - 1]?.id)}>Done</button>
        <button onClick={() => setBatchOpen(true)}>
          Batch capture repository routes
          <ArrowRight size={14} />
        </button>
      </div>
    </aside>
    {captureStage && <CaptureProgressModal stage={captureStage} width={viewport.width} name={stateName} address={address} onStop={()=>{captureCancelled.current=true;void window.frameui.design.cancelCapture().catch(e=>setError(userFacingError(e)))}} />}
    {batchOpen && (
      <ImportApplication
        document={document}
        onCapture={onCapture}
        onClose={() => setBatchOpen(false)}
        initialAddress={address}
      />
    )}
    </div>
  )
}
