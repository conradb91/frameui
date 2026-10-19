import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AiFileChange } from '@shared/types/ai'
import { safeRepoPath } from './repoAccess'
import { writeJsonFileAtomic } from '@core/workspace/atomicJson'

interface Checkpoint { root: string; changes: AiFileChange[]; applied: boolean; gitHead?:string; gitBranch?:string }
function gitState(root:string){try{return {gitHead:execFileSync('git',['rev-parse','--verify','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(),gitBranch:execFileSync('git',['symbolic-ref','--quiet','--short','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}}catch{return {}}}
function current(file:string) { return fs.existsSync(file) ? fs.readFileSync(file,'utf8') : null }
export function applyChanges(root:string, changes:AiFileChange[], checkpointRoot:string): string {
  if(!changes.length)throw new Error('There are no source changes to apply.')
  const files=changes.map(c=>safeRepoPath(root,c.path,true))
  if(new Set(files).size!==files.length)throw new Error('Duplicate file changes are not allowed.')
  files.forEach((file,i)=>{if(current(file)!==changes[i].before)throw new Error('Source files changed since this proposal. Ask Claude to refresh the changes.')})
  const id=`frameui-before-ai-${Date.now()}-${randomUUID()}`
  fs.mkdirSync(checkpointRoot,{recursive:true,mode:0o700})
  const checkpoint=path.join(checkpointRoot,id+'.json')
  const git=gitState(root)
  writeJsonFileAtomic(checkpoint,{...git,root:fs.realpathSync(root),changes,applied:false} satisfies Checkpoint)
  const written:number[]=[]
  try {
    files.forEach((file,i)=>{safeRepoPath(root,changes[i].path,true);fs.mkdirSync(path.dirname(file),{recursive:true});written.push(i);fs.writeFileSync(file,changes[i].after)})
    writeJsonFileAtomic(checkpoint,{...git,root:fs.realpathSync(root),changes,applied:true} satisfies Checkpoint)
  } catch(error) { for(const i of written.reverse()){const before=changes[i].before;if(before===null)fs.rmSync(files[i],{force:true});else fs.writeFileSync(files[i],before)}throw error }
  return id
}
export function undoChanges(root:string,id:string,checkpointRoot:string):void {
  if(!/^frameui-before-ai-[\w-]+$/.test(id))throw new Error('Invalid checkpoint.')
  const file=path.join(checkpointRoot,id+'.json');const checkpoint=JSON.parse(fs.readFileSync(file,'utf8')).data as Checkpoint
  if(checkpoint.root!==fs.realpathSync(root)||!checkpoint.applied)throw new Error('Checkpoint does not belong to this active project or was already restored.')
  const git=gitState(root)
  if(checkpoint.gitHead&&(git.gitHead!==checkpoint.gitHead||git.gitBranch!==checkpoint.gitBranch))throw new Error('The Git branch or HEAD changed. Return to the original revision before undoing these changes.')
  const files=checkpoint.changes.map(c=>safeRepoPath(root,c.path,true))
  files.forEach((file,i)=>{if(current(file)!==checkpoint.changes[i].after)throw new Error('Files changed after applying AI changes. Undo is blocked to preserve your newer work.')})
  files.forEach((file,i)=>{const before=checkpoint.changes[i].before;if(before===null)fs.rmSync(file);else fs.writeFileSync(file,before)})
  writeJsonFileAtomic(file,{...checkpoint,applied:false})
}
