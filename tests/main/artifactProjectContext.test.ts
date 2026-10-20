import {expect,test} from 'bun:test'
import {beginImport,setImportProject,importProject,cancelImport,finishImport} from '../../src/main/artifacts/importJob'
test('imports retain their own project identity independently of the visible repository',()=>{
 beginImport(91,'first');beginImport(92,'second')
 setImportProject(91,'first',{projectId:'html-one',rootPath:'/isolated/one'})
 setImportProject(92,'second',{projectId:'html-two',rootPath:'/isolated/two'})
 expect(importProject(91,'first').projectId).toBe('html-one')
 expect(importProject(92,'second').projectId).toBe('html-two')
 expect(()=>importProject(91,'second')).toThrow()
 cancelImport(91,'first');expect(()=>importProject(91,'first')).toThrow('Import stopped')
 finishImport(91,'first');finishImport(92,'second')
 expect(()=>importProject(92,'second')).toThrow('no longer active')
})
