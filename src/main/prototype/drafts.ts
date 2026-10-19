import {upgradeDesignReview} from '@core/ai/designContext'
import {resolveDesignSettings,type AiDesignSettings} from '@shared/aiDesign'
import {readSource,digest} from '../ai/repoAccess'
import {buildDeveloperHandoff} from '@core/handoff/developerPackage'
import {createStoredZip} from '../export/storedZip'
import {renderArtboard} from '../ai/preview'
import {getActiveProject,getCachedIndex} from '../state/activeProject'
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { z } from 'zod';
import { readJsonFile, writeJsonFileAtomic } from '@core/workspace/atomicJson';
import { visualDocumentSchema } from '@core/visual/schema';
import { migrate, mergeDraft, validatePrototype, prototype,extendPrototypeTarget,changes } from '@core/prototype/model';
import type { PrototypeDraft, PrototypeTarget } from '@shared/types/prototype';
import type { VisualDocument } from '@shared/types/visualDesign';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const root = () => path.join(electron.app.getPath('userData'), 'prototype-drafts');
const file = (key: string) => path.join(root(), id.parse(key) + '.json');
function upgradeDraft(d:PrototypeDraft){for(const v of d.versions){if(v.designReview)v.designReview=upgradeDesignReview(v.designReview);v.design=resolveDesignSettings(v.design??v.designReview?.design)}d.design=resolveDesignSettings(d.versions[d.currentVersion]?.design??d.design);return d}
export function saveDraft(draft: PrototypeDraft) { draft.updatedAt = new Date().toISOString(); writeJsonFileAtomic(file(draft.id), draft); return draft; }
export function loadDraft(key: string) { const d = readJsonFile<PrototypeDraft | null>(file(key), null); if (!d || d.version !== 1)
    throw new Error('Draft could not be loaded.'); return upgradeDraft(d); }
export function listDrafts(documentId: string) { id.parse(documentId); return (fs.existsSync(root()) ? fs.readdirSync(root()) : []).filter(n => n.endsWith('.json')).map(n => readJsonFile<PrototypeDraft | null>(path.join(root(), n), null)).filter((d): d is PrototypeDraft => !!d && d.documentId === documentId && d.status !== 'discarded').map(upgradeDraft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function beginDraft(doc: VisualDocument, target: PrototypeTarget, prompt: string, key?: string, history: {role:'user'|'assistant';content:string;reference?:string}[] = [], reference?:string, design?:AiDesignSettings) { let d: PrototypeDraft; if (key) {
    d = loadDraft(key);
    if (d.documentId !== doc.id || ['imported', 'discarded', 'generating', 'revising'].includes(d.status))
        throw new Error('Start a new proposal for this document.');
    d.status = 'revising';d.target=extendPrototypeTarget(d.base,d.target,target,d.versions[d.currentVersion]?.document);
}
else {
    const now = new Date().toISOString();
    d = { version: 1, id: crypto.randomUUID(), documentId: doc.id, target, sourceRevision: doc.updatedAt, base: migrate(doc), versions: [], currentVersion: -1, conversation: structuredClone(history.slice(-12)), status: 'generating', createdAt: now, updatedAt: now };
} d.design=resolveDesignSettings(design??d.versions[d.currentVersion]?.design??d.design);d.conversation.push({ role: 'user', content: prompt, reference }); delete d.error; return saveDraft(d); }
export function completeDraft(d: PrototypeDraft, doc: VisualDocument, message: string, designReview?:import('@core/ai/designContext').DesignReview) { const parsed = migrate(visualDocumentSchema.parse(doc) as VisualDocument), validation = validatePrototype(parsed); if (validation.errors.length)
    throw new Error('Prototype validation failed: ' + validation.errors.join(' ')); mergeDraft(d.base, d.base, parsed, d.target); d.versions.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), document: parsed, message, design:d.design, designReview }); d.currentVersion = d.versions.length - 1; d.conversation.push({ role: 'assistant', content: message }); d.status = designReview?.errors.length ? 'review' : 'ready'; d.error = designReview?.errors.length ? designReview.errors.join('\n') : undefined; return saveDraft(d); }
