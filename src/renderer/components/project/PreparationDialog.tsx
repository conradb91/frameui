import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { useLocalApplicationStore } from '../../state/localApplicationStore'

const stages = [
  ['copy', 'Creating your local copy'], ['runtime', 'Preparing project components'],
  ['dependencies', 'Preparing the application'], ['environment', 'Preparing local settings'],
  ['start', 'Starting application'], ['verify', 'Checking screens'],
]
export function PreparationDialog() {
  const { busy, phase, snapshot, stage, events } = useLocalApplicationStore()
  const ref = useRef<HTMLDialogElement>(null)
  const [details, setDetails] = useState(false)
  const visible = busy && (phase === 'Preparing' || phase === 'Starting')
  useEffect(() => { if (visible) ref.current?.showModal(); else ref.current?.close() }, [visible])
  const current = Math.max(0, stages.findIndex(([id]) => id === stage))
  return <dialog ref={ref} onCancel={event => event.preventDefault()} aria-labelledby="preparation-title" className="preparation-dialog">
    <div className="p-5"><h2 id="preparation-title" className="text-[17px] font-semibold">Preparing {snapshot?.name}</h2><p className="mt-2 text-sm text-text-2">FrameUI is opening a private local copy of your application.</p>
      <ol className="my-5 space-y-3">{stages.map(([id, title], index) => <li key={id} className={`flex items-center gap-3 text-sm ${index > current ? 'text-text-3' : 'text-text'}`}>{index < current ? <Check size={15} className="text-success"/> : index === current ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none"/> : <span className="h-[15px] w-[15px] rounded-full border border-border"/>}{title}</li>)}</ol>
      <progress className="w-full accent-accent" aria-label="Project preparation" max={stages.length} value={current}/><p role="status" className="mt-2 text-xs text-text-3">{stages[current][1]}… Larger projects may take a few minutes.</p>
      <button className="mt-4 text-xs text-text-2 hover:text-text" onClick={() => setDetails(!details)} aria-expanded={details}>View technical details</button>
      {details && <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap text-xs text-text-2">{events.join('\n') || 'Waiting for progress…'}</pre>}
    </div>
  </dialog>
}
