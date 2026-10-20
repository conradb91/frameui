/** Lossless transport table. Repeated media/CSS payloads cross IPC only once. */
export interface ResourceDocument { encoding: 'frameui-resources-1'; resources: string[]; value: unknown }
export function packDocument(value: unknown): ResourceDocument {
  const resources:string[]=[], ids=new Map<string,number>()
  const visit=(v:unknown):unknown=>{
    if(typeof v==='string'&&v.length>=1024){let id=ids.get(v);if(id===undefined){id=resources.length;ids.set(v,id);resources.push(v)}return {$frameuiResource:id}}
    if(Array.isArray(v))return v.map(visit)
    if(v&&typeof v==='object'){const entries=Object.entries(v).map(([k,x])=>[k,visit(x)]);if(Object.hasOwn(v,'$frameuiResource')||Object.hasOwn(v,'$frameuiObject'))return {$frameuiObject:entries};return Object.fromEntries(entries)}
    return v
  }
  return {encoding:'frameui-resources-1',value:visit(value),resources}
}
export function unpackDocument<T>(input:unknown):T {
  const p=input as ResourceDocument
  if(!p||p.encoding!=='frameui-resources-1')return input as T
  if(!Array.isArray(p.resources)||p.resources.some(x=>typeof x!=='string'))throw new Error('Invalid document resources')
  const visit=(v:unknown):unknown=>{
    if(Array.isArray(v))return v.map(visit)
    if(v&&typeof v==='object'){
      const o=v as Record<string,unknown>
      if(Object.keys(o).length===1&&Object.hasOwn(o,'$frameuiObject')){if(!Array.isArray(o.$frameuiObject))throw new Error('Invalid document object');return Object.fromEntries(o.$frameuiObject.map(entry=>{if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string')throw new Error('Invalid document object');return [entry[0],visit(entry[1])]}))}
      if(Object.keys(o).length===1&&Object.hasOwn(o,'$frameuiResource')){const id=o.$frameuiResource;if(!Number.isInteger(id)||typeof id!=='number'||id<0||id>=p.resources.length)throw new Error('Missing document resource');return p.resources[id]}
      return Object.fromEntries(Object.entries(o).map(([k,x])=>[k,visit(x)]))
    }
    return v
  }
  return visit(p.value) as T
}
