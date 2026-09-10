import { useEffect, useState } from 'react'
import type { HostingEnvironment } from '@shared/types/hosting'

export function EnvironmentEditor({ projectId, onSaved }: { projectId: string; onSaved: () => void }) {
  const [data, setData] = useState<HostingEnvironment | null>(null)
  const [changes, setChanges] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [newKey, setNewKey] = useState('')
  useEffect(() => {
    let cancelled = false
    window.frameui.hosting.readEnvironment(projectId).then(value => { if (!cancelled) setData(value) }).catch(cause => { if (!cancelled) setError(String(cause.message ?? cause)) })
    return () => { cancelled = true }
  }, [projectId])
  async function save() {
    if (!data?.file) return
    setSaving(true); setError('')
    try { setData(await window.frameui.hosting.updateEnvironment(projectId, data.file, Object.entries(changes).map(([key, value]) => ({ key, value })))); setChanges({}); onSaved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  const fields = [...(data?.variables ?? []), ...Object.keys(changes).filter(key => !data?.variables.some(v => v.key === key)).map(key => ({ key, value: '', secret: /password|token|secret|key/i.test(key), configured: false }))]
  return <section className="rounded-xl border border-border bg-panel p-5"><h2 className="text-sm font-semibold">Project configuration {data?.file && `· ${data.file}`}</h2><p className="my-3 text-xs leading-relaxed text-text-2">Set database connection details and other required values. Existing secrets stay hidden and are preserved unless you replace them. Saving creates a backup of this file. Restart the application after changes.</p>{error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}{data && !data.file && <p className="text-sm text-text-2">No environment file was detected. Complete the environment creation step in Setup first.</p>}<div className="space-y-3">{fields.map(field => <label key={field.key} className="block text-xs text-text-2">{field.key}<input disabled={saving} type={field.secret ? 'password' : 'text'} autoComplete="off" value={changes[field.key] ?? field.value} placeholder={field.secret && field.configured ? 'Stored secret · leave unchanged to preserve' : 'Value'} onChange={e => setChanges(values => ({ ...values, [field.key]: e.target.value }))} className="mt-1 block w-full rounded border border-border bg-bg px-3 py-2 text-sm"/></label>)}</div>{data?.file && <><div className="my-4 flex gap-2"><input aria-label="New configuration key" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Add configuration key" className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm"/><button disabled={!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(newKey) || saving} onClick={() => { if (!fields.some(f => f.key === newKey)) setChanges(values => ({ ...values, [newKey]: '' })); setNewKey('') }} className="rounded border border-border px-3 text-sm disabled:opacity-40">Add</button></div><button disabled={saving || !Object.keys(changes).length} onClick={() => void save()} className="rounded-lg bg-accent px-4 py-2 text-sm text-on-accent disabled:opacity-40">{saving ? 'Saving…' : 'Back up & save configuration'}</button></>}</section>
}
