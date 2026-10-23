import {visualDocumentSchema} from '../visual/schema'
import {unpackDocument} from '../../shared/documentResources'
import type {VisualDocument} from '../../shared/types/visualDesign'
/** Validate external capture data before it enters document storage. */
export function chromeCaptureDocument(input:unknown):VisualDocument {
 const envelope=input as {format?:string;version?:number;document?:unknown}
 if(!envelope||envelope.format!=='frameui-chrome-capture'||envelope.version!==1)throw new Error('Choose a FrameUI Chrome capture file.')
 const document=visualDocumentSchema.parse(unpackDocument(envelope.document)) as VisualDocument
 if(!document.pages.length)throw new Error('This capture has no screens.')
 return {...document,id:crypto.randomUUID(),projectId:undefined,libraryId:undefined,updatedAt:new Date().toISOString()}
}
