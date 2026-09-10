import { preparationFailure } from '@shared/diagnostics'
import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, CircleAlert, FolderOpen } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import type { IndexProgressStep } from '@shared/types/projectIndex'

const stages: { title: string; detail: string; completed: IndexProgressStep[] }[] = [
  { title: 'Check your project', detail: 'Checking saved work and looking for changed files.', completed: ['detecting'] },
  { title: 'Find screens and components', detail: 'Reading your app’s pages and reusable interface elements.', completed: ['pages', 'components'] },
  { title: 'Collect your design system', detail: 'Finding colors, typography and styles from your app.', completed: ['tokens'] },
  { title: 'Prepare your workspace', detail: 'Organizing screens and connecting them to their source.', completed: ['model', 'dependencies'] },
  { title: 'Save and open', detail: 'Saving locally so future opens can reuse this work.', completed: ['done'] },
]

export function ProjectProgressModal({ opening, error, onDismiss }: { opening: boolean; error: string | null; onDismiss: () => void }) {
  const project = useProjectStore((s) => s.activeProject)
  const indexing = useProjectStore((s) => s.indexing)
  const steps = useProjectStore((s) => s.indexProgress)
  const indexError = useProjectStore((s) => s.indexError)
  const dialog = useRef<HTMLDialogElement>(null)
  const [seconds, setSeconds] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const visible = opening || indexing || !!error || !!indexError
  const failure = error ?? indexError
  useEffect(() => {
    if (!visible) { dialog.current?.close(); return }
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [visible])
  useEffect(() => {
    setSeconds(0)
    if (!opening && !indexing) return
    const started = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [opening, indexing])
  const selecting = opening && !indexing
  const done = steps.includes('done')
  const active = done ? stages.length : stages.findIndex((stage) => !stage.completed.every((step) => steps.includes(step)))
  const waiting = !selecting && steps.length === 0
  const slow = seconds >= 15 && !selecting
  async function leave() {
    try { await useProjectStore.getState().closeProject(); setActionError(null); onDismiss() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!selecting) void leave() }} aria-labelledby="project-progress-title" aria-describedby="project-progress-description" className="m-auto w-[560px] max-w-[calc(100vw-32px)] rounded-lg border border-border bg-panel p-0 text-text shadow-2xl outline-none backdrop:bg-black/30">
    <div className="p-5">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">{failure ? <CircleAlert size={22} className="text-danger" /> : <FolderOpen size={22} />}</div>
        <div><p className="mb-1 text-xs text-text-3">{project?.name ?? 'FrameUI project'}</p><h2 id="project-progress-title" className="text-lg font-semibold">{failure ? 'Project preparation stopped' : selecting ? 'Choose your project folder' : 'Getting your app ready to design'}</h2></div>
      </div>
      <p id="project-progress-description" className="text-sm leading-relaxed text-text-2">{selecting ? 'Select the folder containing your application. FrameUI will find its screens, components and styles.' : 'FrameUI reads your app to create Current Application and discover reusable components and styles. Your source files stay unchanged.'}</p>
      {!selecting && <>
        <div className="mt-6 flex items-center justify-between text-xs"><span className="font-medium">{done ? 'Ready to open' : `Step ${active + 1} of ${stages.length}`}</span><span className="text-text-3">{seconds}s elapsed</span></div>
        <div className="mt-2 flex gap-1.5" aria-label={`${active} of ${stages.length} steps completed`}>{stages.map((stage, i) => <span key={stage.title} className={`h-1.5 flex-1 rounded-full ${i < active ? 'bg-accent' : 'bg-border'}`} />)}</div>
        <ol className="my-5 space-y-4">{stages.map((stage, i) => <li key={stage.title} className="flex gap-3">
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${i <= active ? 'bg-accent/10 text-accent' : 'bg-bg text-text-3'}`}>{i < active ? <Check size={14} /> : i === active ? failure ? <CircleAlert size={14} /> : <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : i + 1}</span>
          <div><p className={`text-sm ${i === active ? 'font-semibold' : 'text-text-2'}`}>{stage.title}</p>{i === active && <p className="mt-1 text-xs leading-relaxed text-text-3">{waiting ? 'Starting the project reader. File discovery begins next.' : stage.detail}</p>}</div>
        </li>)}</ol>
        <div role="status" aria-live="polite" className={`rounded-lg border p-3 text-xs leading-relaxed ${failure || slow ? 'border-warning/40 bg-warning/5' : 'border-border bg-bg'}`}>
          {failure ? preparationFailure(failure).message : slow ? 'Preparation is taking longer than expected. Large projects and slower disks need more time. You can return to projects and try again if this step stops advancing.' : 'Allow a few seconds for a small project; larger apps may take a minute or more. Time depends on file count and disk speed. Later opens reuse saved results.'}
        </div>
      </>}
      {actionError && <p role="alert" className="mt-3 text-xs text-danger">{actionError}</p>}
    </div>
    {!selecting && <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4"><span className="text-xs text-text-3">Processed locally on your computer</span><div className="flex gap-2"><button className="rounded-lg border border-border px-3 py-2 text-xs" onClick={() => void leave()}>Back to projects</button>{indexError && !error && <button className="rounded-lg bg-accent px-3 py-2 text-xs text-on-accent" onClick={() => void useProjectStore.getState().fetchIndex()}>Retry</button>}</div></div>}
  </dialog>
}
