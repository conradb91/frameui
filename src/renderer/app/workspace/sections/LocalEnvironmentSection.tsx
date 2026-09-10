import { useState } from 'react'
import { LoaderCircle, RefreshCw, Square } from 'lucide-react'
import type { HostingOptions } from '@shared/types/hosting'
import { useProjectStore } from '../../../state/projectStore'
import { useUiStore } from '../../../state/uiStore'
import { useDesignFilesStore } from '../../../state/designFilesStore'
import { useLocalApplicationStore } from '../../../state/localApplicationStore'
import { EnvironmentEditor } from '../../../components/project/EnvironmentEditor'
import { sanitizeDiagnostics } from '@shared/diagnostics'

export function LocalEnvironmentSection() {
  const project = useProjectStore(s => s.activeProject)!
  const pages = useProjectStore(s => s.activeIndex?.projectModel.pages.length ?? 0)
  const { snapshot, phase, busy, failure, events, prepare, action, inspect } = useLocalApplicationStore()
  const [advanced, setAdvanced] = useState(false)
  const [database, setDatabase] = useState<HostingOptions['database']>('skip')
  const [panel, setPanel] = useState('setup')
  const [output, setOutput] = useState('')
  const [confirmation, setConfirmation] = useState('')
  function openDesigner() {
    localStorage.setItem(`frameui:canvas-mode:${project.id}`, 'design')
    useDesignFilesStore.getState().selectFile('current-application')
    useUiStore.getState().setSection('canvas')
  }
  const button = 'h-8 rounded border border-border px-3 text-sm hover:bg-hover disabled:opacity-40'
  return <main className="min-w-0 flex-1 overflow-auto bg-bg px-6 py-8"><div className="mx-auto max-w-xl">
    <p className="text-xs text-text-3">{project.name}</p><h1 className="mt-2 text-[18px] font-semibold">{phase === 'Analysing' ? `Preparing ${project.name}` : snapshot?.running ? 'Local application' : `${project.name} is ready to prepare`}</h1>
    {phase === 'Analysing' ? <div className="mt-6 flex items-center gap-2 text-sm text-text-2" role="status"><LoaderCircle size={16} className="animate-spin"/>Finding your application and checking what it needs…</div> : <>
      <div className="my-5 flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${snapshot?.running ? 'bg-success' : failure ? 'bg-warning' : 'bg-text-3'}`}/>{snapshot?.running ? 'Ready' : failure ? 'Needs attention' : snapshot?.framework ?? 'Application'}<span className="text-text-3">· {pages} screens found</span></div>
      <p className="max-w-lg text-sm leading-relaxed text-text-2">{snapshot?.running ? 'FrameUI is running a private local copy so its real screens can be used in the designer.' : 'FrameUI will prepare a private local copy so you can open real screens and start designing. Your original project files stay unchanged.'}</p>
      {snapshot?.database && <p className="mt-2 text-xs text-text-3">Database connection detected</p>}
      {failure && <div role="alert" className="mt-5 border-l-2 border-warning pl-3"><p className="text-sm font-medium">{failure.title}</p><p className="mt-1 text-sm text-text-2">{failure.message}</p><button className="mt-2 text-xs underline" onClick={() => { setAdvanced(true); setPanel('details') }}>Technical details</button></div>}
      <div className="mt-6 flex flex-wrap gap-2">{snapshot?.running ? <><button className="h-8 rounded bg-accent px-3 text-sm text-on-accent" onClick={openDesigner}>Open designer</button><button className={button} disabled={busy} onClick={() => void action('start')}><RefreshCw size={13} className="mr-1 inline"/>Restart</button><button className={button} disabled={busy} onClick={() => void action('stop')}><Square size={12} className="mr-1 inline"/>Stop</button></> : <button disabled={!snapshot || busy} className="h-8 rounded bg-accent px-3 text-sm text-on-accent disabled:opacity-40" onClick={async () => { if (await prepare(database)) openDesigner() }}>{failure ? 'Retry' : 'Prepare project'}</button>}<button className={button} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>{snapshot?.running ? 'Advanced settings' : 'Advanced setup'}</button></div>
      {snapshot?.running && <details className="mt-5"><summary className="cursor-pointer text-sm text-text-2">Sign in & preview</summary><p className="my-3 text-xs text-text-2">Sign in to your application here. Your local session is shared with its screens in the designer.</p><webview src={snapshot.localUrl} partition={`persist:project-${project.id}`} className="h-[480px] w-full border border-border"/></details>}
    </>}
    {advanced && <section className="mt-8 border-t border-border pt-4"><h2 className="text-sm font-semibold">Local application · Advanced</h2><nav className="my-3 flex flex-wrap gap-1">{['setup', 'environment', 'data', 'details'].map(tab => <button key={tab} className={`${button} ${panel === tab ? 'bg-selected' : ''}`} onClick={() => setPanel(tab)}>{tab === 'data' ? 'Project data' : tab === 'details' ? 'Technical details' : tab === 'setup' ? 'Settings' : 'Environment'}</button>)}</nav>
      {panel === 'setup' && <><p className="mb-3 break-all font-mono text-xs text-text-2">{snapshot?.localUrl}</p><ol className="divide-y divide-border">{snapshot?.steps.map(step => <li key={step.id} className="py-3"><p className="text-sm font-medium">{step.label}</p><p className="mt-1 text-xs text-text-2">{step.detail}</p></li>)}</ol><label className="my-4 block text-sm">Local database<select value={database} onChange={event => setDatabase(event.target.value as HostingOptions['database'])} className="mt-2 block h-8 w-full rounded border border-border bg-panel px-2 text-sm"><option value="skip">Try opening without local data</option>{!snapshot?.remoteDatabase && <option value="existing">Use existing local database</option>}{snapshot?.steps.find(step => step.id === 'database')?.engines?.map(engine => <option key={engine} value={engine === 'SQLite' ? 'sqlite' : engine === 'PostgreSQL' ? 'postgres' : 'mariadb'}>Create empty local {engine} database</option>)}</select></label><p className="text-xs text-text-3">A new database is empty. Some screens may need sample data. Setup files are never run automatically.</p><button className={`${button} mt-3`} disabled={busy} onClick={() => void inspect(project.id)}>Check again</button></>}
      {panel === 'environment' && <EnvironmentEditor projectId={project.id} onSaved={() => void inspect(project.id)}/>}
      {panel === 'data' && <><p className="mb-3 text-sm text-text-2">Run setup files only when you want to change a FrameUI-managed local database.</p><input aria-label="Confirm project name" placeholder={`Type ${project.name} to confirm`} value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mb-3 h-8 w-full rounded border border-border bg-panel px-2 text-sm"/><button disabled={busy || confirmation !== project.name} className={button} onClick={async () => setOutput(JSON.stringify(await action('migrate', confirmation), null, 2))}>Run setup files</button><pre className="mt-3 overflow-auto text-xs">{output}</pre></>}
      {panel === 'details' && <><button className={button} onClick={async () => { const logs = await action('logs'); const diagnostics = sanitizeDiagnostics({ version: await window.frameui.app.getVersion(), operatingSystem: await window.frameui.app.getPlatform(), project: snapshot?.framework, platform: navigator.platform, state: phase, url: snapshot?.localUrl, steps: snapshot?.steps, error: failure?.detail, events, logs }); await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)); setOutput('Diagnostics copied') }}>Copy diagnostics</button><p className="mt-2 text-xs" role="status">{output}</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-text-2">{failure?.detail}{'\n'}{events.join('\n')}</pre></>}
    </section>}
  </div></main>
}
