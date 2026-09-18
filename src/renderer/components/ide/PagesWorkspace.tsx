import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArrowRight, CheckCircle2, Circle, Globe, Layers, Loader2, LockKeyhole, RefreshCw, Search } from 'lucide-react'
import type { CaptureProgress, PageRegistryEntry, VisualDocument, VisualPage } from '@shared/types/visualDesign'
import { mergeCapturedPage } from '@core/visual/refresh'
import { ModalBody, ModalField, ModalFooter, ModalHeader, ModalNotice, ModalProgress, ModalShell } from '../ui/Modal'
import { formatRoute, humanizeName } from './displayFormat'
import './pages-workspace.css'

type Profile = 'standard' | 'admin' | 'super-admin'
type Job = { patterns: string[]; widths: number[]; address: string; profile: Profile }
const devices = [[1440, 'Desktop'], [768, 'Tablet'], [390, 'Mobile']] as const
const needsExample = (route: PageRegistryEntry) => !!route.needsSample || /[:*{}[\]]/.test(route.pattern)
const readableError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
const requiresLogin = (message = '') => /sign.?in|log.?in|HTTP 401/i.test(message)
function applicationUrl(value: string) {
  let url: URL
  try { url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`) }
  catch { throw new Error('Enter your local application address, for example http://localhost:3000, then try capture again.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !(['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost'))) throw new Error('Enter your local application address, including the port, for example http://localhost:3000.')
  return url.href
}
function GroupCheck({ checked, mixed, ...props }: { checked: boolean; mixed: boolean; disabled: boolean; onChange: () => void; 'aria-label': string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <input ref={ref} type="checkbox" checked={checked} {...props}/>
}

export function PagesWorkspace({ document, initialAddress, archivedPages, onCapture, onCreate, onBusy, onArchive }: {
  document: VisualDocument; initialAddress?: string; archivedPages: string[]
  onCapture: (next: VisualDocument) => void; onCreate: (page: VisualPage) => void; onBusy: (busy: boolean) => void; onArchive: (pattern: string) => void
}) {
  const latest = useRef(document); latest.current = document
  const mounted = useRef(true)
  const routes = useMemo(() => [...new Map((document.pageRegistry ?? []).filter(r => !archivedPages.includes(r.pattern)).map(r => [r.pattern, r])).values()].sort((a,b) => a.pattern === '/' ? -1 : b.pattern === '/' ? 1 : a.pattern.localeCompare(b.pattern)), [document.pageRegistry, archivedPages])
  const [address, setAddress] = useState(initialAddress ?? '')
  const [connected, setConnected] = useState('')
  const [profile, setProfile] = useState<Profile>('standard')
  const [selected, setSelected] = useState<string[]>([])
  const [samples, setSamples] = useState<Record<string,string>>(() => Object.fromEntries(routes.flatMap(route => {
    if (!needsExample(route)) return []
    try {
      const path = new URL(route.url, initialAddress || 'http://localhost').pathname
      return /[:*{}[\]]/.test(decodeURIComponent(path)) || path === route.pattern ? [] : [[route.pattern, path]]
    } catch { return [] }
  })))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All pages')
  const [previewIds,setPreviewIds] = useState<Record<string,string>>({})
  const [widths, setWidths] = useState<number[]>([1440])
  const [busy, setBusy] = useState('')
  const running = useRef(false)
  const stopRequested = useRef(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')
  const [progress, setProgress] = useState<CaptureProgress[]>([])
  const [routeProgress, setRouteProgress] = useState<Record<string, CaptureProgress[]>>({})
  const events = useRef<CaptureProgress[]>([])
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [auth, setAuth] = useState<Job | null>(null)
  const [manual, setManual] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const addressField = useRef<HTMLInputElement>(null)
  useEffect(() => { if (initialAddress) setAddress(value => value || initialAddress) }, [initialAddress])
  useEffect(() => window.frameui.design.onProgress(event => {
    if (!running.current) return
    events.current.push(event)
    if (event.route) setRouteProgress(old=>({...old,[event.route!]:[...(old[event.route!]??[]).filter(p=>p.width!==event.width),event]}))
    setProgress([...events.current])
  }), [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (running.current) void window.frameui.design.cancelCapture().catch(() => {})
      onBusy(false)
    }
  }, [])
  function publish(next: VisualDocument) {
    if (mounted.current) onCapture(next)
    else void window.frameui.design.save(next)
  }
  const hasCapture = (pattern: string) => document.pages.some(p => p.route === pattern && (p.authProfile || 'standard') === profile)
  const needsAttention = (r: PageRegistryEntry) => !!(r.captureError && r.captureErrorProfile === profile) || (needsExample(r) && !samples[r.pattern]?.trim())
  const visible = routes.filter(r => (filter === 'All pages' || (filter === 'Captured' ? hasCapture(r.pattern) : filter === 'Not captured' ? !hasCapture(r.pattern) : needsAttention(r))) && `${r.name} ${r.pattern}`.toLowerCase().includes(query.toLowerCase()))
  const groups = new Map<string, PageRegistryEntry[]>()
  for (const route of visible) {
    const parts = route.pattern.split('/').filter(Boolean)
    const group = parts.length ? '/' + parts.slice(0, ['admin','super-admin'].includes(parts[0]) ? 2 : 1).join('/') : 'Home'
    groups.set(group, [...(groups.get(group) ?? []), route])
  }
  const captured = routes.filter(r => document.pages.some(p => p.route === r.pattern && (p.authProfile || 'standard') === profile)).length
  const missing = selected.filter(pattern => { const r = routes.find(r => r.pattern === pattern); return r && needsExample(r) && !samples[pattern]?.trim() })
  const completed = progress.filter(p => p.status !== 'Processing').length
  const failed = progress.filter(p => p.status === 'Failed')
  function toggle(patterns: string[]) {
    setSelected(old => patterns.every(p => old.includes(p)) ? old.filter(p => !patterns.includes(p)) : [...new Set([...old,...patterns])])
  }
  function jobUrl(job: Job, pattern: string) { return new URL(samples[pattern]?.trim() || pattern, job.address).href }
  async function connect() {
    if (running.current) return
    setError(''); setSummary('')
    try {
      const url = applicationUrl(address)
      setBusy('Checking connection'); onBusy(true)
      await window.frameui.design.testConnection(url, profile)
      setAddress(url); setConnected(url)
      publish({...latest.current, appUrl:url, updatedAt:new Date().toISOString()})
      setSummary('Connected. Choose a page to capture.')
    } catch (e) {
      const message = readableError(e); setError(message); setConnected('')
      if (requiresLogin(message)) {
        const url = applicationUrl(address)
        const route = routes.find(r=>r.pattern===new URL(url).pathname)
        if (route) { setAuth({patterns:[route.pattern],widths:[...widths],address:url,profile});setManual(false);setAuthError('') }
      }
    }
    finally { setBusy(''); onBusy(false) }
  }
  async function capture(patterns: string[], retry?: Job) {
    if (running.current || !patterns.length) return
    setError(''); setSummary('')
    let job: Job
    try {
      job = retry ? {...retry, patterns} : {patterns, widths:[...widths], address:applicationUrl(address), profile}
      if (!job.widths.length) throw new Error('Choose at least one screen size.')
      for (const pattern of patterns) {
        const route = routes.find(r => r.pattern === pattern)
        if (route && needsExample(route) && !samples[pattern]?.trim()) {
          setSelected(old => [...new Set([...old,pattern])])
          throw new Error(`Enter a real page path for ${formatRoute(pattern)}, then capture it. Example: replace :id with an existing record ID.`)
        }
        if (new URL(jobUrl(job,pattern)).origin !== new URL(job.address).origin) throw new Error('Example paths must belong to the connected application.')
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); if (!address.trim()) addressField.current?.focus(); return }
    setAddress(job.address)
    running.current = true; stopRequested.current = false; onBusy(true); setBusy('Preparing capture'); setStopping(false)
    events.current=[]; setProgress([]); setActiveJob(job)
    try {
      const {token} = await window.frameui.design.prepareCapture({url:job.address, profile:job.profile, routes:patterns.map(pattern => ({pattern, path:jobUrl(job,pattern), name:routes.find(r=>r.pattern===pattern)?.name || pattern}))})
      if (stopRequested.current) { setSummary('Capture stopped before any pages were captured.'); return }
      setBusy('Capturing pages')
      const pages = await window.frameui.design.capture({token, routes:patterns, widths:job.widths, unchanged:[]})
      const existing = [...latest.current.pages]
      for (const page of pages) {
        const i = existing.findIndex(p => p.route === page.route && p.state === page.state && (p.authProfile || 'standard') === (page.authProfile || 'standard'))
        if (i < 0) existing.push({...page, importedObjects:structuredClone(page.objects), captureStatus:'Up to date'})
        else existing[i] = mergeCapturedPage(existing[i],page)
      }
      const failures = events.current.filter(p => p.status === 'Failed')
      publish({...latest.current, appUrl:job.address, pages:existing, updatedAt:new Date().toISOString(), pageRegistry:latest.current.pageRegistry?.map(r => {
        const failure = failures.find(p=>p.route===r.pattern)
        if (failure) return {...r, status:'Failed', captureError:failure.error, captureErrorProfile:job.profile}
        return pages.some(p => p.route === r.pattern) ? {...r, status:'Captured', url:jobUrl(job,r.pattern), captureError:undefined, captureErrorProfile:undefined} : r
      })})
      const finished = events.current.filter(p => p.status !== 'Processing').length
      setSummary(`${pages.length} screen${pages.length===1?'':'s'} saved${failures.length ? ` · ${failures.length} need attention` : ''}${finished < patterns.length*job.widths.length ? ' · Capture stopped; completed screens kept' : ''}. Ready to design.`)
      if (pages.length) setConnected(job.address)
      const locked = [...new Set(failures.filter(p=>requiresLogin(p.error)).map(p=>p.route).filter((p): p is string=>!!p))]
      if (locked.length) { setAuth({...job,patterns:locked}); setManual(false); setAuthError('') }
    } catch (e) { setError(readableError(e)) }
    finally { running.current=false; setBusy(''); onBusy(false) }
  }
  async function signIn() {
    if (!auth) return
    setAuthBusy(true); setAuthError('')
    try {
      const result = await window.frameui.design.login({url:jobUrl(auth,auth.patterns[0]), profile:auth.profile, username:username.trim(), password})
      if (!result.ok) { setAuthError('Sign-in could not finish. Check your details, or use “Sign in in your app” for verification codes, passkeys or a custom sign-in.'); return }
      if (!mounted.current) return
      const job = auth; setAuth(null); await capture(job.patterns,job)
    } catch { setAuthError('We could not complete sign-in. Check that your app is running and try again.') }
    finally { setPassword(''); setUsername(''); setAuthBusy(false) }
  }
  function closeAuth() { if (authBusy) return; setAuth(null);setPassword('');setUsername('');setAuthError('') }
  const resultPages = document.pages.filter(p => (p.authProfile || 'standard') === profile)
  return <div className="pages-workspace">
    <details className="pages-connection-disclosure" open={!initialAddress || undefined}>
      <summary><Globe size={15}/><strong>{address.trim() ? 'Application' : 'Connect your app'}</strong><span>{address.trim() || 'Add your localhost address to capture pages'}</span><small>Connection settings</small></summary>
    <section className="pages-connection" aria-label="Application connection">
      <Globe size={19}/><div className="pages-connection-address"><label htmlFor="pages-app-address">Running application</label><div><input ref={addressField} id="pages-app-address" placeholder="http://localhost:3000" value={address} disabled={!!busy} onChange={e=>{setAddress(e.target.value);setConnected('')}} onKeyDown={e=>{if(e.key==='Enter')void connect()}}/><button disabled={!!busy || !address.trim()} onClick={()=>void connect()}>{busy==='Checking connection' ? <Loader2 size={14} className="ide-spin"/> : connected===address ? <CheckCircle2 size={14}/> : null}{connected===address ? 'Connected' : 'Test connection'}</button></div><small>Keep your app running. Routes come from your code; their previews appear after capture.</small></div>
      <label className="pages-session">App session<select aria-label="Capture session" disabled={!!busy} value={profile} onChange={e=>{setProfile(e.target.value as Profile);setProgress([]);setRouteProgress({})}}><option value="standard">Standard</option><option value="admin">Admin</option><option value="super-admin">Super admin</option></select></label>
    </section>
    </details>
    {error && <div role="alert" className="pages-notice error">{error}</div>}
    {summary && <div role="status" className="pages-notice"><CheckCircle2 size={16}/>{summary}</div>}
    {(busy==='Preparing capture'||busy==='Capturing pages') && activeJob && <section className="pages-progress" aria-label="Capture progress"><ModalProgress value={busy==='Preparing capture' ? undefined : completed / Math.max(1,activeJob.patterns.length*activeJob.widths.length)*100} label={busy} detail={`${completed} of ${activeJob.patterns.length*activeJob.widths.length} screens processed · ${failed.length} failed`}/><button disabled={stopping} onClick={()=>{stopRequested.current=true;setStopping(true);void window.frameui.design.cancelCapture().catch(e=>setError(readableError(e)))}}>{stopping ? 'Stopping…' : 'Stop capture'}</button></section>}
    <div className="pages-columns">
      <section className="pages-routes" aria-label="Route selection">
        <header><div><h2>Your pages <span className="pages-count">{routes.length}</span></h2><p>{captured} ready to design</p></div><span className="pages-count">{selected.length} selected</span></header>
        <div className="pages-search"><Search size={15}/><input aria-label="Search pages" placeholder="Find a page or route…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <div className="pages-filter-bar" aria-label="Filter pages">{['All pages','Captured','Not captured','Needs attention'].map(label=><button key={label} aria-pressed={filter===label} className={filter===label?'active':''} onClick={()=>setFilter(label)}>{label}</button>)}</div>
        <div className="pages-selection-tools"><button disabled={!!busy || !visible.length} onClick={()=>setSelected(old=>[...new Set([...old,...visible.filter(r=>!needsExample(r)||samples[r.pattern]?.trim()).map(r=>r.pattern)])])}>Select ready routes</button><button disabled={!!busy || !selected.length} onClick={()=>setSelected([])}>Clear selection</button></div>

        <div className="pages-route-tree">
          {[...groups].map(([group,entries])=><details open key={group} data-single={entries.length===1}><summary><GroupCheck aria-label={`Select group ${group}`} checked={entries.every(r=>selected.includes(r.pattern))} mixed={entries.some(r=>selected.includes(r.pattern))&&!entries.every(r=>selected.includes(r.pattern))} disabled={!!busy} onChange={()=>toggle(entries.map(r=>r.pattern))}/><Layers size={14}/><strong>{group}</strong><small>{entries.length}</small></summary>{entries.map(route=>{
            const versions = resultPages.filter(p=>p.route===route.pattern)
            const page = versions.find(p=>p.id===previewIds[route.pattern]) ?? versions[0]
            const updates = routeProgress[route.pattern] ?? []
            const failure = updates.find(p=>p.status==='Failed') ?? (!updates.length && route.captureErrorProfile===profile && route.captureError ? {error:route.captureError} : undefined)
            const processing = !!busy && updates.some(p=>p.status==='Processing' && !updates.some(next=>next.width===p.width && next.status!=='Processing'))
            const status = processing ? 'Capturing…' : busy==='Capturing pages' && activeJob?.patterns.includes(route.pattern) && !updates.length ? 'Queued' : failure ? requiresLogin(failure.error) ? 'Sign-in needed' : 'Needs attention' : page ? 'Captured' : needsExample(route)&&!samples[route.pattern]?.trim() ? 'Example path needed' : 'Not captured'
            return <div key={route.pattern} className={`pages-route ${selected.includes(route.pattern)?'selected':''}`}>
              <input type="checkbox" aria-label={`Select ${route.pattern}`} checked={selected.includes(route.pattern)} disabled={!!busy} onChange={()=>toggle([route.pattern])}/>
              {page?.thumbnail && <img className="pages-route-preview" src={page.thumbnail} alt="" loading="lazy"/>}
              <div className="pages-route-info"><button className="pages-route-title" disabled={!!busy} onClick={()=>page?onCreate(page):void capture([route.pattern])}>{humanizeName(route.name,route.area)}</button><code>{formatRoute(route.pattern)}</code><small className={failure?'error':''}>{processing?<Loader2 size={12} className="ide-spin"/>:page?<CheckCircle2 size={12}/>:<Circle size={12}/>} {status}</small>
                {versions.length>1 && <select className="pages-preview-size" aria-label={`Screen size for ${route.pattern}`} value={page?.id} onChange={e=>setPreviewIds({...previewIds,[route.pattern]:e.target.value})}>{versions.map(p=><option key={p.id} value={p.id}>{p.state} · {p.width}px</option>)}</select>}
                {needsExample(route) && selected.includes(route.pattern) && <input aria-label={`Example path for ${route.pattern}`} placeholder="Real path, e.g. /customers/123" value={samples[route.pattern]??''} disabled={!!busy} onChange={e=>setSamples({...samples,[route.pattern]:e.target.value})}/>}
                {failure && <p role="status" className="pages-route-error">{failure.error}</p>}
              </div>
              {page && <button className="pages-open-design" disabled={!!busy} onClick={()=>onCreate(page)}>Start design <ArrowRight size={13}/></button>}
              <button className="pages-route-capture" aria-label={`Capture ${route.pattern}`} disabled={!!busy} onClick={()=>void capture([route.pattern])}>{page?<RefreshCw size={14}/>:<ArrowRight size={14}/>}<span>{page?'Recapture':'Capture'}</span></button>
              <button className="pages-archive-action" title="Archive page" aria-label={`Archive ${route.pattern}`} disabled={!!busy} onClick={()=>{onArchive(route.pattern);setSelected(old=>old.filter(p=>p!==route.pattern))}}><Archive size={14}/></button>
            </div>
          })}</details>)}
          {!visible.length && <div className="pages-no-routes"><h3>{query?'No matching routes':'No page routes found'}</h3><p>{query?'Try a page name or a shorter path.':'Refresh from code after adding routes to your project.'}</p></div>}
        </div>
      </section>
    </div>
    <section className="pages-capture-bar" aria-label="Capture selection">
      <div><strong>{selected.length ? `${selected.length} selected` : 'Capture a page or select several'}</strong>{selected.length>0 && <small>{selected.length * widths.length} screens</small>}</div>
      <fieldset disabled={!!busy}><legend>Screen sizes</legend>{devices.map(([width,label])=><label key={width}><input type="checkbox" checked={widths.includes(width)} onChange={e=>setWidths(old=>e.target.checked?[...old,width]:old.filter(w=>w!==width))}/><span>{label}</span></label>)}</fieldset>
      <button className="primary" disabled={!!busy||!selected.length||!widths.length||!!missing.length} onClick={()=>void capture(selected)}>{busy?<Loader2 size={15} className="ide-spin"/>:<Layers size={15}/>}Capture selected pages</button>
      {missing.length>0&&<p className="pages-batch-hint">Add an example path for {missing.length} selected page{missing.length===1?'':'s'}.</p>}
      {!busy&&failed.length>0&&activeJob&&<button onClick={()=>void capture([...new Set(failed.map(p=>p.route).filter((p):p is string=>!!p))],activeJob)}>Retry failed pages</button>}
    </section>
    {auth && <ModalShell size={manual?'wide':'compact'} variant="form" onClose={closeAuth} critical={authBusy} as="form" onSubmit={e=>{e.preventDefault();void signIn()}}>
      <ModalHeader eyebrow="APPLICATION ACCESS" title="Sign in to capture these pages" description={`${auth.patterns.length} selected page${auth.patterns.length===1?' requires':'s require'} a signed-in session. Your other captures have been kept.`} icon={<LockKeyhole size={18}/>} onClose={closeAuth} closeDisabled={authBusy}/>
      <ModalBody><div className="pages-auth-origin"><Globe size={16}/><div><strong>{new URL(auth.address).origin}</strong><small>{auth.profile} session · {formatRoute(auth.patterns[0])}</small></div></div>
        {manual?<><p>Sign in below, including any verification steps. Then resume capture using this app session.</p><webview className="pages-auth-browser" aria-label="Application sign-in browser" src={jobUrl(auth,auth.patterns[0])} partition={`persist:project-${document.projectId}${auth.profile==='standard'?'':`-${auth.profile}`}`}/></>:<><ModalField label="Email or username"><input autoComplete="username" required value={username} disabled={authBusy} onChange={e=>setUsername(e.target.value)}/></ModalField><ModalField label="Password"><input type="password" autoComplete="off" required value={password} disabled={authBusy} onChange={e=>setPassword(e.target.value)}/></ModalField><ModalNotice>Your login details are used for this sign-in and are not saved by FrameUI. Your app session is kept on this computer.</ModalNotice></>}
        {authError&&<p role="alert" className="pages-notice error">{authError}</p>}{authBusy&&<ModalProgress label="Signing in to your application"/>}
      </ModalBody><ModalFooter><button type="button" disabled={authBusy} onClick={closeAuth}>Not now</button>{!manual&&<button type="button" disabled={authBusy} onClick={()=>{setManual(true);setPassword('');setUsername('')}}>Sign in in your app</button>}{manual?<button type="button" className="primary" onClick={()=>{const job=auth;setAuth(null);void capture(job.patterns,job)}}>I’m signed in · Resume capture</button>:<button type="submit" className="primary" disabled={authBusy||!username.trim()||!password}>{authBusy?'Signing in…':'Sign in & resume'}</button>}</ModalFooter>
    </ModalShell>}
  </div>
}
