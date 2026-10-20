import {test,expect} from 'bun:test'
import {packDocument,unpackDocument} from '../../src/shared/documentResources'
test('IPC resource table preserves native models while sending repeated media once',()=>{
 const asset='data:image/png;base64,'+'xy'.repeat(10000),doc={pages:[{image:asset},{image:asset}],text:'editable',variables:{$frameuiResource:2},other:{$frameuiObject:'designer-defined value'}}
 const packed=packDocument(doc)
 expect(packed.resources).toHaveLength(1)
 expect(unpackDocument(packed)).toEqual(doc)
 expect(unpackDocument(null)).toBeNull()
 expect(()=>unpackDocument({encoding:'frameui-resources-1',resources:[],value:{$frameuiResource:2}})).toThrow('Missing document resource')
})
