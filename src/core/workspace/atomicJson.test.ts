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
