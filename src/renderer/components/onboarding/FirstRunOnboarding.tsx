import { useEffect, useState } from 'react'
import { Code2, Globe, ScanLine, Sparkles } from 'lucide-react'
import { ModalBody, ModalFooter, ModalHeader, ModalShell } from '../ui/Modal'

const OPEN_EVENT = 'frameui:open-onboarding'
// Guidance is available on demand. First launch opens directly into the workspace.
// eslint-disable-next-line react-refresh/only-export-components
export function openFirstRunOnboarding() { window.dispatchEvent(new Event(OPEN_EVENT)) }

export function FirstRunOnboarding() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [])
  if (!open) return null
  return <ModalShell size="standard" ariaLabel="Getting started with FrameUI" onClose={() => setOpen(false)}>
    <ModalHeader title="From your product to your next idea" description="A familiar design canvas, informed by your existing application." onClose={() => setOpen(false)}/>
    <ModalBody><ol className="studio-guide-steps">
      <li><Code2 size={18}/><div><strong>Open your repository</strong><p>Your components, tokens and assets become the starting point.</p></div></li>
      <li><Globe size={18}/><div><strong>Connect your running app</strong><p>Use localhost, or verify a hosted domain with the supplied file.</p></div></li>
      <li><ScanLine size={18}/><div><strong>Capture the pages you need</strong><p>Bring real screens into the canvas as editable layers.</p></div></li>
      <li><Sparkles size={18}/><div><strong>Explore, prototype and approve</strong><p>Build flows yourself or with Claude. Test drafts before importing them.</p></div></li>
    </ol></ModalBody>
    <ModalFooter><button className="primary" onClick={() => setOpen(false)}>Back to workspace</button></ModalFooter>
  </ModalShell>
}
