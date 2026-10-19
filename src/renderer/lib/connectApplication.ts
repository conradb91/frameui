import {applicationAddress,localAppAddress} from '@core/runtime/address'
/** Explicit address entry authorises one app origin for this project. */
export async function connectApplication(value:string){
 const url=applicationAddress(value)
 const connection=await window.frameui.project.configureRuntime(url,localAppAddress(new URL(url))?'local':'staging')
 window.dispatchEvent(new CustomEvent('frameui:runtime-updated',{detail:connection}))
 return url
}
