import {useState} from 'react'
import {readableImportNote} from '../../lib/importNotes'


/** Keep the completion outcome visible without turning the inspector into a log. */
export function ImportReviewNotice({title,notes,onReview,onDismiss}:{title:string;notes:string[];onReview:()=>void;onDismiss:()=>void}){
 const [expanded,setExpanded]=useState(false)
 const counts=/(\d+) of (\d+) discovered screens captured · (\d+) connections/.exec(title)
 const viewport=/Desktop \(\d+ px\)/.exec(title)?.[0]
 const limited=notes.some(note=>/limit|unexamined|paused|pending/i.test(note))
 const failed=notes.some(note=>/could not|couldn.t|not render/i.test(note))
 const safety=notes.filter(note=>/safety/.test(note)).length
 return <section className="ide-import-review" aria-label="Import summary">
   <div className="ide-import-review-heading"><strong>{counts?`${counts[1]} ${counts[1]==='1'?'screen':'screens'} imported`:'Import complete'}</strong><button aria-label="Dismiss import summary" title="Dismiss" onClick={onDismiss}>×</button></div>
   <p role="status">{counts?`${counts[3]} ${counts[3]==='1'?'connection':'connections'}${viewport?' · '+viewport:''}`:title.replace(/^Partial discovery · /,'')}</p>
   {!!notes.length&&<><p className="ide-import-review-description">{failed?'Some screens couldn’t be captured. Open Capture to retry them.':limited?'Discovery has pending actions. Open interaction coverage to continue.':safety?'Some controls were left untouched to avoid submitting forms or changing data.':'Some screens have capture notes to review.'}</p><button className="ide-import-review-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Hide details':`View ${notes.length} review ${notes.length===1?'note':'notes'}`}</button>{expanded&&<ul className="ide-import-review-details">{[...new Set(notes.map(readableImportNote))].map(note=><li key={note}>{note}</li>)}</ul>}<button className="ide-import-review-action" onClick={onReview}>Review in Capture</button></>}
 </section>
}
