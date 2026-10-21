import {formatElapsed} from '../../lib/formatElapsed'
import { useEffect, useState } from 'react'
import { Check, Clock3, Monitor } from 'lucide-react'
import type { CaptureStage } from '@shared/types/visualDesign'
import { ModalBody, ModalFooter, ModalHeader, ModalProgress, ModalShell } from '../ui/Modal'
import './artifact-import.css'

const stages: { id: CaptureStage; title: string; detail: string }[] = [
  { id: 'layout', title: 'Read page', detail: 'Reading layout and styles' },
  { id: 'screenshot', title: 'Capture page', detail: 'Capturing the full page' },
  { id: 'assets', title: 'Collect assets', detail: 'Preserving fonts, images and icons' },
  { id: 'building', title: 'Create screen', detail: 'Building editable layers' },
]

export function CaptureProgressModal({ stage, width, name, address, onStop }: {
  stage: CaptureStage; width: number; name: string; address: string; onStop: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  const active = Math.max(0, stages.findIndex(item => item.id === stage))
  return <ModalShell size="wide" variant="progress" className="artifact-import-modal capture-progress-modal" ariaLabel="Creating editable design" critical>
    <ModalHeader title="Creating editable design" description={address} icon={<Monitor size={24} />} />
    <ModalBody>
      <ol className="artifact-import-steps" aria-label="Capture stages">
        {stages.map((item, index) => <li key={item.id} data-state={index < active ? 'complete' : index === active ? 'active' : 'pending'} aria-current={index === active ? 'step' : undefined}>
          <span className="artifact-import-step-number">{index < active ? <Check size={16} /> : index + 1}</span>
          <span><strong>{item.title}</strong><small>{item.detail}</small></span>
        </li>)}
      </ol>
      <section className="artifact-import-panel" aria-label="Capture progress">
        <ModalProgress label={`Stage ${active + 1} of ${stages.length} · ${stages[active].detail}`} detail="Your screen will appear on the canvas when capture finishes." />
        <div className="capture-progress-summary"><Monitor size={18} /><div><strong>{name}</strong><span>{width} px wide · Height follows page content</span></div><Clock3 size={16} /><span>{formatElapsed(elapsed)}</span></div>
      </section>
    </ModalBody>
    <ModalFooter note="Keep this page open while FrameUI captures its design."><button disabled={stopping} onClick={() => { setStopping(true); onStop() }}>{stopping ? 'Stopping…' : 'Stop capture'}</button></ModalFooter>
  </ModalShell>
}
