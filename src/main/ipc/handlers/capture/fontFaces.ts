/** FontFace and CSSOM serialize equivalent Unicode ranges differently. */
export function unicodeRangeKey(value='U+0-10FFFF'):string {
 const ranges=value.split(',').map(part=>{
  const text=part.trim().replace(/^U\+/i,'').toUpperCase()
  const bounds=text.includes('?')?[text.replace(/\?/g,'0'),text.replace(/\?/g,'F')]:text.split('-')
  const from=parseInt(bounds[0],16),to=parseInt(bounds[1]??bounds[0],16)
  return {from,to}
 }).filter(r=>Number.isFinite(r.from)&&Number.isFinite(r.to)&&r.from<=r.to).sort((a,b)=>a.from-b.from||a.to-b.to)
 const merged:{from:number;to:number}[]=[]
 for(const range of ranges){const last=merged.at(-1);if(last&&range.from<=last.to+1)last.to=Math.max(last.to,range.to);else merged.push({...range})}
 return merged.map(r=>r.from.toString(16)+'-'+r.to.toString(16)).join(',')
}
