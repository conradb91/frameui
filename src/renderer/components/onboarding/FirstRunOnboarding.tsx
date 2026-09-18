import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowRight, Check, ChevronLeft, Code2, Component, FolderOpen, Layers3, LockKeyhole, MousePointer2, PanelsTopLeft, ScanLine, Share2, Sparkles, Wand2 } from 'lucide-react'
import { ModalShell } from '../ui/Modal'
import './first-run-onboarding.css'

const COMPLETED_KEY = 'onboardingCompleted'
const OPEN_EVENT = 'frameui:open-onboarding'

const steps = [
  {
    title: 'Your code.\nA new canvas.',
    description: 'FrameUI turns your existing application into an editable design workspace. Your pages, components, styles and design rules stay connected to the project you already built.',
    points: [
      'Start from your existing codebase.',
      'Preview the application running locally.',
      'Create editable designs without rebuilding screens from scratch.',
    ],
  },
  {
    title: 'Start with the\nreal thing.',
    description: 'Connect the local version of your project and FrameUI can inspect the rendered application together with the files already inside your project.',
    points: [
      'FrameUI uses your local project, not a public website.',
      'Routes and screens can be discovered from the running application.',
      'Project CSS, fonts and assets help reproduce the real interface.',
    ],
  },
  {
    title: 'Make room for\nyour next idea.',
    description: 'Open a page as an editable design. Select elements directly on the canvas, move them, resize them and change their visual properties while keeping the structure of the original interface.',
    points: [
      'Click text and edit it directly in place.',
      'Drag and resize elements on the canvas.',
      'Use typography, spacing and colours found in your project.',
      'Switch between desktop, tablet and mobile layouts.',
    ],
  },
  {
    title: 'Good design.\nReady to go.',
    description: 'Package frames, components, variables and assets from the same workspace. Review the scope before export, then move the design into Figma or your development workflow.',
    points: [
      'Export full files or the current selection.',
      'Keep text, hierarchy and visual properties editable.',
      'Reuse project components and design variables.',
      'Share a clean, structured design package.',
    ],
  },
] as const

// Called by the editor's Help action as well as this component's first-run flow.
// eslint-disable-next-line react-refresh/only-export-components
export function openFirstRunOnboarding() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

const art = [
  { label: 'A new perspective', title: 'Built in code.\nMade for possibility.', note: 'Your next idea starts with what you already built.', Icon: Layers3, satellites: [Code2, Component, Sparkles, FolderOpen] },
  { label: 'Stay connected', title: 'Your world.\nIn perfect context.', note: 'Real screens. Real styles. One connected workspace.', Icon: ScanLine, satellites: [LockKeyhole, Code2, FolderOpen, Component] },
  { label: 'Make it yours', title: 'Less rebuilding.\nMore creating.', note: 'A little precision. A whole new direction.', Icon: MousePointer2, satellites: [Wand2, Layers3, Component, Sparkles] },
  { label: 'Keep moving', title: 'Great ideas\ntravel well.', note: 'From your first adjustment to your next handoff.', Icon: Share2, satellites: [Component, Layers3, Code2, Sparkles] },
]

function AbstractVisual({ step }: { step: number }) {
  const { label, title, note, Icon, satellites } = art[step]
  return <div className={`onboarding-art onboarding-art--${step + 1}`} data-onboarding-visual-step={step + 1}>
    <div className="onboarding-art-top"><span>FRAMEUI / CREATIVE WORKSPACE</span><span>0{step + 1}</span></div>
    <div className="onboarding-sculpture" aria-hidden="true">
      <div className="onboarding-disc" /><div className="onboarding-disc-inner" />
      <svg className="onboarding-orbit-lines" viewBox="0 0 600 600" fill="none">
        <circle cx="300" cy="300" r="245" stroke="currentColor" strokeWidth=".7" />
        <circle cx="300" cy="300" r="185" stroke="currentColor" strokeWidth=".5" />
        {Array.from({length:60},(_,i)=><path key={i} d={`M 300 ${i%5===0?49:58} V 69`} transform={`rotate(${i*6} 300 300)`} stroke="currentColor" strokeWidth={i%5===0?2:1} />)}
      </svg>
      <div className="onboarding-glass-stack"><i /><i /><div><Icon strokeWidth={1.15} /></div></div>
      {satellites.map((Satellite, index)=><span key={index} className="onboarding-orbit-tile" style={{'--tile':index} as CSSProperties}><Satellite strokeWidth={1.25} /></span>)}
      <span className="onboarding-art-spark">✳</span>
    </div>
    <div className="onboarding-art-caption"><span>{label}</span><h3>{title}</h3><p>{note}</p></div>
    <div className="onboarding-art-bottom"><span>CREATE WITH CONTEXT</span><span>↗</span></div>
  </div>
}

export function FirstRunOnboarding() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(COMPLETED_KEY) !== 'true' } catch { return true }
  })
  const [step, setStep] = useState(0)

  useEffect(() => {
    const reopen = () => { setStep(0); setOpen(true) }
    window.addEventListener(OPEN_EVENT, reopen)
    return () => window.removeEventListener(OPEN_EVENT, reopen)
  }, [])

  if (!open) return null
  const current = steps[step]
  const complete = () => {
    try { localStorage.setItem(COMPLETED_KEY, 'true') } catch { /* local storage may be unavailable */ }
    setOpen(false)
  }

  return (
    <ModalShell size="wide" variant="information" className="frame-onboarding" ariaLabel="Welcome to FrameUI" closeOnEscape={false}>
      <div className="frame-onboarding-layout">
        <section className="frame-onboarding-copy">
          <header>
            <div className="frame-onboarding-brand"><PanelsTopLeft size={18} /><strong>FrameUI</strong></div>
            {step < 3 && <button type="button" className="frame-onboarding-skip" onClick={complete}>Skip introduction</button>}
          </header>
          <div className="frame-onboarding-content" aria-live="polite">
            <span className="frame-onboarding-step">{String(step + 1).padStart(2, '0')} / 04</span>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
            <ul>{current.points.map((point) => <li key={point}><Check size={14} /> <span>{point}</span></li>)}</ul>
          </div>
          <footer className="frame-onboarding-navigation">
            <div className="frame-onboarding-progress" aria-label={`Step ${step + 1} of 4`}>{steps.map((_, index) => <i key={index} className={index <= step ? 'is-complete' : ''} />)}</div>
            <div>
              {step > 0 && <button type="button" className="frame-onboarding-back" onClick={() => setStep(step - 1)}><ChevronLeft size={14} /> Back</button>}
              <button type="button" className="frame-onboarding-next" onClick={() => step === 3 ? complete() : setStep(step + 1)}>{step === 3 ? 'Open FrameUI' : 'Continue'} <ArrowRight size={14} /></button>
            </div>
          </footer>
        </section>
        <section className="frame-onboarding-demo" aria-label={`Abstract illustration: ${art[step].label}`}><AbstractVisual step={step} /></section>
      </div>
    </ModalShell>
  )
}
