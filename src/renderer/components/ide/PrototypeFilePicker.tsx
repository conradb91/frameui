import {useState} from 'react'
import {FileArchive,FileCode2,Upload,X} from 'lucide-react'
export function PrototypeFilePicker({files,disabled,onBrowse,onDrop,onRemove}:{files:string[];disabled:boolean;onBrowse:()=>void;onDrop:(files:File[])=>void;onRemove:(file:string)=>void}){
 const [dragging,setDragging]=useState(false)
 return <section className="prototype-file-picker" aria-label="Prototype files">
  <strong>Select your files to import · ZIP or HTML</strong>
  <div className="prototype-file-drop" data-dragging={dragging} onDragOver={event=>{event.preventDefault();if(!disabled){event.dataTransfer.dropEffect='copy';setDragging(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}} onDrop={event=>{event.preventDefault();setDragging(false);if(!disabled)onDrop(Array.from(event.dataTransfer.files))}}>
   <Upload size={22} aria-hidden="true"/><span>Drag HTML or ZIP files here</span><button type="button" disabled={disabled} onClick={onBrowse}>{files.length?'Add more files':'Select files'}</button>
  </div>
  {!!files.length&&<><small>{files.length} {files.length===1?'file':'files'} added · Processed one at a time</small><ul aria-label="Selected prototype files">{files.map(file=>{const name=file.split(/[\\/]/).pop()||file,Icon=/\.zip$/i.test(name)?FileArchive:FileCode2;return <li key={file}><Icon size={17} aria-hidden="true"/><span title={file}>{name}</span><button type="button" disabled={disabled} aria-label={'Remove '+name} title="Remove file" onClick={()=>onRemove(file)}><X size={16}/></button></li>})}</ul></>}
 </section>
}
