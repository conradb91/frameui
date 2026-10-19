import { test,expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeRepoPath,readSource } from '../../src/main/ai/repoAccess'
import { applyChanges,undoChanges } from '../../src/main/ai/changes'
test('Claude file boundary rejects secrets, traversal and symlink aliases including new files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-ai-scope-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-ai-outside-'))
 try{
  fs.writeFileSync(path.join(root,'.env'),'secret');fs.writeFileSync(path.join(root,'test.ts'),'const api_key = "sk-ant-api03-private-secret";')
  fs.symlinkSync(outside,path.join(root,'escape'));fs.symlinkSync(path.join(root,'.env'),path.join(root,'alias.txt'))
  for(const file of ['.env','.env.production','../outside.ts','escape/new.ts','alias.txt','db.sql','id_rsa','credentials.json'])expect(()=>safeRepoPath(root,file,true)).toThrow()
  expect(readSource(root,'test.ts')).not.toContain('private-secret')
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})}
})
test('source proposals preserve dirty work, detect stale edits and undo only their exact changes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-ai-apply-')),checkpoints=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-ai-checkpoints-'))
 try{
  fs.writeFileSync(path.join(root,'a.ts'),'my uncommitted edit')
  expect(()=>applyChanges(root,[{path:'a.ts',before:'old',after:'new',reason:'test'}],checkpoints)).toThrow('changed')
  const id=applyChanges(root,[{path:'a.ts',before:'my uncommitted edit',after:'new',reason:'test'},{path:'new.ts',before:null,after:'created',reason:'test'}],checkpoints)
  fs.writeFileSync(path.join(root,'a.ts'),'newer user work')
  expect(()=>undoChanges(root,id,checkpoints)).toThrow('newer work')
  fs.writeFileSync(path.join(root,'a.ts'),'new');undoChanges(root,id,checkpoints)
  expect(fs.readFileSync(path.join(root,'a.ts'),'utf8')).toBe('my uncommitted edit')
  expect(fs.existsSync(path.join(root,'new.ts'))).toBe(false)
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(checkpoints,{recursive:true,force:true})}
})
