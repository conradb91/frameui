import {readSession,writeSession} from './store'
import {captureTab,tabTransport} from './capture'
import {RECORD_SCRIPT,STOP_RECORD_SCRIPT,RECORD_BINDING} from './recorder'
let attachedTab,recording=false,busy=false,stage='',lastError='',pending=Promise.resolve(),lastInfo,scriptId,skipped=0,scheduled=false,actions=[],stopping=false,previousZoom
const emit=()=>chrome.runtime.sendMessage({type:'frameui-status',busy:busy||scheduled||stopping,stage,recording,error:lastError}).catch(()=>{})
function progress(value){stage=value;emit()}
async function attach(tabId){
 if(attachedTab===tabId)return
 if(attachedTab!==undefined)await detach()
 const tab=await chrome.tabs.get(tabId);if(!/^https?:\/\//i.test(tab.url??''))throw Error('Open a normal HTTP or HTTPS page to capture.')
 previousZoom=await chrome.tabs.getZoom(tabId);await chrome.tabs.setZoom(tabId,1);try{await chrome.debugger.attach({tabId},'1.3')}catch(error){await chrome.tabs.setZoom(tabId,previousZoom).catch(()=>{});throw error}attachedTab=tabId
 await chrome.debugger.sendCommand({tabId},'Page.enable');await chrome.debugger.sendCommand({tabId},'Runtime.enable')
}
async function detach(){const id=attachedTab;recording=false;attachedTab=undefined;if(id===undefined)return;const transport=tabTransport(id);await transport.execute(STOP_RECORD_SCRIPT).catch(()=>{});if(scriptId)await transport.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId}).catch(()=>{});scriptId=undefined;await transport.send('Emulation.clearDeviceMetricsOverride').catch(()=>{});await chrome.debugger.detach({tabId:id}).catch(()=>{});if(previousZoom!==undefined)await chrome.tabs.setZoom(id,previousZoom).catch(()=>{});previousZoom=undefined;emit()}
async function currentTab(){const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab?.id)throw Error('Choose a tab to capture.');return tab.id}
async function take(tabId,event){
 if(busy){skipped++;return}
 busy=true;lastError='';emit()
 try{
  const session=await readSession(),capture=await captureTab(tabId,progress)
  const same=lastInfo&&lastInfo.url===capture.info.url&&lastInfo.signature===capture.info.signature&&lastInfo.visual===capture.info.visual
  if(event&&(same||session.mode==='simple'&&lastInfo?.url===capture.info.url)){event.status='unchanged';session.unchanged=(session.unchanged??0)+1;await writeSession(session);stage='No new view appeared';return}
  const source=session.pages.at(-1),next=capture.page;if(event){event.status='captured';event.destination=next.id}
  if(event&&source){const opening=capture.info.overlay&&(capture.info.overlay!==lastInfo?.overlay||capture.info.overlaySelector!==lastInfo?.overlaySelector),closing=lastInfo?.overlay&&!capture.info.overlay,navigation=lastInfo?.url!==capture.info.url;const kind=opening?capture.info.overlay:closing?lastInfo.overlay:navigation?'navigation':JSON.stringify(lastInfo?.expanded)!==JSON.stringify(capture.info.expanded)?'disclosure':event.componentType==='tab'?'tab':event.componentType==='dropdown'?'dropdown':event.event==='change'?'filter':'control';session.transitions.push({source:source.route,destination:next.route,selector:event.selector,label:event.label,componentType:event.componentType,kind,trigger:event.event==='change'?'change':'click',action:opening?(kind==='drawer'?'open-drawer':kind==='modal'?'open-modal':'open-overlay'):closing?(kind==='drawer'?'close-drawer':kind==='modal'?'close-modal':'close-overlay'):navigation?'navigate':'state'})}
  session.pages.push(next);session.journeys??=[];let journey=session.journeys.at(-1);if(!journey){journey={id:crypto.randomUUID(),name:session.name,pageIds:[]};session.journeys.push(journey)}journey.pageIds.push(next.id);session.renderedFonts=[...(session.renderedFonts??[]),...capture.renderedFonts];session.renderedImages=[...(session.renderedImages??[]),...capture.renderedImages];session.renderedLines={...session.renderedLines,...capture.renderedLines};session.notes=[...new Set([...session.notes,...capture.notes,...(skipped?[skipped+' interactions happened while a capture was busy. Capture those states again.']:[])])];lastInfo=capture.info;await writeSession(session);stage='Screen saved · '+session.pages.length+' captured';
 }finally{busy=false;emit()}
}
chrome.debugger.onEvent.addListener((source,method,params)=>{
 if(!recording||source.tabId!==attachedTab||method!=='Runtime.bindingCalled'||params.name!==RECORD_BINDING)return
 let event;try{event=JSON.parse(params.payload)}catch{return}
 if(typeof event.selector!=='string'||event.selector.length>8192||!['click','change'].includes(event.event))return
 event.status=busy||scheduled?'missed':'pending';actions.push(event);if(busy||scheduled){skipped++;return}
 scheduled=true;emit();pending=pending.then(async()=>{await new Promise(r=>setTimeout(r,500));scheduled=false;await take(source.tabId,event)}).catch(error=>{lastError=error.message;busy=false;scheduled=false;emit()})
})
chrome.debugger.onDetach.addListener(source=>{if(source.tabId===attachedTab){attachedTab=undefined;recording=false;busy=false;if(previousZoom!==undefined)chrome.tabs.setZoom(source.tabId,previousZoom).catch(()=>{});previousZoom=undefined;lastError='Capture disconnected. Saved screens are kept. Reconnect to continue.';emit()}})
chrome.action.onClicked.addListener(tab=>chrome.sidePanel.open({tabId:tab.id}).catch(()=>{}))
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
 if(message.type!=='frameui-command')return
 ;(async()=>{
  if(message.command==='dismissError'){lastError='';return {ok:true}}
  if(message.command==='status'){const s=await readSession();return {busy:busy||scheduled||stopping,stage,recording,error:lastError,session:{id:s.id,name:s.name,mode:s.mode,notes:s.notes,pages:s.pages.map(p=>({id:p.id,name:p.name,width:p.width,height:p.height,thumbnail:p.thumbnail,step:s.transitions.find(t=>t.destination===p.route)})),connections:s.transitions.length}}}
  if(message.command==='update'){if(busy||scheduled||stopping||recording)throw Error('Stop recording before changing capture settings.');const s=await readSession();s.name=String(message.name||'Chrome capture').slice(0,120);s.mode=message.mode==='simple'?'simple':'detailed';await writeSession(s);return {ok:true}}
  if(message.command==='stop'){stopping=true;recording=false;await pending;while(busy)await new Promise(r=>setTimeout(r,100));await detach();const s=await readSession();s.actions=[...(s.actions??[]),...actions];actions=[];if(skipped)s.notes=[...new Set([...s.notes,skipped+' clicks happened while a screen was saving. Record those steps again to include their states.'])];await writeSession(s);stopping=false;stage='Flow ready';emit();return {ok:true}}
  if(message.command==='clear'){if(busy||scheduled||stopping||recording)throw Error('Stop capture before clearing.');const s=await readSession();await writeSession({...s,id:crypto.randomUUID(),pages:[],transitions:[],journeys:[],actions:[],unchanged:0,notes:[],renderedFonts:[],renderedLines:{},renderedImages:[]});lastInfo=undefined;return {ok:true}}
  if(busy||scheduled||stopping)throw Error('Wait for the current capture to finish.')
  if(message.command==='capture'||message.command==='record'){
   if(recording)throw Error('Finish the current flow first.');const id=await currentTab();await attach(id)
   const width=Number(message.width??1440);if(![1440,1920].includes(width))throw Error('Choose a capture width of 1440 px or 1920 px.');await chrome.debugger.sendCommand({tabId:id},'Emulation.setDeviceMetricsOverride',{width,height:1024,deviceScaleFactor:1,mobile:false});const actual=await tabTransport(id).execute('innerWidth');if(actual!==width)throw Error('Chrome could not apply the selected capture width. Try again at 100% browser zoom.');
   if(message.command==='capture'){try{await take(id)}finally{if(!recording)await detach()}return {ok:true}}
   skipped=0;actions=[];lastInfo=undefined;const session=await readSession();session.journeys??=[];session.journeys.push({id:crypto.randomUUID(),name:session.name+(session.journeys.length?' · '+(session.journeys.length+1):''),pageIds:[]});await writeSession(session);const transport=tabTransport(id);await transport.send('Runtime.addBinding',{name:RECORD_BINDING});const installed=await transport.send('Page.addScriptToEvaluateOnNewDocument',{source:RECORD_SCRIPT});scriptId=installed.identifier;await take(id);await transport.execute(RECORD_SCRIPT);recording=true;stage='Recording · interact with the page, waiting for each screen to save';emit();return {ok:true}
  }
  throw Error('Unknown capture action.')
 })().then(reply,async error=>{lastError=error.message;busy=false;stopping=false;if(!recording)await detach();emit();reply({error:error.message})});return true
})