export function failDraft(d: PrototypeDraft, message: string) { d.status = 'failed'; d.error = message; return saveDraft(d); }
export function registerPrototypeHandlers() {
    // An interrupted process cannot continue generating after restart. Keep its last good version.
    for (const n of fs.existsSync(root()) ? fs.readdirSync(root()) : []) {
        if (!n.endsWith('.json'))
            continue;
        const d = readJsonFile<PrototypeDraft | null>(path.join(root(), n), null);
        if (d && ['generating', 'revising'].includes(d.status))
            failDraft(d, 'Generation was interrupted. Your previous version is available; retry to continue.');
    }
    const handle = (name: string, fn: (value: any) => unknown) => electron.ipcMain.handle('prototype:' + name, (event, value) => { const url = event.sender.getURL(), dev = process.env.VITE_DEV_SERVER_URL; if (event.senderFrame !== event.sender.mainFrame || event.sender.getType() !== 'window' || !(url.startsWith('file:') || dev && new URL(url).origin === new URL(dev).origin))
        throw new Error('Open prototypes in FrameUI.'); return fn(value); });
    handle('exportHandoff',async value=>{
      const input=z.object({id,notes:z.string().max(12000)}).parse(value),raw=readJsonFile<VisualDocument|null>(path.join(electron.app.getPath('userData'),'design-files',input.id+'.json'),null)
      if(!raw)throw new Error('Save this design before exporting a handoff.')
      const doc=visualDocumentSchema.parse(raw) as VisualDocument,project=getActiveProject(),index=doc.projectId&&project?.projectId===doc.projectId?getCachedIndex():null
      if(doc.projectId&&!index)throw new Error('Open this design’s repository and wait for indexing so the handoff includes its current components and tokens.')
      const receipt=doc.prototype?.imports.at(-1);let base:VisualDocument|undefined;let design:AiDesignSettings|undefined
      if(receipt)try{const approved=loadDraft(receipt);base=approved.base;design=approved.versions[approved.currentVersion]?.design}catch{/* Older designs may not have a local draft receipt. */}
      const bundle=buildDeveloperHandoff(doc,index,input.notes,base,design)
      if(project&&index){const fingerprints:Record<string,string>={};const paths=new Set(['package.json',...index.projectModel.components.filter(c=>bundle.files.find(f=>f.path==='component-map.json')?.content.includes(c.id)).map(c=>c.source.filePath)]);for(const file of paths)try{fingerprints[file]=digest(readSource(project.rootPath,file))}catch{/* Unavailable files are not represented as verified source. */}const repository=bundle.files.find(f=>f.path==='repository.json')!;repository.content=JSON.stringify({...JSON.parse(repository.content),fileFingerprints:fingerprints},null,2)}
      const selected=await electron.dialog.showSaveDialog({defaultPath:doc.name.replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,80)+'-handoff.zip',filters:[{name:'Developer handoff',extensions:['zip']}]})
      if(selected.canceled||!selected.filePath)return {ok:false}
      const files:{path:string;data:Buffer}[]=bundle.files.map(f=>({path:'frameui-handoff/'+f.path,data:Buffer.from(f.content,f.encoding)}));const signal=AbortSignal.timeout(120000),warnings:string[]=[]
      for(const page of doc.pages){if(page.width>2560||page.height>4096)warnings.push(page.name+': PNG preview is capped at 2560 × 4096px; native-design.json contains the full screen.');if(!page.structured){warnings.push(page.name+': no native preview available.');continue}try{const image=await renderArtboard(page,signal);files.push({path:'frameui-handoff/previews/'+encodeURIComponent(page.id)+'.png',data:Buffer.from(image.split(',')[1],'base64')})}catch(error){signal.throwIfAborted();warnings.push(page.name+': preview could not be rendered.')} }
      files.push({path:'frameui-handoff/preview-warnings.json',data:Buffer.from(JSON.stringify(warnings,null,2))})
      files.push({path:'frameui-handoff/editable-design.frameui',data:createStoredZip(bundle.editableFiles.map(f=>({path:f.path,data:Buffer.from(f.content,f.encoding)})))})
      const archive=createStoredZip(files),temporary=selected.filePath+'.'+crypto.randomUUID()+'.tmp'
      try{fs.writeFileSync(temporary,archive);fs.renameSync(temporary,selected.filePath)}finally{fs.rmSync(temporary,{force:true})}
      return {ok:true,filePath:selected.filePath,screens:doc.pages.length,warnings}
    })
    handle('list', value => listDrafts(id.parse(value)));
    handle('load', value => loadDraft(id.parse(value)));
    handle('save', value => { const input = z.object({ id, document: visualDocumentSchema }).parse(value), d = loadDraft(input.id); if (['generating', 'revising', 'imported', 'discarded'].includes(d.status))
        throw new Error('This draft cannot be edited now.'); const doc = migrate(input.document as VisualDocument); if (doc.id !== d.documentId)
        throw new Error('Wrong document.'); const previousDoc=d.versions[d.currentVersion]?.document??d.base;const editedIds=[...new Set([...changes(previousDoc,doc).filter(c=>c.status!=='Unchanged').map(c=>c.id),...(doc.prototype?.interactions.filter(i=>JSON.stringify(previousDoc.prototype?.interactions.find(p=>p.id===i.id))!==JSON.stringify(i)).map(i=>i.sourceArtboardId)??[])])];if(editedIds.length)d.target=extendPrototypeTarget(d.base,d.target,{kind:'artboards',ids:editedIds},doc);const version={id:crypto.randomUUID(),createdAt:new Date().toISOString(),document:doc,message:'Manual prototype edit',source:'manual' as const,design:d.versions[d.currentVersion]?.design??d.design,designReview:d.versions[d.currentVersion]?.designReview};if(d.currentVersion===d.versions.length-1&&d.versions[d.currentVersion]?.source==='manual'&&!d.versions[d.currentVersion]?.approvedAt)d.versions[d.currentVersion]=version;else d.versions.push(version); d.currentVersion = d.versions.length - 1; d.status = 'review'; return saveDraft(d); });
    handle('discard', value => { const d = loadDraft(id.parse(value)); if (['generating', 'revising', 'imported'].includes(d.status))
        throw new Error('Stop generation before discarding.'); d.status = 'discarded'; saveDraft(d); });
    handle('restore', value => { const input = z.object({ id, version: z.number().int().min(0) }).parse(value), d = loadDraft(input.id); if (['generating', 'revising', 'imported', 'discarded'].includes(d.status) || !d.versions[input.version])
        throw new Error('This version cannot be restored.'); d.currentVersion = input.version; d.design=d.versions[input.version].design; d.status = 'review'; delete d.error; return saveDraft(d); });
    handle('checkpoint',value=>{const input=z.object({id,name:z.string().trim().min(1).max(160)}).parse(value),d=loadDraft(input.id),current=d.versions[d.currentVersion];if(!current||['generating','revising','imported','discarded'].includes(d.status))throw new Error('Finish the current task before saving a version.');d.versions.push({...structuredClone(current),id:crypto.randomUUID(),createdAt:new Date().toISOString(),message:input.name,source:'checkpoint',approvedAt:undefined});d.currentVersion=d.versions.length-1;d.status='review';return saveDraft(d)});
    handle('accept',value=>{const d=loadDraft(id.parse(value)),v=d.versions[d.currentVersion];if(!v||['generating','revising','imported','discarded'].includes(d.status))throw new Error('This version is not ready for approval.');const validation=validatePrototype(v.document);if(validation.errors.length||v.designReview?.errors.length)throw new Error('Resolve the prototype and design checks before approving.');v.approvedAt=new Date().toISOString();d.approvedVersionId=v.id;d.status='approved';return saveDraft(d)});
    handle('fork',value=>{const previous=loadDraft(id.parse(value));if(!['imported','approved'].includes(previous.status))throw new Error('Create a revision from an approved or imported prototype.');const source=previous.versions[previous.currentVersion];if(!source)throw new Error('No version available.');const saved=readJsonFile<VisualDocument|null>(path.join(electron.app.getPath('userData'),'design-files',previous.documentId+'.json'),null);if(!saved)throw new Error('Open the saved design first.');const base=migrate(saved),document=previous.status==='imported'?base:source.document,now=new Date().toISOString();const next:PrototypeDraft={version:1,id:crypto.randomUUID(),documentId:base.id,target:{kind:'artboards',ids:[...new Set([...(previous.target.kind==='artboards'?previous.target.ids??[]:previous.target.id?[previous.target.id]:[]),...source.document.pages.filter(p=>JSON.stringify(previous.base.pages.find(b=>b.id===p.id))!==JSON.stringify(p)).map(p=>p.id)])]},design:source.design,sourceRevision:base.updatedAt,base,versions:[{id:crypto.randomUUID(),createdAt:now,document:structuredClone(document),message:'Revision of approved prototype',source:'checkpoint',design:source.design}],currentVersion:0,conversation:structuredClone(previous.conversation),status:'review',createdAt:now,updatedAt:now};return saveDraft(next)});
    const importDraft = (value:unknown,requireApproval=false) => { const d = loadDraft(id.parse(value)), docFile = path.join(electron.app.getPath('userData'), 'design-files', id.parse(d.documentId) + '.json'), raw = readJsonFile<VisualDocument | null>(docFile, null); if (!raw)
        throw new Error('Save the current design before importing.'); const current = visualDocumentSchema.parse(raw) as VisualDocument; if (current.prototype?.imports.includes(d.id)) {
        d.status = 'imported';
        saveDraft(d);
        return current;
    } if (!['review', 'ready', 'failed', 'approved'].includes(d.status) || !d.versions[d.currentVersion])
        throw new Error('This draft is not ready for approval.'); if(requireApproval&&(d.status!=='approved'||d.approvedVersionId!==d.versions[d.currentVersion].id))throw new Error('Approve this exact version before importing.'); if(d.versions[d.currentVersion].designReview?.errors.length)throw new Error('Resolve the design checks before importing this draft.'); const next = mergeDraft(current, d.base, d.versions[d.currentVersion].document, d.target); prototype(next).imports.push(d.id); visualDocumentSchema.parse(next); const previous = d.status; try {
        d.status = 'approved';
        saveDraft(d);
        writeJsonFileAtomic(docFile, next);
    }
    catch {
        d.status = previous;
        saveDraft(d);
        throw new Error('The prototype could not be saved. Check disk space and write access, then retry. Your saved canvas was preserved.');
    } d.status = 'imported'; try {
        saveDraft(d);
    }
    catch { /* The durable document receipt recovers this status on the next approval. */ } return next; };
    handle('approve',value=>importDraft(value));
    handle('importApproved',value=>importDraft(value,true));
}
