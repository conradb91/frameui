import { useEffect, useState } from 'react'
import type { HostingCreatePlan } from '@shared/types/hosting'
import type { RecentProject } from '@shared/types/project'

export function CreateHostedProject({ onClose, onCreated }: { onClose: () => void; onCreated: (project: RecentProject) => Promise<void> }) {
  const [name, setName] = useState('my-project')
  const [framework, setFramework] = useState('Vanilla HTML / JS')
  const [plan, setPlan] = useState<HostingCreatePlan | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState('')
  const [error, setError] = useState('')
  useEffect(() => window.frameui.hosting.onProgress(event => { if (event.projectId === 'creation') setDetail(event.detail) }), [])
  async function review() {
    setBusy(true); setError('')
    try { setPlan(await window.frameui.hosting.planCreate(name, framework)); setApproved(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function create() {
    if (!plan || !approved) return
    setBusy(true); setError(''); setDetail('Creating the project. Initial downloads and installation may take several minutes…')
    try { const project = await window.frameui.hosting.create(plan.token); await onCreated(project); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPlan(null) }
    finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"><section role="dialog" aria-modal="true" aria-label="Create application project" className="w-full max-w-lg rounded-xl border border-border bg-panel p-6"><h2 className="text-lg font-semibold">Create a project</h2><p className="mt-2 text-sm text-text-2">FrameUI creates the application files with Stacker’s framework tools, then guides you through local hosting.</p><label className="mt-4 block text-xs">Project name<input autoFocus disabled={busy || !!plan} value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded border border-border bg-bg p-2 text-sm"/></label><label className="mt-4 block text-xs">Application type<select disabled={busy || !!plan} value={framework} onChange={e => setFramework(e.target.value)} className="mt-1 block w-full rounded border border-border bg-bg p-2 text-sm">{['Vanilla HTML / JS', 'React + Vite', 'Next.js', 'Laravel', 'CodeIgniter 4'].map(value => <option key={value}>{value}</option>)}</select></label>{plan && <div className="my-4 rounded border border-border p-3 text-xs leading-relaxed"><p>{plan.location}</p><p className="mt-2">{plan.detail}</p><label className="mt-3 flex gap-2"><input type="checkbox" disabled={busy} checked={approved} onChange={e => setApproved(e.target.checked)}/>Create these files and allow the required runtime downloads and framework installation scripts. Database setup follows separately.</label></div>}{busy && <p role="status" className="my-4 text-xs text-text-2">{detail || 'Preparing project review…'}</p>}{error && <p role="alert" className="my-4 text-sm text-danger">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={onClose} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-40">Cancel</button>{plan ? <button disabled={busy || !approved || plan.blocked} onClick={() => void create()} className="rounded bg-accent px-3 py-2 text-sm text-on-accent disabled:opacity-40">Create application</button> : <button disabled={busy || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)} onClick={() => void review()} className="rounded bg-accent px-3 py-2 text-sm text-on-accent disabled:opacity-40">Choose location & review</button>}</div></section></div>
}
