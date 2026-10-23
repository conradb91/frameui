import {useState} from 'react'
import {Copy,Download,FileText} from 'lucide-react'
import {PROTOTYPE_INSTRUCTIONS_FILENAME,PROTOTYPE_INSTRUCTIONS_PROMPT} from '@shared/prototypeInstructions'
import {userFacingError} from '../../lib/userFacingError'
import {ModalBody,ModalFooter,ModalHeader,ModalNotice,ModalShell} from '../ui/Modal'

export function PrototypeInstructionsModal({onClose}:{onClose:()=>void}) {
  const [busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[copied,setCopied]=useState(false),[error,setError]=useState('')
  async function download(){
    setBusy(true);setError('');setSaved(false)
    try{setSaved((await window.frameui.project.downloadPrototypeInstructions()).saved)}catch(reason){setError(userFacingError(reason))}finally{setBusy(false)}
  }
  async function copyPrompt(){
    try{await navigator.clipboard.writeText(PROTOTYPE_INSTRUCTIONS_PROMPT);setCopied(true);setError('')}catch(reason){setError(userFacingError(reason))}
  }
  return <ModalShell size="standard" ariaLabel="Claude prototype instructions" critical={busy} onClose={()=>{if(!busy)onClose()}}>
    <ModalHeader title="Create prototypes for FrameUI" description="Give Claude a consistent structure for imports while keeping your existing design system." icon={<FileText size={19}/>} onClose={onClose} closeDisabled={busy}/>
    <ModalBody>
      <ol className="prototype-instructions-steps">
        <li><strong>Download the instructions</strong><p>Save {PROTOTYPE_INSTRUCTIONS_FILENAME} to your computer.</p></li>
        <li><strong>Add the file to Claude</strong><p>Attach it to your Claude project or prototype conversation. In Claude Code, keep it in the project and ask Claude to read it before generating prototypes.</p></li>
        <li><strong>Include this prompt with your brief</strong><p>Your approved colors, typography, spacing and component styling stay the same.</p></li>
      </ol>
      <div className="prototype-instructions-prompt"><p>{PROTOTYPE_INSTRUCTIONS_PROMPT}</p><button type="button" onClick={()=>void copyPrompt()}><Copy size={15}/>{copied?'Prompt copied':'Copy prompt'}</button></div>
      <ModalNotice>Ask for runnable HTML or a ZIP with local assets. When importing, choose Mobile or Desktop, then Simple for pages and navigation or Detailed for interactive states.</ModalNotice>
      {saved&&<ModalNotice tone="success" title="Instructions downloaded">Add the file to Claude with your next prototype brief.</ModalNotice>}
      {error&&<div className="ide-error-toast is-inline" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss instructions error" onClick={()=>setError('')}>×</button></div>}
    </ModalBody>
    <ModalFooter><button type="button" disabled={busy} onClick={onClose}>Close</button><button type="button" className="primary" disabled={busy} onClick={()=>void download()}><Download size={16}/>{busy?'Saving…':'Download instructions'}</button></ModalFooter>
  </ModalShell>
}
