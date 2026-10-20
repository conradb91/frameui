import { expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from './atomicJson'

test('incomplete and invalid collection envelopes recover without crashing workspace readers', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-corrupt-')), file=path.join(dir,'data.json')
 try {
  for(const content of ['{"schemaVersion":1}', '{"schemaVersion":1,"data":null}', '{"schemaVersion":1,"data":{}}', '{invalid']) {
   fs.writeFileSync(file,content)
   expect(readJsonFile<string[]>(file,[])).toEqual([])
  }
  writeJsonFileAtomic(file,['saved'])
  expect(readJsonFile<string[]>(file,[])).toEqual(['saved'])
 } finally { fs.rmSync(dir,{recursive:true,force:true}) }
})

test('design resources are losslessly deduplicated, compressed and remain self-contained',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-design-storage-')),file=path.join(dir,'design-files','design.json')
 try{
  const image='data:image/png;base64,'+'ABCDEF0123456789'.repeat(10000),original={pages:[{image,background:'url("'+image+'")'},{image}],fonts:[{data:image}],text:'text'.repeat(500)+'\ud800'}
  writeJsonFileAtomic(file,original)
  expect(readJsonFile(file,null)).toEqual(original)
  expect(fs.statSync(file).size).toBeLessThan(JSON.stringify(original).length/20)
  expect(JSON.parse(fs.readFileSync(file,'utf8')).schemaVersion).toBe(2)
  fs.writeFileSync(file,JSON.stringify({schemaVersion:1,data:original}))
  expect(readJsonFile(file,null)).toEqual(original)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
