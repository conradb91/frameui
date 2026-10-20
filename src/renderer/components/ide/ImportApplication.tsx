import {capturePages} from '../../lib/capturePages'
import {connectApplication} from '../../lib/connectApplication'
import { RuntimeSettings } from './RuntimeSettings'
import { mergeCapturedPage } from '@core/visual/refresh'
import {
  Monitor,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { cloneObject, visit } from '@core/visual/model'
import { useEffect, useRef, useState } from 'react'
import type {
  ApplicationCandidate,
  VisualDocument,
  CaptureProgress,
} from '@shared/types/visualDesign'
import type { FrameUiApi } from '@shared/ipc-contract'
import { ModalBody, ModalHeader, ModalProgress, ModalShell } from '../ui/Modal'
type Plan = Awaited<ReturnType<FrameUiApi['design']['discover']>>
const WIDTH_STATE: Record<number, 'Desktop' | 'Tablet' | 'Mobile'> = { 1920: 'Desktop', 1440: 'Desktop', 768: 'Tablet', 390: 'Mobile' }

/**
 * The multi-route headless batch capture flow — discover -> select routes
 * & widths -> capture many pages at once unattended. A modal, launched from
 * inside `CaptureWorkspace` ("Batch capture repository routes"), since a
 * one-shot bulk operation doesn't need an interactive live browsing surface
 * of its own. Signing in manually happens in that same capture session (it
 * shares the project's session partition) rather than in an embedded
 * browser here.
 */
export function ImportApplication({
  document,
  onCapture,
  onClose,
  initialAddress,
}: {
  document: VisualDocument
  onCapture: (document: VisualDocument) => void
  onClose: () => void
  initialAddress?: string
}) {
  const [finished, setFinished] = useState<{
    pages: number
    components: number
    matchedComponents: number
  } | null>(null)
  const lastPlan = useRef<Plan | null>(null)
  const [technical, setTechnical] = useState('')
  const [routeAddress, setRouteAddress] = useState('')
  const [address, setAddress] = useState(initialAddress ?? document.appUrl ?? '')
  const [candidates, setCandidates] = useState<ApplicationCandidate[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<'standard' | 'admin' | 'super-admin'>('standard')
  const [signin, setSignin] = useState(false)
  const [loginMode, setLoginMode] = useState<'manual' | 'credentials'>('manual')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // Live Fidelity Capture: all three device sizes are on by default so
  // tablet/mobile fidelity isn't an easily-missed opt-in — deselecting is
  // still possible, but the default matches "the missing tablet and mobile
  // views are important enough to be part of the main flow."
  const [widths, setWidths] = useState<number[]>([1440, 768, 390])
  const [overlays, setOverlays] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: true; address: string; title: string; route: string; assetsLoaded: number; assetsTotal: number } | { ok: false; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [cancelled, setCancelled] = useState(false)
  const [force, setForce] = useState(false)
  const failures = useRef<string[]>([])
  const [progress, setProgress] = useState<CaptureProgress[]>([])
  async function scan() {
    setBusy('Looking for your application…')
    setError('')
    try {
      const found = await window.frameui.design.scan()
      setCandidates(found)
      const matches = found.filter((c) => c.matches)
      if (matches.length === 1)
        setAddress((current) => current || matches[0].url)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy('')
    }
  }
  async function testConnection() {
    if (!address.trim()) return
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const result = await window.frameui.design.testConnection(await connectApplication(address))
      setTestResult(result)
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }
  useEffect(() => {
    void scan()
    return window.frameui.design.onProgress((p) => {
      setProgress((previous) => [...previous, p])
      if (p.status === 'Failed') failures.current.push(p.name)
    })
  }, [])
  async function discover() {
    setBusy('Discovering pages…')
    setError('')
    setTechnical('')
    setFinished(null)
    try {
      await connectApplication(address)
      if (loginMode === 'credentials') {
        if (!username.trim() || !password) {
          setError(
            'Enter your username and password, or choose to sign in yourself.',
          )
          return
        }
        setBusy('Signing in locally…')
        const auth = await window.frameui.design.login({
          url: address.trim(),
          profile,
          username: username.trim(),
          password,
        })
        setPassword('')
        setUsername('')
        if (!auth.ok) {
          setSignin(true)
          setError(auth.message)
          return
        }
        setLoginMode('manual')
      }
      const result = await window.frameui.design.discover(await connectApplication(address), profile)
      setPlan(result)
      const first = result.routes.find(r => !r.needsSample && r.pattern === '/') || result.routes.find(r => !r.needsSample)
      setSelected(first ? [first.pattern] : [])
      lastPlan.current = result
      onCapture({...document, appUrl: address, updatedAt: new Date().toISOString(), pageRegistry: [
        ...(document.pageRegistry || []).filter(r => r.authProfile !== profile),
        ...result.routes.map(r => ({...r, authProfile: profile, area: /^\/super-admin(?:\/|$)/.test(r.pattern) ? 'Super Admin' : /^\/admin(?:\/|$)/.test(r.pattern) ? 'Admin' : 'Application', status: r.needsSample ? 'Needs Sample Data' as const : 'Discovered' as const})),
      ]})
      setFinished(null)
      setSignin(false)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setTechnical(detail)
      if (/sign in/i.test(detail)) {
        setSignin(true)
        setError(
          'Sign in with your details, or close this dialog to use the application preview.',
        )
      } else
        setError(
          'We could not finish reading this application yet. Check that it is open and fully loaded, then try again. Your designs are safe.',
        )
    } finally {
      setPassword('')
      setUsername('')
      setBusy('')
    }
  }
  async function capture() {
    if (!plan) return
    setBusy('Creating your FrameUI project')
    setCancelled(false)
    setError('')
    failures.current = []
    setProgress([])
    try {
      const pages = await capturePages({
        token: plan.token,
        routes: selected,
        overlays,
        widths: widths.length ? widths : [1440],
        unchanged: (force || overlays ? [] : document.pages)
          .filter(
            (p) =>
              (p.authProfile || 'standard') === profile &&
              p.route &&
              p.sourceHash &&
              widths.every((w) =>
                document.pages.some(
                  (other) => other.route === p.route && other.state === WIDTH_STATE[w],
                ),
              ),
          )
          .map((p) => ({ route: p.route!, hash: p.sourceHash! })),
      })
      const components = [...document.components]
      const signature = (
        o: import('@shared/types/visualDesign').VisualObject,
      ): string =>
        JSON.stringify([
          o.kind,
          o.fill,
          o.stroke,
          o.radius,
          o.fontFamily,
          o.fontSize,
          o.width,
          o.height,
          o.children.map((c) => [c.kind, c.x, c.y, c.width, c.height]),
        ])
      const repeated = new Map<string, number>()
      for (const page of pages)
        visit(page.objects, (o) => {
          if (['Button', 'Card', 'Input', 'Navigation'].includes(o.kind)) {
            const key = signature(o)
            repeated.set(key, (repeated.get(key) ?? 0) + 1)
          }
        })
      const visualMasters = new Map<
        string,
        import('@shared/types/visualDesign').VisualObject
      >()
      for (const page of pages)
        visit(page.objects, (o) => {
          const key = signature(o)
          if (
            !o.source?.component &&
            !o.variants?.length &&
            (repeated.get(key) ?? 0) < 2
          )
            return
          let master = o.source?.component
            ? components.find(
                (c) => c.source?.component === o.source?.component,
              )
            : visualMasters.get(key)
          if (!master) {
            master = {
              ...cloneObject(o),
              kind: 'Component',
              name: o.source?.component || o.name,
              x: 0,
              y: 0,
            }
            components.push(master)
            visualMasters.set(key, master)
          }
          if (
            o.variant &&
            !master.variants?.some(
              (v) => JSON.stringify(v.properties) === JSON.stringify(o.variant),
            )
          )
            master.variants = [
              ...(master.variants ?? []),
              {
                id: crypto.randomUUID(),
                name: Object.values(o.variant).join(' / '),
                properties: o.variant,
                objects: [cloneObject(o)],
              },
            ]
          o.kind = 'Instance'
          o.componentId = master.id
          o.overrides = ['children']
        })
      const existing = [...document.pages]
      for (const page of pages) {
        const i = existing.findIndex(
          (p) => p.route === page.route && p.state === page.state && (p.authProfile || 'standard') === (page.authProfile || 'standard'),
        )
        if (i >= 0) existing[i] = mergeCapturedPage(existing[i], page)
        else
          existing.push({
            ...page,
            importedObjects: structuredClone(page.objects),
            captureStatus: 'Up to date',
          })
      }
      onCapture({
        ...document,
        appUrl: address,
        pages: existing,
        pageRegistry: document.pageRegistry?.map(r => ({...r, status: r.authProfile === profile && pages.some(p => p.route === r.pattern) ? 'Captured' : r.status})),
        components,
        updatedAt: new Date().toISOString(),
      })
      setPlan(null)
      const matchedComponents = components.filter((c) => c.source?.component).length
      setFinished({ pages: pages.length, components: components.length, matchedComponents })
      if (failures.current.length)
        setError(
          `${pages.length} pages captured; ${failures.current.length} failed. ${pages.length ? 'Your successful captures have been saved.' : 'Sign in and reconnect before trying again.'}`,
        )
    } catch (e) {
      setTechnical(String(e))
      setError(
        'Capture could not finish. Your existing saved designs are unchanged. Check the error details and retry.',
      )
      setPlan(null)
    } finally {
      setBusy('')
    }
  }
  const latest = progress.at(-1)
  const capturing = busy === 'Creating your FrameUI project'
  const rows = (lastPlan.current?.routes ?? []).filter(r => selected.includes(r.pattern))
  const completed = latest?.completed ?? 0,
    total = latest?.total ?? rows.length
  return (
    <ModalShell
      size="wide"
      variant={finished ? (finished.pages ? 'completion' : 'error') : capturing ? 'progress' : plan ? 'selection' : 'setup'}
      onClose={onClose}
      closeOnEscape={!busy}
      critical={!!busy}
      className="ide-capture-dialog"
    >
      <ModalHeader
        eyebrow="Codebase to design"
        title={finished ? (finished.pages ? 'Your design project is ready' : 'No pages captured yet') : capturing ? 'Creating editable designs' : plan ? 'Project analysis ready' : 'Connect your running app'}
        description={finished ? (finished.pages ? 'Your saved pages, reusable parts, and design resources are ready in the project library.' : 'FrameUI kept the project safe, but no editable pages were created.') : capturing ? 'FrameUI is turning the selected application pages into editable design objects.' : plan ? 'Select the routes and screen sizes to capture together.' : 'Connect to the application you already run. FrameUI never starts, stops, or modifies it.'}
        icon={finished ? <CheckCircle2 size={17} /> : capturing ? <Loader2 className="ide-spin" size={17} /> : <Monitor size={17} />}
        onClose={onClose}
        closeDisabled={!!busy}
        meta={plan && !capturing ? <><span>Pages <strong>{plan.routes.length}</strong></span><span>Components <strong>{plan.components}</strong></span><span>Layouts <strong>{plan.layouts}</strong></span></> : undefined}
      />
      <ModalBody className="ide-capture-modal-body">
        {!plan && !capturing && !finished && (
          <>
            <p>
              Bring in the real interface, including its current content.
              FrameUI connects to the application you already run — it never
              starts, stops, or modifies it.
            </p>

            <section className="ide-connect-step">
              <h3><span>1</span> Point at your running app</h3>
              {candidates.length > 0 && (
                <div className="ide-application-options">
                  {candidates.map((c) => (
                    <button
                      key={c.url}
                      className={address === c.url ? 'selected' : ''}
                      onClick={() => { setAddress(c.url); setTestResult(null) }}
                    >
                      <Monitor size={17} />
                      <span>
                        <strong>{c.title}</strong>
                        <small>
                          {c.matches
                            ? 'Matches this codebase'
                            : 'Available application'}
                        </small>
                      </span>
                      {address === c.url && <CheckCircle2 size={16} />}
                    </button>
                  ))}
                </div>
              )}
              <RuntimeSettings showUrl={false} url={address} onChange={setAddress} />
              <label>
                Runtime URL
                <input
                  aria-label="Application address"
                  placeholder="http://budget.localhost:4180/dashboard"
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); setTestResult(null) }}
                />
              </label>
              <p>
                Paste the full address from your browser, including its port
                and page — or let FrameUI look for it.
              </p>
              <div className="ide-actions">
                <button disabled={!!busy} onClick={() => void scan()}>
                  {busy === 'Looking for your application…' ? <Loader2 size={14} className="ide-spin" /> : <RefreshCw size={14} />}
                  Find running apps
                </button>
              </div>
              {!candidates.length && busy !== 'Looking for your application…' && (
                <p className="ide-connect-hint">Nothing found on common local ports yet — that's fine if your app uses a different one. Open it as you normally would, then paste its address above.</p>
              )}
            </section>

            <section className="ide-connect-step">
              <h3><span>2</span> Test the connection</h3>
              <div className="ide-actions">
                <button className={testResult?.ok ? '' : 'primary'} disabled={!address.trim() || testing} onClick={() => void testConnection()}>
                  {testing ? <Loader2 size={14} className="ide-spin" /> : <ShieldCheck size={14} />}
                  Test connection
                </button>
              </div>
              {testResult && (testResult.ok ? (
                <div className="ide-connect-status" role="status">
                  <p><CheckCircle2 size={15} /> Connected to {testResult.address}</p>
                  <p>Page title: {testResult.title}</p>
                  <p>Route: {testResult.route}</p>
                  <p>Assets loaded: {testResult.assetsLoaded} of {testResult.assetsTotal}</p>
                </div>
              ) : (
                <div className="ide-inline-error" role="alert">
                  <AlertCircle size={16} />
                  <div>
                    <p>We could not reach this page.</p>
                    <small>Check that the app is running, then confirm the address and port. FrameUI will never start it for you.</small>
                  </div>
                </div>
              ))}
            </section>

            <details className="ide-connect-step ide-connect-optional" open={signin}>
              <summary><h3><span>3</span> Sign in — only if this page needs it</h3></summary>
              <fieldset className="ide-login-choice">
                <legend>How would you like to sign in?</legend>
                <div className="ide-signin-methods">
                  <label className={`ide-signin-method ${loginMode === 'manual' ? 'selected' : ''}`}>
                    <input aria-label="Sign in myself when requested" type="radio" name="capture-signin" checked={loginMode==='manual'} onChange={()=>{setLoginMode('manual');setPassword('');setUsername('')}} />
                    <Monitor size={20}/><span><strong>Sign in myself</strong><small>Sign in from the Capture tab — it shares this project's browser session. Works with passkeys and verification codes.</small></span><i aria-hidden="true" />
                  </label>
                  <label className={`ide-signin-method ${loginMode === 'credentials' ? 'selected' : ''}`}>
                    <input aria-label="Use login details for capture" type="radio" name="capture-signin" checked={loginMode==='credentials'} onChange={()=>setLoginMode('credentials')} />
                    <ShieldCheck size={20}/><span><strong>Use login details</strong><small>Enter a username and password for this capture. Your login details are never saved.</small></span><i aria-hidden="true" />
                  </label>
                </div>
                {loginMode === 'manual' && (
                  <p className="ide-connect-hint">
                    Close this dialog and sign in in the application preview, then reopen batch capture
                    and connect — the same browser session carries over.
                  </p>
                )}
                {loginMode === 'credentials' && (
                  <>
                    <label>
                      Username or email
                      <input
                        autoComplete="off"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        autoComplete="off"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  </>
                )}
                {loginMode === 'credentials' && (
                  <p role="note">
                    Multi-factor authentication (MFA) may still require manual
                    completion in the Capture tab.
                  </p>
                )}
                <p>
                  FrameUI does not save your login details. They stay on this
                  computer and are sent only to your local app to sign in for
                  capture. Your app’s session cookies and captured design files
                  stay local.
                </p>
              </fieldset>
              <label>Sign-in session<select value={profile} disabled={!!busy} onChange={e => setProfile(e.target.value as typeof profile)}><option value="standard">Standard User</option><option value="admin">Admin</option><option value="super-admin">Super Admin</option></select></label>
            </details>

            <div className="ide-actions ide-connect-footer">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                disabled={(!testResult?.ok && !signin) || !!busy}
                title={!testResult?.ok && !signin ? 'Test the connection first' : undefined}
                onClick={() => void discover()}
              >
                {signin ? 'Check sign-in & find pages' : 'Connect Running App'}
                <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
        {plan && !capturing && (
          <>
            <p>
              Select individual routes or a whole route group. Each selected size produces a separate editable screen.
            </p>
            <div className="ide-capture-summary">
              <span>
                <strong>{plan.routes.length}</strong> pages
              </span>
              <span>
                <strong>{plan.components}</strong> components
              </span>
              <span>
                <strong>{plan.layouts}</strong> layouts
              </span>
            </div>
            <div className="pages-route-tree" aria-label="Batch route selection">
              {[...new Set(plan.routes.map(route => route.pattern.split('/').filter(Boolean)[0] || 'Home'))].map(group => {
                const routes = plan.routes.filter(route => (route.pattern.split('/').filter(Boolean)[0] || 'Home') === group)
                const ready = routes.filter(route => !route.needsSample)
                return <details open key={group}><summary><input type="checkbox" aria-label={`Select batch group ${group}`} checked={!!ready.length && ready.every(r=>selected.includes(r.pattern))} disabled={!ready.length} onChange={event=>setSelected(old=>event.target.checked?[...new Set([...old,...ready.map(r=>r.pattern)])]:old.filter(p=>!ready.some(r=>r.pattern===p)))}/><strong>{group}</strong><small>{routes.length} routes</small></summary>{routes.map(route=><label key={route.pattern} className="pages-route"><input type="checkbox" checked={selected.includes(route.pattern)} disabled={route.needsSample} onChange={event=>setSelected(old=>event.target.checked?[...old,route.pattern]:old.filter(p=>p!==route.pattern))}/><span className="pages-route-info"><strong>{route.name}</strong><code>{route.pattern}</code>{route.needsSample&&<small>Add a real page address in Capture options below to resolve this route.</small>}</span></label>)}</details>
              })}
            </div>

            <fieldset className="ide-capture-sizes">
              <legend>Capture sizes</legend>
              {([[1920, 'Wide desktop · 1920×1080'], [1440, 'Desktop · 1440×1024'], [768, 'Tablet · 768×1024'], [390, 'Mobile · 390×844']] as const).map(([w, labelText]) => (
                <label key={w} className="ide-check">
                  <input
                    type="checkbox"
                    checked={widths.includes(w)}
                    onChange={(e) => setWidths((current) => e.target.checked ? [...current, w] : current.filter((x) => x !== w))}
                  />
                  {labelText}
                </label>
              ))}
              <p>FrameUI captures each selected size independently — it never shrinks the desktop capture to imitate a smaller device.</p>
            </fieldset>
            <label className="ide-check">
              <input
                type="checkbox"
                checked={overlays}
                onChange={(e) => setOverlays(e.target.checked)}
              />
              Include visible overlay states
            </label>
            <p>
              Overlay states are captured separately for each selected device
              size. Open interactive states in the Capture tab and use
              Capture Screen to save them. Automatic capture records visible
              overlays without clicking controls.
            </p>
            {plan.warnings.map((warning) => (
              <p key={warning} className="ide-capture-warning">
                {warning}
              </p>
            ))}
            <details className="ide-capture-options">
              <summary>Capture options</summary>
              <label className="ide-check">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                />
                Refresh current content even if source is unchanged
              </label>
              <p>Add a specific page if it did not appear in the list.</p>
              <label>
                Page address
                <input
                  placeholder="/projects/123"
                  value={routeAddress}
                  onChange={(e) => setRouteAddress(e.target.value)}
                />
              </label>
              <button
                disabled={!routeAddress}
                onClick={async () => {
                  try {
                    const routes = await window.frameui.design.addRoute(
                      plan.token,
                      routeAddress,
                    )
                    setPlan({ ...plan, routes })
                    setSelected(old => [...new Set([...old, ...routes.filter(r => !plan.routes.some(p => p.pattern === r.pattern)).map(r => r.pattern)])])
                    lastPlan.current = { ...plan, routes }
                    setRouteAddress('')
                  } catch (e) {
                    setTechnical(String(e))
                    setError(
                      'Use a normal page address from the connected application.',
                    )
                  }
                }}
              >
                Add page
              </button>
            </details>
            <div className="ide-safe-note">
              <ShieldCheck size={16} />
              <p>
                FrameUI reads the interface to create editable designs. Your
                source code and database are not changed.
              </p>
            </div>
            <div className="ide-actions">
              <button onClick={() => setPlan(null)}>Back</button>
              <button className="primary" disabled={!selected.length || !widths.length} onClick={() => void capture()}>
                Capture {selected.length * widths.length} screens
                <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
        {capturing && (
          <>
            <p>
              Your screens are becoming editable design objects. You can
              continue as soon as capture is complete.
            </p>
            <ModalProgress value={(completed / Math.max(1, total)) * 100} label={latest?.name || 'Preparing selected pages'} detail={`${completed} of ${total} pages complete`} />
            <button disabled={cancelled} onClick={() => {setCancelled(true); void window.frameui.design.cancelCapture().catch(e => setError(String(e)))}}>{cancelled ? 'Stopping…' : 'Cancel capture'}</button>
            <div className="ide-capture-page-list">
              {rows.map((r) => {
                const state = [...progress]
                  .reverse()
                  .find((p) => p.name === r.name)?.status
                return (
                  <div key={r.pattern}>
                    {state === 'Complete' ? (
                      <CheckCircle2 size={15} />
                    ) : state === 'Processing' ? (
                      <Loader2 size={15} className="ide-spin" />
                    ) : state === 'Failed' ? (
                      <AlertCircle size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    <span>{r.name}</span>
                    <small>
                      {state === 'Complete' ? 'Captured' : (state ?? 'Waiting')}
                    </small>
                  </div>
                )
              })}
            </div>
          </>
        )}
        {finished && (
          <>
            <p>
              {!finished.pages
                ? 'FrameUI could not capture these screens. Sign in via the Capture tab, then check the connection again.'
                : failures.current.length
                  ? 'Your completed pages are saved. Some screens need attention.'
                  : 'Your screens, content and reusable parts are ready to edit. The running application can now be closed.'}
            </p>
            <div className="ide-capture-summary">
              <span>
                <strong>{finished.pages}</strong> variants saved{cancelled ? ' · Capture cancelled; completed captures kept' : ''}
              </span>
              <span>
                <strong>{finished.components}</strong> components
                {finished.matchedComponents > 0 && ` · ${finished.matchedComponents} matched to source`}
              </span>
            </div>
            {failures.current.length > 0 && (
              <div className="ide-capture-failures">
                {[...new Set(failures.current)].map((name) => (
                  <div key={name}>
                    <AlertCircle size={15} />
                    <span>
                      <strong>{name}</strong>
                      <small>
                        {progress
                          .find((p) => p.name === name && p.error)
                          ?.error?.match(/sign in/i)
                          ? 'Sign in is required before capture.'
                          : 'This page could not finish rendering.'}
                      </small>
                    </span>
                    <button
                      onClick={() => {
                        setFinished(null)
                        setAddress(
                          lastPlan.current?.routes.find((r) => r.name === name)
                            ?.url ?? address,
                        )
                        setSignin(true)
                      }}
                    >
                      Retry after signing in
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="ide-actions">
              {cancelled && <button onClick={() => {setPlan(lastPlan.current);setFinished(null);setCancelled(false)}}>Continue remaining captures</button>}
              {failures.current.length > 0 && (
                <button onClick={() => {setPlan(lastPlan.current);setFinished(null);setSelected((lastPlan.current?.routes || []).filter(r => failures.current.includes(r.name)).map(r => r.pattern))}}>
                  Retry failed pages
                </button>
              )}
              {!finished.pages && (
                <button
                  className="primary"
                  onClick={() => {
                    setFinished(null)
                    setPlan(null)
                    setError('')
                    setSignin(true)
                  }}
                >
                  Sign in & reconnect
                </button>
              )}
              <button
                className={finished.pages ? 'primary' : ''}
                onClick={onClose}
              >
                {finished.pages ? 'Open project library' : 'Back to project'}
                <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
        {busy && !capturing && (
          <p className="ide-busy-inline" role="status">
            <Loader2 size={14} className="ide-spin" />
            {busy}
          </p>
        )}
        {error && (
          <div className="ide-inline-error" role="alert">
            <AlertCircle size={16} />
            <p>{error}</p>
          </div>
        )}
        {(technical ||
          progress.some((p) => p.error) ||
          plan?.warnings.length) && (
          <details className="ide-technical">
            <summary>Technical details</summary>
            {technical && <p>{technical}</p>}
            {plan?.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            {progress
              .filter((p) => p.error)
              .map((p, i) => (
                <p key={i}>
                  {p.name}: {p.error}
                </p>
              ))}
          </details>
        )}
      </ModalBody>
    </ModalShell>
  )
}
