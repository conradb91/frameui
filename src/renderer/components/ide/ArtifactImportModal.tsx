import {useEffect,useState} from 'react'
import {Check,Clock3,FileArchive,FileCode2,Info,Layers,Link2,Loader2,Monitor} from 'lucide-react'
import {ModalBody,ModalFooter,ModalHeader,ModalProgress,ModalShell} from '../ui/Modal'
import './artifact-import.css'
export interface ArtifactImportStatus {value?:number;detail:string;file?:string;screens?:number;connections?:number;completed?:number;total?:number;preview?:string;previewName?:string}
const steps=[['Read files','Open your prototype'],['Discover flows','Find screens and connections'],['Create screens','Build editable layers'],['Finish','Save your design']]
export function ArtifactImportModal({width=1440,stage,progress,startedAt,onStop,onBackground}: {width?:number;stage:string;progress:ArtifactImportStatus;startedAt:number;onStop:()=>void;onBackground:()=>void}){
 const [elapsed,setElapsed]=useState(()=>Math.max(0,Math.floor((Date.now()-startedAt)/1000)))
 useEffect(()=>{const timer=setInterval(()=>setElapsed(Math.max(0,Math.floor((Date.now()-startedAt)/1000))),1000);return()=>clearInterval(timer)},[startedAt])
 const active=/Stage (\d)/.exec(stage)?.[1]??'1',step=Number(active),zip=/\.zip$/i.test(progress.file??'')
 return <ModalShell size="wide" variant="progress" className="artifact-import-modal" ariaLabel="Importing HTML prototype" critical onClose={onBackground}>
  <ModalHeader title="Importing prototype" description={progress.file??'Choose an HTML file or ZIP to get started.'} icon={zip?<FileArchive size={24}/>:<FileCode2 size={24}/>} onClose={onBackground} closeLabel="Run import in background"/>
  <ModalBody>
   <ol className="artifact-import-steps" aria-label="Import stages">{steps.map(([title,description],index)=><li key={title} data-state={index+1<step?'complete':index+1===step?'active':'pending'} aria-current={index+1===step?'step':undefined}><span className="artifact-import-step-number">{index+1<step?<Check size={16}/>:index+1}</span><span><strong>{title}</strong><small>{description}</small></span></li>)}</ol>
   <section className="artifact-import-panel" aria-label="Import progress">
    <ModalProgress value={progress.value} label={stage} detail={progress.detail}/>
    <div className="artifact-import-content">
     <div className="artifact-import-details">
      <div className="artifact-import-stats"><div><Monitor size={18}/><strong>{progress.screens??'—'}</strong><span>Screens found</span></div><div><Link2 size={18}/><strong>{progress.connections??'—'}</strong><span>Connections</span></div><div><Clock3 size={18}/><strong>{elapsed}s</strong><span>Elapsed</span></div></div>
      <div className="artifact-import-note"><Info size={18}/><div><strong>Desktop capture · {width} px</strong><p>Editable layers and observed flows. Some controls may need a manual capture. Linked resources may load from the internet.</p></div></div>
     </div>
     <figure className="artifact-import-preview">{progress.preview?<><img src={progress.preview} alt={`Latest captured screen: ${progress.previewName??'Prototype'}`}/><figcaption>Latest capture · {progress.previewName}</figcaption></>:<div className="artifact-import-preview-empty"><Layers size={28}/><strong>Your screens, ready to edit</strong><span>A preview appears as screens are captured.</span></div>}</figure>
    </div>
   </section>
  </ModalBody>
  <ModalFooter note={<span role="status">{step===3&&progress.total?`${progress.completed??0} of ${progress.total} screens processed · `:''}{elapsed}s elapsed</span>}><button onClick={onStop}>Stop import</button><button className="primary" onClick={onBackground}>Run in background</button></ModalFooter>
 </ModalShell>
}
export function ArtifactImportBackground({stage,progress,onOpen,onStop}:{stage:string;progress:ArtifactImportStatus;onOpen:()=>void;onStop:()=>void}){
 return <aside className="artifact-import-background" aria-label="Background prototype import"><Loader2 size={18} className="artifact-import-spinner"/><div><strong>Importing prototype</strong><span>{stage} {progress.value!==undefined?`· ${Math.round(progress.value)}%`:''}</span></div><button onClick={onOpen}>View progress</button><button onClick={onStop}>Stop import</button></aside>
}

export function ArtifactImportSetup({width,onClose,onImport}:{width:1440|1920;onClose:()=>void;onImport:(width:1440|1920)=>void}){
 const [selected,setSelected]=useState<1440|1920>(width)
 return <ModalShell size="compact" ariaLabel="Import HTML prototype" onClose={onClose}>
  <ModalHeader title="Import HTML prototype" description="Choose the browser width for your screens, then open an HTML file or ZIP." icon={<FileCode2 size={22}/>} onClose={onClose}/>
  <ModalBody><fieldset className="artifact-import-width"><legend>Artboard width</legend>{([1440,1920] as const).map(value=><label key={value}><input type="radio" name="prototype-width" value={value} checked={selected===value} onChange={()=>setSelected(value)}/><span><strong>{value} px</strong><small>{value===1440?'Standard desktop':'Wide desktop'}</small></span></label>)}</fieldset><p className="muted">The prototype renders at this width before capture. Page height follows its content. XD keeps these dimensions, fonts and captured line breaks.</p></ModalBody>
  <ModalFooter><button onClick={onClose}>Cancel</button><button className="primary" onClick={()=>onImport(selected)}>Choose HTML or ZIP</button></ModalFooter>
 </ModalShell>
}
