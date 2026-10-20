import {defaultDesignSettings,approachOptions,designStructure,resolveDesignSettings,type AiDesignSettings,type DesignApproach} from '@shared/aiDesign'
import {DeveloperHandoff} from './prototype/DeveloperHandoff'
import { PrototypeStudio } from './prototype/LazyWorkspaces'
import type { PrototypeDraft,PrototypeTarget } from '@shared/types/prototype'
import { userFacingError } from '../../lib/userFacingError'
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUp, MessageSquare, Paperclip, Plus, Settings2, Square, X, FileText, ChevronDown, Check } from 'lucide-react'
import type { VisualDocument } from '@shared/types/visualDesign'
import type { AiResult, ClaudeStatus } from '@shared/types/ai'

export function ClaudePanel({document,pageId,selection,onDocument,onCapture,flowId,onWorkspaceChange}:{document:VisualDocument;pageId:string;selection:string[];flowId?:string;onWorkspaceChange?:(open:boolean)=>void;onDocument:(doc:VisualDocument)=>void;onCapture:()=>void}) {
  const [studioSelected,setStudioSelected]=useState<string>(),[studioScope,setStudioScope]=useState<'prototype'|'screen'>('prototype')
  const [draft,setDraft]=useState<PrototypeDraft|null>(null),[drafts,setDrafts]=useState<PrototypeDraft[]>([]),[draftOpen,setDraftOpen]=useState(false),[target,setTarget]=useState<PrototypeTarget>({kind:'artboard'}),[revisionPageId,setRevisionPageId]=useState<string>()
  useEffect(()=>{void window.frameui.prototype.list(document.id).then(setDrafts).catch(()=>{})},[document.id])
  const [status,setStatus]=useState<ClaudeStatus|null>(null)
  useEffect(()=>{onWorkspaceChange?.(draftOpen&&!!draft&&!!status?.connected);return()=>onWorkspaceChange?.(false)},[draftOpen,draft,status?.connected,onWorkspaceChange])
  const [busy,setBusy]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState('')
  const [chat,setChat]=useState<{role:'user'|'assistant';content:string;reference?:string}[]>([])
  const [streamText,setStreamText]=useState(''),[settingsOpen,setSettingsOpen]=useState(false)
  const transcript=useRef<HTMLDivElement>(null),attachment=useRef<HTMLInputElement>(null),composer=useRef<HTMLTextAreaElement>(null)
  const [workspace,setWorkspace]=useState('')
  const [loading,setLoading]=useState(true)
  const [design,setDesign]=useState<AiDesignSettings>(()=>defaultDesignSettings())
  const structure=designStructure(design)
  useEffect(()=>{if(draft)setDesign(resolveDesignSettings(draft.versions[draft.currentVersion]?.design??draft.design))},[draft])
  function changeApproach(approach:DesignApproach){setDesign(defaultDesignSettings(approach));if(!draft&&approach==='create')setTarget(previous=>({kind:previous.kind==='flow'||previous.kind==='new-flow'?'new-flow':'new-artboard'}));else if(!draft&&approach!=='create')setTarget({kind:'artboard',id:pageId})}
  const [prompt,setPrompt]=useState(''),[mode]=useState<'design'>('design'),[style,setStyle]=useState<'project'|'reference'>('project')
  const [reference,setReference]=useState<string>(),[activities,setActivities]=useState<string[]>([]),[result,setResult]=useState<AiResult|null>(null)
  const [handoffOpen,setHandoffOpen]=useState(false)
  useEffect(()=>{if(!draft&&flowId)setTarget({kind:'flow',id:flowId})},[flowId,draft])
  const previousPage=useRef(pageId)
  useEffect(()=>{if(!draft&&previousPage.current!==pageId)setTarget({kind:'artboard',id:pageId});previousPage.current=pageId},[pageId,draft])
  useEffect(()=>{let alive=true;window.frameui.ai.status().then(s=>{if(alive)setStatus(s)}).catch(e=>{if(alive)setError(userFacingError(e))}).finally(()=>{if(alive)setLoading(false)});const off=window.frameui.ai.onActivity(a=>{if(a.kind==='text')setStreamText(text=>text+a.message);else setActivities(previous=>[...previous.slice(-29),a.message])});return()=>{alive=false;off();void window.frameui.ai.cancel()}},[])
  useEffect(()=>{const el=transcript.current;if(el)el.scrollTop=el.scrollHeight},[chat,streamText,activities,error])
  async function task(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action()}catch(e){setError(userFacingError(e))}finally{setBusy(false)}}
  async function attachImage(file:File){
    if(busy)return
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Choose a PNG, JPEG or WebP image.');return}
    if(file.size>5_000_000){setError('Choose an image smaller than 5 MB.');return}
    try{
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read this image. Try attaching it again.'));reader.readAsDataURL(file)})
      const image=new Image();image.src=data;await image.decode()
      if(image.naturalWidth*image.naturalHeight>20_000_000)throw new Error('Choose a reference image smaller than 20 megapixels.')
      setReference(data);setError('');composer.current?.focus()
    }catch(e){setError(userFacingError(e))}
  }
  async function run(){
    if(busy||draft?.status==='imported'||(!prompt.trim()&&!reference))return
    if(!draft&&target.kind==='flow'&&!flowId){setError('Select a flow in the Flow Builder first.');return}
    const effectivePageId=draftOpen?(studioSelected??revisionPageId??pageId):(revisionPageId??pageId)
    const current=draft?.versions[draft.currentVersion]?.document
    const scopeIds=draft?[...new Set([...(draft.target.kind==='artboards'?draft.target.ids??[]:draft.target.kind==='artboard'?[draft.target.id??pageId]:draft.target.kind==='flow'?draft.base.prototype?.flows.find(f=>f.id===draft.target.id)?.artboardIds??[]:[]),...(current?.pages.filter(p=>JSON.stringify(draft.base.pages.find(b=>b.id===p.id))!==JSON.stringify(p)).map(p=>p.id)??[]),effectivePageId])]:[]
    const requestTarget:PrototypeTarget=draftOpen&&draft?(studioScope==='screen'?{kind:'artboard',id:effectivePageId}:{kind:'artboards',ids:scopeIds}):draft?.target??{...target,id:target.kind==='artboard'?pageId:target.kind==='flow'?flowId:undefined}
    const submittedReference=reference,message=prompt.trim()||'Use this image as a reference to improve the selected design.',history=chat.slice(-12).map(m=>({...m,content:m.content.slice(0,12000)}))
    setChat(previous=>[...previous,{role:'user',content:message,reference:submittedReference}]);setReference(undefined);setPrompt('');setStreamText('');setResult(null);setActivities([]);setRunning(true);
    if(composer.current)composer.current.style.height='72px'
    await task(async()=>{
      const next=await window.frameui.ai.run({document,pageId:effectivePageId,selection:draftOpen?[]:selection,prompt:message,history,mode,style,structure,design,reference:submittedReference,draftId:draft?.id,revisionPageId:draftOpen?(studioScope==='screen'?effectivePageId:undefined):revisionPageId,target:requestTarget})
      setResult(next);setChat(previous=>[...previous,{role:'assistant',content:next.message}]);setStreamText('');if(next.draft){setDraft(next.draft);setDraftOpen(mode==='design');setDrafts(previous=>[next.draft!,...previous.filter(d=>d.id!==next.draft!.id)])}
    })
    setRunning(false);void window.frameui.prototype.list(document.id).then(items=>{setDrafts(items);if(draft)setDraft(items.find(d=>d.id===draft.id)??null);else{const recovered=items.find(d=>d.status==='failed'&&d.currentVersion>=0);if(recovered)setDraft(recovered)}})
  }
  const page=document.pages.find(p=>p.id===pageId)
  if (!status?.connected) return <section className="ide-claude-panel ide-claude-welcome" aria-label="Claude assistant">
    <h2>Design with Claude</h2>
    <p>Design, test and refine a prototype with your project’s components.</p>
    {loading ? <p role="status">Checking your connection…</p> : <>
      <div className="ide-claude-login-card">
        <h3>Connect Claude Code</h3>
        <p>Connect Claude Code to use your subscription and available usage limits.</p>
        <button aria-label="Sign in through Claude Code" className="ide-claude-primary" disabled={busy||!status?.claudeCodeAvailable} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.connect('claude-code-login')))}>Sign in to Claude</button>
        <button aria-label="Use existing Claude Code login" disabled={busy||!status?.claudeCodeAvailable} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.connect('claude-code')))}>Use current login</button>
        {!status?.claudeCodeAvailable&&<><p>Install Claude Code separately using Anthropic’s setup guide, then return to sign in.</p><button disabled={busy} onClick={()=>void window.frameui.preview.openExternal('https://code.claude.com/docs/en/setup')}>Open setup guide ↗</button><button disabled={busy} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.status()))}>Check again</button></>}
        <p className="ide-muted">Sign-in opens Anthropic’s authentication through your installed Claude Code. FrameUI never reads your account credentials.</p>
      </div>
      <details><summary>Use an API key instead</summary><div className="ide-claude-login-card">
        <h3>Connect your Anthropic account</h3>
        <p>Use an Anthropic Console API key. API usage is billed directly to your Anthropic account.</p>
        <button className="ide-claude-primary" disabled={busy} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.connect('api-key',workspace.trim()||undefined)))}>Connect Claude</button>
        <button disabled={busy} onClick={()=>void task(async()=>{await window.frameui.preview.openExternal('https://platform.claude.com/settings/keys')})}>Get an API key in Console ↗</button>
        <p className="ide-muted">A secure system dialog will ask for your key. FrameUI stores it in your computer’s credential manager.</p>
        <details><summary>Workspace settings (optional)</summary><label>Workspace ID<input placeholder="wrkspc_…" value={workspace} onChange={e=>setWorkspace(e.target.value)} disabled={busy}/></label><p>Only needed when your key requires a specific workspace.</p></details>
      </div>
      </details>
      {status?.cliAvailable && <div className="ide-claude-login-card"><h3>Already using the Anthropic CLI?</h3><p>Connect the official ant CLI’s frameui profile.</p><button disabled={busy} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.connect('cli')))}>Use existing Anthropic CLI login</button>{status.browserLoginAvailable&&<button disabled={busy} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.connect('cli-login')))}>Connect with Browser</button>}</div>}

      {!status&&<button disabled={busy} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.status()))}>Retry connection check</button>}
    </>}
    {busy&&<p role="status">Connecting… Complete the sign-in or secure key dialog to continue.</p>}
    {error&&<p role="alert" className="ide-claude-error">{error}</p>}
  </section>
  const chatView=<section className="ide-claude-panel ide-claude-chat" aria-label="Claude assistant">
    <header className="claude-chat-header">
      <div className="claude-chat-title"><MessageSquare size={15}/><strong>Claude</strong><span className="claude-connected" title="Connected" aria-label="Connected"/></div>
      <div className="claude-header-actions">
        <button aria-label="New chat" title="New chat" disabled={busy} onClick={()=>{setDraft(null);setDraftOpen(false);setRevisionPageId(undefined);setChat([]);setResult(null);setActivities([]);setStreamText('');setError('');setReference(undefined);setPrompt('')}}><Plus size={16}/></button>
        <button aria-label="Provider settings" title="Chat settings" aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(!settingsOpen)}><Settings2 size={15}/></button>
      </div>
    </header>
    {settingsOpen&&<div className="claude-chat-settings">
      <strong>Chat settings</strong>
      <p>{status.authentication==='claude-code'?'Connected through Claude Code. Your account’s usage limits apply.':'Connected to Anthropic Console. API billing applies.'}</p>
      <label>Reference style<select value={style} disabled={busy} onChange={e=>setStyle(e.target.value as typeof style)}><option value="project">Use project assets and conventions</option><option value="reference">Match attached reference</option></select></label>
      <p>Your design approach is available above the message field. Every approach uses your project’s design foundation.</p>
      <button disabled={busy} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.status()))}>Refresh models</button>
      <button disabled={busy} onClick={()=>void task(async()=>setStatus(await window.frameui.ai.disconnect()))}>Disconnect</button>
    </div>}
    {!draft&&!!document.prototype?.imports.length&&<div className="claude-handoff"><strong>Ready to hand off</strong><p>Share the approved design, flows and component references with your development team.</p><button disabled={busy} onClick={()=>setHandoffOpen(true)}>Export developer handoff</button><small>Built for Claude Code in your developer’s repository.</small></div>}
    {handoffOpen&&<DeveloperHandoff document={document} onClose={()=>setHandoffOpen(false)}/>}
    {draft&&!draftOpen&&<div className="claude-draft-banner"><span>Draft · {draft.versions[draft.currentVersion]?.document.pages.find(p=>p.id===(revisionPageId??draft.target.id))?.name??draft.base.prototype?.flows.find(f=>f.id===draft.target.id)?.name??draft.target.kind.replace('-',' ')}</span><button onClick={()=>setDraftOpen(true)}>Open prototype</button>{(draft.status==='failed'||draft.versions[draft.currentVersion]?.message.startsWith('Draft paused'))&&<button disabled={busy} onClick={()=>{setPrompt('Continue this saved prototype. Inspect existing screens and interactions first, complete the remaining requested work, validate the flow and render before finishing. Preserve completed work.');composer.current?.focus()}}>Continue draft</button>}</div>}
    {!draft&&!!drafts.length&&<details className="claude-draft-history"><summary>Saved proposals · {drafts.length}</summary>{drafts.map(d=><button key={d.id} onClick={()=>{setDraft(d);setChat(d.conversation);setDraftOpen(true)}}>{d.conversation[0]?.content.slice(0,60)??'Prototype'} · {d.status}</button>)}</details>}
    <div className="claude-chat-transcript" ref={transcript} role="log" aria-label="Conversation" aria-live="polite">
      {!chat.length&&<div className="claude-chat-empty">
        <div className="claude-empty-icon"><MessageSquare size={23} strokeWidth={1.5}/></div>
        <h2>What are we building?</h2>
        <p>Explore new designs with your project’s technical foundation.</p>
        <div className="claude-suggestions">
          <button onClick={()=>{setPrompt('Improve this screen’s layout, spacing, and visual hierarchy.');composer.current?.focus()}}>Improve this screen <span>↗</span></button>
          <button onClick={()=>{setPrompt('Create a new screen using my project’s existing components and styles.');composer.current?.focus()}}>Create a new screen <span>↗</span></button>
          <button onClick={()=>{setPrompt('Review this screen and suggest improvements before changing anything.');composer.current?.focus()}}>Review the design <span>↗</span></button>
        </div>
      </div>}
      {chat.map((message,i)=><article className={'claude-message claude-message-'+message.role} key={i}>{message.role==='assistant'&&<span className="claude-message-author">Claude</span>}<MessageText text={message.content}/>{message.reference&&<a href={message.reference} target="_blank" rel="noreferrer" className="claude-message-image"><img src={message.reference} alt="Submitted design reference"/></a>}</article>)}
      {running&&<article className="claude-message claude-message-assistant"><span className="claude-message-author">Claude</span>{streamText&&<MessageText text={streamText}/>}<div className="claude-working"><span/>{activities.at(-1)??'Thinking…'}</div></article>}
      {!!activities.length&&<details className="claude-tool-activity"><summary>{running?'Activity':'View activity'}</summary><ol>{activities.map((a,i)=><li key={i}>{a}</li>)}</ol></details>}
      {error&&<div role="alert" className="ide-claude-error"><strong>Couldn’t complete this request</strong><p>{error}</p><button disabled={busy} onClick={()=>{const last=chat.filter(m=>m.role==='user').at(-1);setPrompt(last?.content??'');setReference(last?.reference);setError('');composer.current?.focus()}}>Edit and retry</button></div>}
    {result&&<div className="ide-claude-result">{result.runtimeValidationRequested&&<><button onClick={onCapture}>Open runtime capture</button>{result.runtimeValidation&&<div><p>Compare runtime: {result.runtimeValidation.url}</p><button disabled={busy} onClick={()=>void task(async()=>{const comparison=await window.frameui.ai.validateRuntime(result.runId);setReference(comparison.image);setResult({...result,comparison:{matchPercent:comparison.matchPercent,description:comparison.description}})})}>Approve runtime comparison</button></div>}</>}{result.comparison&&<p>Visual match: {result.comparison.matchPercent}%<br/>{result.comparison.description}</p>}
    </div>}
    </div>
    <div className="claude-composer-wrap">
      <div className={'claude-design-controls'+(draftOpen?' claude-design-controls-compact':'')} aria-label="Design controls">
        <div><span>Design Approach</span><ChatMenu label="Design Approach" value={design.approach} text={approachOptions.find(o=>o.id===design.approach)!.name} options={[...approachOptions]} disabled={busy} onChange={value=>changeApproach(value as DesignApproach)}/></div>
        <p>{approachOptions.find(o=>o.id===design.approach)!.description}</p>
      </div>
        <div className="claude-context-chip" title={`${page?.name??'Canvas'} · ${selection.length?selection.length+' selected elements':'Current artboard'} · ${document.projectId?'Project components, tokens and assets':'Canvas context'}`}><FileText size={12}/>{draftOpen&&<small>{draft?.versions[draft.currentVersion]?.document.pages.find(p=>p.id===studioSelected)?.name}</small>}{draftOpen?<ChatMenu label="Target" value={studioScope} text={studioScope==='prototype'?'Entire prototype':'Selected screen'} options={[{id:'prototype',name:'Entire prototype',description:'Extend and refine this process; preserve unrelated canvas screens.'},{id:'screen',name:'Selected screen',description:'Limit revisions to the selected screen and new pages.'}]} disabled={busy} onChange={value=>setStudioScope(value as typeof studioScope)}/>:<ChatMenu label="Target" value={target.kind} text={draft?'Revising draft':target.kind==='flow'?'Flow: '+(document.prototype?.flows.find(f=>f.id===flowId)?.name??'Choose a flow'):target.kind==='artboard'?'Editing: '+(page?.name??'Canvas'):target.kind.replace('-',' ')} options={[{id:'artboard',name:'Selected artboard'},{id:'flow',name:'Selected flow'},{id:'new-artboard',name:'New artboard'},{id:'new-flow',name:'New flow'},{id:'project',name:'Current project'}]} disabled={busy||!!draft} onChange={kind=>setTarget({kind:kind as PrototypeTarget['kind']})}/>}{!!selection.length&&<small>{selection.length} selected</small>}</div>
      <div className="claude-composer" onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()}} onDrop={e=>{const file=Array.from(e.dataTransfer.files).find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();void attachImage(file)}}}>
        {reference&&<div className="claude-attachment"><img src={reference} alt="Attached design reference"/><span>Reference image</span><button title="Remove reference" aria-label="Remove reference" disabled={busy} onClick={()=>setReference(undefined)}><X size={13}/></button></div>}
        <textarea ref={composer} aria-label="Ask Claude" rows={3} placeholder="Ask Claude…" value={prompt} disabled={busy||(draftOpen&&draft?.status==='imported')} onChange={e=>{setPrompt(e.target.value);e.target.style.height='72px';e.target.style.height=Math.min(e.target.scrollHeight,150)+'px'}} onPaste={e=>{const item=Array.from(e.clipboardData.items).find(item=>item.kind==='file'&&item.type.startsWith('image/'));const file=item?.getAsFile();if(file){e.preventDefault();void attachImage(file)}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void run()}}}/>
        <div className="claude-composer-tools">
          <button aria-label="Attach screenshot" title="Attach screenshot" disabled={busy} onClick={()=>attachment.current?.click()}><Paperclip size={15}/></button>
          <input ref={attachment} className="claude-file-input" aria-label="Attach reference screenshot" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void attachImage(file)}}/>
          <ChatMenu label="Model" value={status.model} text={(status.models.find(m=>m.id===status.model)?.name??'Model').replace('Default · ','')} options={status.models} disabled={busy} onChange={value=>void task(async()=>setStatus(await window.frameui.ai.setModel(value)))}/>
          <ChatMenu label="Effort" value={status.effort??'default'} text={status.effort&&status.effort!=='default'?({low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'}[status.effort]):'Auto effort'} options={[{id:'default',name:'Auto',description:'Use the model’s default effort'},...(status.models.find(m=>m.id===status.model)?.effortLevels??[]).map(id=>({id,name:({low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'}[id]),description:id==='low'?'Faster iteration':id==='high'?'More reasoning and verification':undefined}))]} disabled={busy||!status.models.find(m=>m.id===status.model)?.effortLevels?.length} onChange={value=>void task(async()=>setStatus(await window.frameui.ai.setEffort(value as import('@shared/types/ai').ClaudeEffort)))}/>
          <span className="claude-composer-spacer"/>
          {running?<button className="claude-send" aria-label="Stop" title="Stop response" onClick={()=>void window.frameui.ai.cancel()}><Square size={13} fill="currentColor"/></button>:<button className="claude-send" aria-label="Run Claude" title="Send message (Enter)" disabled={busy||(draftOpen&&draft?.status==='imported')||(!prompt.trim()&&!reference)} onClick={()=>void run()}><ArrowUp size={17}/></button>}
        </div>

      </div>

    </div>

  </section>
  return draftOpen&&draft?<PrototypeStudio key={draft.id} draft={draft} chat={chatView} running={busy} onTarget={setStudioSelected} onDraft={next=>{setDraft(next);if(next.id!==draft.id)setChat(next.conversation)}} onClose={()=>{setDraftOpen(false);void window.frameui.prototype.list(document.id).then(items=>{setDrafts(items);if(!items.some(d=>d.id===draft.id)||items.find(d=>d.id===draft.id)?.status==='imported'){setDraft(null);setRevisionPageId(undefined)}})}} onImport={onDocument} onPrompt={(text,screenOnly)=>{setStudioScope(screenOnly?'screen':'prototype');setPrompt(text);composer.current?.focus()}}/>:chatView
}

