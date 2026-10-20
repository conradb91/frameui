export function readableImportNote(note:string){
 return note.replace(/^Partial discovery:\s*/i,'').replace(/Open (?:the prototype in )?Capture.*$/i,'').replace(/Open the prototype.*$/i,'').replace(/has (\d+) controls excluded from automatic interaction for safety\./i,(_match,count:string)=>`: ${count} ${count==='1'?'control needs':'controls need'} manual review.`).replace(/[_]+/g,' ').replace(/\s+/g,' ').replace(/\s+:/g,':').trim()
}
