import type {FrameUiApi} from '../../shared/ipc-contract'
import type {VisualPage} from '../../shared/types/visualDesign'
import {unpackDocument} from '../../shared/documentResources'
/** Large captures cross Electron's isolated-context bridge as one lossless string. */
export async function capturePages(input:Parameters<FrameUiApi['design']['capture']>[0]):Promise<VisualPage[]>{
 return unpackDocument<VisualPage[]>(JSON.parse(await window.frameui.design.captureSerialized(input)))
}
