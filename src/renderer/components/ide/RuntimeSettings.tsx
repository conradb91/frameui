import { applicationAddress } from '@core/runtime/address'
import { userFacingError } from '../../lib/userFacingError'
import { useEffect, useRef, useState } from 'react'
import type { RuntimeConnection, RuntimeSource } from '@shared/types/project'

export function RuntimeSettings({ url, onChange, showUrl = true }: { url: string; onChange: (url: string) => void; showUrl?: boolean }) {
  const [source, setSource] = useState<RuntimeSource>(() => {
    try { const host = new URL(applicationAddress(url)).hostname; return ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost') ? 'local' : 'staging' } catch { return 'local' }
  })
  const latestUrl = useRef(url)
  latestUrl.current = url
  useEffect(() => {
    try {
      const host = new URL(applicationAddress(url)).hostname
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost')
      setSource(previous => local ? 'local' : previous === 'local' ? 'staging' : previous)
    } catch { /* incomplete address */ }
  }, [url])
  const [connection, setConnection] = useState<RuntimeConnection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [downloaded, setDownloaded] = useState('')
  useEffect(() => {
    let alive = true
    void window.frameui.project.getRuntime().then(value => {
      if (!alive || !value) return
      setConnection(value)
      if (!latestUrl.current.trim()) { setSource(value.source); onChange(value.url) }
      else { try { if (new URL(applicationAddress(latestUrl.current)).origin === value.origin) setSource(value.source) } catch { /* keep draft */ } }
    }).catch(reason => { if (alive) setError(userFacingError(reason)) })
    return () => { alive = false }
    // Load this project's saved connection when the settings mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(()=>{const update=(event:Event)=>setConnection((event as CustomEvent<RuntimeConnection>).detail);window.addEventListener('frameui:runtime-updated',update);return()=>window.removeEventListener('frameui:runtime-updated',update)},[])
  let matches = false
  try { matches = new URL(applicationAddress(url)).origin === connection?.origin } catch { /* incomplete input */ }
  async function save(verify: boolean) {
    setBusy(true)
    setError('')
    try {
      const saved = await window.frameui.project.configureRuntime(applicationAddress(url), source)
      setConnection(saved)
      const next=verify?await window.frameui.project.verifyRuntime():saved
      setConnection(next)
      if(applicationAddress(latestUrl.current)===saved.url)onChange(next.url)
      window.dispatchEvent(new CustomEvent('frameui:runtime-updated',{detail:next}))
    } catch (reason) { setError(userFacingError(reason)) }
    finally { setBusy(false) }
  }
  async function download() {
    setBusy(true)
    setError('')
    try {
      const saved = await window.frameui.project.configureRuntime(applicationAddress(url), source)
      setConnection(saved)
      const result = await window.frameui.project.downloadVerification()
      if (result.saved) setDownloaded(saved.token)
    } catch (reason) { setError(userFacingError(reason)) }
    finally { setBusy(false) }
  }
  const connected = matches && !!(connection?.connectedAt||connection?.verifiedAt)
  return <details className="ide-runtime-settings">
    <summary><span>Running application</span><span className="ide-runtime-badge">{connected ? 'Connected' : 'Not connected'}</span></summary>
    <div className="ide-runtime-content">
      <p>Connect the app you want to capture. Your repository supplies the design context.</p>
      <div className="ide-runtime-fields">
        <label>Environment <select aria-label="Environment" value={source} disabled={busy} onChange={event => { setSource(event.target.value as RuntimeSource); setError('') }}>
          <option value="local">Local development</option>
          <option value="staging">Staging domain</option>
          <option value="production">Production domain</option>
        </select></label>
        {showUrl && <label>App address <input aria-label="App address" value={url} disabled={busy} placeholder={source === 'local' ? 'http://localhost:3000' : 'https://app.example.com'} onChange={event => { onChange(event.target.value); setError('') }} /></label>}
      </div>
      <p className="ide-muted">{source==='local'?'Keep your development server running.':'Sign in inside the capture browser if your app requires it.'} No domain-file upload is required.</p>
      <button type="button" className="ide-runtime-primary" disabled={busy||!url.trim()} onClick={()=>void save(false)}>{connected?'Update connection':'Connect app'}</button>
      {connected&&<p role="status" className="ide-runtime-success">App address connected. Open the app to navigate and capture screens.</p>}
      {source!=='local'&&<details className="ide-runtime-manual"><summary>Domain ownership (optional)</summary><p>Only needed if your organisation requires an ownership record. This does not sign you in or enable capture.</p><button type="button" disabled={busy||!url.trim()} onClick={()=>void download()}>Download verification file</button>{connection&&matches&&downloaded===connection.token&&<p>Upload the unchanged file to {connection.origin}/.well-known/frameui-verification.txt</p>}<button type="button" disabled={busy||!url.trim()} onClick={()=>void save(true)}>Check ownership file</button>{connection?.verifiedAt&&<p>Ownership verified.</p>}</details>}
      {busy && <p role="status">Working…</p>}
    </div>
    {error && <p role="alert" className="ide-runtime-error">{error}</p>}
  </details>
}