function MessageText({text}:{text:string}) {
  const parts=text.split(/```[^\n]*\n([\s\S]*?)```/g)
  return <div className="claude-message-text">{parts.map((part,i)=>i%2?<pre key={i}><code>{part}</code></pre>:<div key={i}>{part.split('\n').map((line,j)=><div key={j} className={/^#{1,4} /.test(line)?'claude-message-heading':undefined}>{line.replace(/^#{1,4} /,'').replace(/^[-*] /,'• ').split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((chunk,k)=>chunk.startsWith('**')?<strong key={k}>{chunk.slice(2,-2)}</strong>:chunk.startsWith('`')?<code key={k}>{chunk.slice(1,-1)}</code>:chunk)}{!line&&<br/>}</div>)}</div>)}</div>
}

function ChatMenu({label,value,text,options,disabled,onChange}:{label:string;value:string;text:string;options:{id:string;name:string;description?:string}[];disabled:boolean;onChange:(value:string)=>void}) {
  const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
    window.document.addEventListener('pointerdown',outside)
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return()=>window.document.removeEventListener('pointerdown',outside)
  },[open])
  return <div className="claude-menu-anchor" ref={root} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus()}
    if(open&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const items=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[])
      const current=items.indexOf(window.document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length
      items[next]?.focus()
    }
    if(event.key==='Tab')setOpen(false)
  }}>
    <button ref={trigger} className="claude-menu-trigger" aria-label={label} title={`${label}: ${text}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} onClick={()=>setOpen(!open)}><span>{text}</span><ChevronDown size={10}/></button>
    {open&&<div className="claude-choice-menu" role="menu" aria-label={label} id={id}>
      <div className="claude-menu-caption">{label==='Model'?'Choose a model':label==='Target'?'Design context':label==='Effort'?'Reasoning effort':label}</div>
      {options.map(option=><button role="menuitemradio" aria-checked={value===option.id} key={option.id} onClick={()=>{onChange(option.id);setOpen(false);trigger.current?.focus()}}><span><strong>{option.name}</strong>{option.description&&<small>{option.description}</small>}</span>{value===option.id&&<Check size={13}/>}</button>)}
    </div>}
  </div>
}
