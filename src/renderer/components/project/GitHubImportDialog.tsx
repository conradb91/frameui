import { useEffect, useRef, useState } from 'react'
import type { RecentProject } from '@shared/types/project'
export function GitHubImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (project: RecentProject) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="preparation-dialog" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} aria-labelledby="github-import-title"><form className="p-5" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(false)
    try { const project = await window.frameui.hosting.importGitHub(url); if (project) { onClose(); await onImported(project) } }
    catch { setError(true) } finally { setBusy(false) }
  }}><h2 id="github-import-title" className="text-[17px] font-semibold">Clone from GitHub</h2><p className="mt-2 text-sm text-text-2">Download a public project to your computer. For private projects, open a local folder.</p><label className="mt-4 block text-sm">Project address<input autoFocus required type="url" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/project" className="mt-2 h-8 w-full rounded border border-border bg-input px-2 text-sm"/></label>{error && <p role="alert" className="mt-3 text-sm text-danger">The project could not be downloaded. Check the address, connection and chosen folder, then retry.</p>}<p role="status" className="mt-3 text-xs text-text-3">{busy ? 'Downloading project files…' : 'Your project will be prepared locally before opening.'}</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="h-8 rounded border border-border px-3 text-sm">Cancel</button><button disabled={busy || !url} className="h-8 rounded bg-accent px-3 text-sm text-on-accent disabled:opacity-40">{busy ? 'Downloading…' : 'Choose location & download'}</button></div></form></dialog>
}
