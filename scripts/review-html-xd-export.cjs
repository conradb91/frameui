// Real HTML -> observed states -> editable FrameUI document -> native XD worker.
// Stores user artwork only in the chosen local destination and temporary review directory.
const {_electron}=require('playwright-core'),{buildSync}=require('esbuild'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const input=process.env.FRAMEUI_REVIEW_HTML,output=process.env.FRAMEUI_REVIEW_XD;if(!input||!output)throw Error('Set FRAMEUI_REVIEW_HTML and FRAMEUI_REVIEW_XD.');
(async()=>{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-html-xd-'));let app;const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE;
try{buildSync({stdin:{contents:"export {artifactFlow} from './src/core/prototype/artifactFlow';export {packDocument,unpackDocument} from './src/shared/documentResources'",resolveDir:process.cwd(),loader:'ts'},outfile:path.join(temp,'flows.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'warning'});const {artifactFlow,packDocument,unpackDocument}=require(path.join(temp,'flows.cjs'));
 app=await _electron.launch({executablePath:require('electron'),args:[process.env.FRAMEUI_REVIEW_APP_ROOT||'.',`--user-data-dir=${temp}/profile`],env});const page=await app.firstWindow();await page.getByRole('button',{name:/Import HTML prototype/}).waitFor();await app.evaluate(({dialog,BrowserWindow},{input,output})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});dialog.showSaveDialog=async()=>({canceled:false,filePath:output});for(const w of BrowserWindow.getAllWindows()){w.webContents.setBackgroundThrottling(false);w.hide()}},{input:path.resolve(input),output:path.resolve(output)});
 await page.evaluate(()=>{window.frameui.project.onPrototypeImportProgress(p=>console.log(p.detail));window.frameui.design.onProgress(p=>console.log(JSON.stringify({...p,thumbnail:undefined})));window.frameui.export.onXdProgress(p=>console.log(p.stage))});page.on('console',m=>{console.log(m.type()+': '+m.text().slice(0,700))});
 let imported;
 if(process.env.FRAMEUI_REVIEW_MERGE_DOCUMENT){
  // Reuse verified native captures for this unchanged source by replay path,
  // retaining earlier observed views while adding a fresh discovery frontier.
  const seed=JSON.parse(await page.evaluate(async()=>{const importId=crypto.randomUUID(),project=await window.frameui.project.importPrototype(importId);return JSON.stringify({importId,project})}));
  if(process.env.FRAMEUI_REVIEW_CHECKPOINT)fs.copyFileSync(process.env.FRAMEUI_REVIEW_CHECKPOINT,path.join(seed.project.project.path,'frameui-discovery-checkpoint.json'));
  seed.plan=JSON.parse(await page.evaluate(async({id,width,resume})=>JSON.stringify(await window.frameui.design.discoverArtifact(id,width,resume)),{id:seed.importId,width:Number(process.env.FRAMEUI_REVIEW_WIDTH||1440),resume:!!process.env.FRAMEUI_REVIEW_CHECKPOINT}));
  const previous=unpackDocument(JSON.parse(fs.readFileSync(process.env.FRAMEUI_REVIEW_MERGE_DOCUMENT,'utf8')));
  try{
   const checkpoint=JSON.parse(fs.readFileSync(path.join(seed.project.project.path,'frameui-discovery-checkpoint.json'),'utf8')).checkpoint;
   const stateByRoute=new Map(checkpoint.states.map(state=>[state.pattern,state]));
   const captureKey=(pathname,steps)=>JSON.stringify([pathname,steps??[]]);
   const keyForPage=p=>p.artifactSource&&captureKey(p.artifactSource.path,p.artifactSource.steps);
   const oldPages=previous.pages.filter(p=>!p.flowIntroductionFor),oldById=new Map(oldPages.map(p=>[p.id,p])),oldByKey=new Map();for(const p of oldPages){const key=keyForPage(p);if(key&&!oldByKey.has(key))oldByKey.set(key,p)}
   const routeKeys=new Map(seed.plan.routes.map(r=>{const state=stateByRoute.get(r.pattern),u=new URL(state.url);return [r.pattern,captureKey(u.pathname+u.search+u.hash,state.steps)]}));
   const freshRoutes=seed.plan.routes.filter(r=>!oldByKey.has(routeKeys.get(r.pattern))).map(r=>r.pattern);
   console.log('Capture cache '+JSON.stringify({retained:oldByKey.size,fresh:freshRoutes.length}));
   const freshRaw=freshRoutes.length?await page.evaluate(async request=>window.frameui.design.captureSerialized(request),{token:seed.plan.token,artifactImportId:seed.importId,routes:freshRoutes,widths:[Number(process.env.FRAMEUI_REVIEW_WIDTH||1440)],unchanged:[]}):[];
   const fresh=typeof freshRaw==='string'?unpackDocument(JSON.parse(freshRaw)):freshRaw,freshByRoute=new Map(fresh.map(p=>[p.route,p])),pages=[],routeByKey=new Map();
   const clean=p=>{const c=structuredClone(p);for(const key of ['flowInstanceFor','canonicalStateId','canvasX','canvasY'])delete c[key];return c};
   for(const route of seed.plan.routes){const key=routeKeys.get(route.pattern),old=oldByKey.get(key),p=old?clean(old):freshByRoute.get(route.pattern);if(!p)continue;p.route=route.pattern;p.name=route.name;pages.push(p);routeByKey.set(key,route.pattern)}
   let i=0;for(const [key,old] of oldByKey){if(routeByKey.has(key))continue;const p=clean(old);p.route='/__retained_state_'+(++i);pages.push(p);routeByKey.set(key,p.route);seed.plan.routes.push({pattern:p.route,name:p.name})}
   const edges=[...seed.plan.transitions],edgeKey=e=>JSON.stringify([e.source,e.destination,e.selector,e.trigger??'click',e.action??'navigate',e.value,e.key]),seen=new Set(edges.map(edgeKey));
   for(const edge of previous.prototype?.interactions??[]){const source=oldById.get(edge.sourceArtboardId),destination=oldById.get(edge.destinationId),from=source&&routeByKey.get(keyForPage(source)),to=destination&&routeByKey.get(keyForPage(destination));if(!from||!to)continue;let selector;const walk=ns=>ns.forEach(n=>{if(n.id===edge.sourceElementId)selector=n.source.selector;walk(n.children)});if(source.structured)walk(source.structured.children);if(!selector&&edge.trigger!=='key'&&edge.kind!=='scroll')continue;const item={source:from,destination:to,selector:selector??'',label:edge.label??'Open view',kind:edge.kind,componentType:edge.componentType,trigger:edge.trigger,action:edge.action,value:edge.inputValue,key:edge.key};if(!seen.has(edgeKey(item))){seen.add(edgeKey(item));edges.push(item)}}
   seed.plan.transitions=edges;imported={project:seed.project,plan:seed.plan,pages};
  }finally{await page.evaluate(id=>window.frameui.project.finishPrototypeImport(id),seed.importId)}
 }else if(process.env.FRAMEUI_REVIEW_DOCUMENT){
  const source=unpackDocument(JSON.parse(fs.readFileSync(process.env.FRAMEUI_REVIEW_DOCUMENT,'utf8'))),pages=source.pages.filter(p=>!p.flowIntroductionFor).sort((a,b)=>{const rank=p=>p.route?.startsWith('/__prototype_state_')?Number(p.route.split('_').at(-1))+1:0;return rank(a)-rank(b)}),byId=new Map(pages.map(p=>[p.id,p]));
  const transitions=source.prototype.interactions.flatMap(edge=>{const page=byId.get(edge.sourceArtboardId),destination=byId.get(edge.destinationId);let selector;const walk=ns=>ns.forEach(n=>{if(n.id===edge.sourceElementId)selector=n.source.selector;walk(n.children)});if(page?.structured)walk(page.structured.children);return page&&destination&&selector?[{source:page.route,destination:destination.route,selector,label:edge.label??'Open state'}]:[]});
  const previous=path.join(path.dirname(process.env.FRAMEUI_REVIEW_DOCUMENT),'report.json'),warnings=fs.existsSync(previous)?JSON.parse(fs.readFileSync(previous,'utf8')).discoveryWarnings:[];
  if(warnings.length)pages[0].captureWarnings=[...(pages[0].captureWarnings??[]),...warnings];
  imported={project:{project:{id:source.projectId,name:source.name},url:source.appUrl},plan:{routes:pages.map(p=>({pattern:p.route})),transitions,warnings},pages};
 }else{
 imported=JSON.parse(await page.evaluate(async reuse=>{const id=crypto.randomUUID(),project=await window.frameui.project.importPrototype(id);try{const width=Number(reuse.width),plan=await window.frameui.design.discoverArtifact(id,width);const pages=reuse.reuse?[]:await window.frameui.design.captureSerialized({token:plan.token,artifactImportId:id,routes:reuse.routes??(reuse.names?plan.routes.filter((r,index)=>reuse.names.includes(r.name)&&plan.routes.findIndex(other=>other.name===r.name)===index||!r.steps?.length&&!r.pattern.startsWith('/__prototype_state_')).map(r=>r.pattern):undefined),widths:[width],unchanged:[]});return JSON.stringify({project,plan,pages})}finally{await window.frameui.project.finishPrototypeImport(id)}},{reuse:!!process.env.FRAMEUI_REVIEW_CAPTURE_DIR,width:Number(process.env.FRAMEUI_REVIEW_WIDTH||1440),routes:process.env.FRAMEUI_REVIEW_REFRESH_ROUTES?.split(','),names:process.env.FRAMEUI_REVIEW_NAMES?.split('|')}));
 }

 if(typeof imported.pages==='string')imported.pages=unpackDocument(JSON.parse(imported.pages));
 if(process.env.FRAMEUI_REVIEW_NAMES)for(const name of process.env.FRAMEUI_REVIEW_NAMES.split('|'))assert(imported.pages.some(p=>p.name===name),'Missing native capture: '+name);
 if(process.env.FRAMEUI_REVIEW_REFRESH_DOCUMENT){
  const previous=unpackDocument(JSON.parse(fs.readFileSync(process.env.FRAMEUI_REVIEW_REFRESH_DOCUMENT,'utf8')));
  const fresh=new Map(imported.pages.map(p=>[p.route,p]));
  imported.pages=previous.pages.filter(p=>!p.flowIntroductionFor).map(p=>fresh.has(p.route)?{...fresh.get(p.route),id:p.id}:p);
  assert([...fresh.keys()].every(route=>imported.pages.some(p=>p.route===route)),'Refreshed routes must match the source document');
 }


 if(process.env.FRAMEUI_REVIEW_CAPTURE_DIR){
  const frames=new Map(fs.readdirSync(process.env.FRAMEUI_REVIEW_CAPTURE_DIR).filter(f=>f.endsWith('.json')&&!f.endsWith('.legacy.json')).flatMap(f=>{const value=JSON.parse(fs.readFileSync(path.join(process.env.FRAMEUI_REVIEW_CAPTURE_DIR,f),'utf8'));const d=value.data??value;return (d.frames??[]).map(frame=>[frame.sourceRoute,frame])}));
  imported.pages=imported.plan.routes.map(route=>{const frame=frames.get(route.pattern);assert(frame,'No stored capture for '+route.pattern);return {id:crypto.randomUUID(),name:route.name,route:route.pattern,width:frame.width,height:frame.height,structured:frame,fonts:frame.fonts,objects:[],folder:'Imported prototype',pinned:false,state:'Desktop',artifactSource:{path:new URL(route.url).pathname,steps:[]}}});
 }
 console.log('Discovery summary '+JSON.stringify({routes:imported.plan.routes,warnings:imported.plan.warnings}));assert(imported.pages.length>0);imported.pages.sort((a,b)=>imported.plan.routes.findIndex(r=>r.pattern===a.route)-imported.plan.routes.findIndex(r=>r.pattern===b.route));const prototype=artifactFlow(imported.pages,imported.plan.transitions.filter(edge=>!process.env.FRAMEUI_REVIEW_NAMES||imported.pages.some(p=>p.route===edge.source)&&imported.pages.some(p=>p.route===edge.destination)),imported.project.project.name,imported.plan.coverage),document={version:1,id:crypto.randomUUID(),name:imported.project.project.name,updatedAt:new Date().toISOString(),projectId:imported.project.project.id,appUrl:imported.project.url,pages:imported.pages,prototype,components:[],variables:[]};
 fs.writeFileSync(path.join(temp,'design.json'),JSON.stringify(packDocument(document)));const requestFile=path.join(temp,'export-request.json');fs.writeFileSync(requestFile,JSON.stringify(packDocument({jobId:crypto.randomUUID(),document,scope:'all',includePrototype:true})));const saved=await app.evaluate(async({ipcMain,BrowserWindow},file)=>{const handler=ipcMain._invokeHandlers.get('export:saveXd');if(!handler)throw Error('Native XD export handler is unavailable');return handler({sender:BrowserWindow.getAllWindows()[0].webContents},JSON.parse(process.getBuiltinModule('fs').readFileSync(file,'utf8')))},requestFile);assert(saved.ok,saved.error);assert(fs.existsSync(output));assert(!saved.report.warnings.some(w=>w.includes('Icon font outline unavailable')),'Every captured icon font needs its vector outline');
 const report={source:input,output,screens:imported.pages.filter(p=>!p.flowIntroductionFor).length,guides:imported.pages.filter(p=>p.flowIntroductionFor).length,observedConnections:prototype.interactions.length,discoveryWarnings:imported.plan.warnings,export:saved.report,temporaryDesign:path.join(temp,'design.json')};fs.writeFileSync(path.join(temp,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(app)await app.close()}})().catch(e=>{console.error(e);process.exitCode=1});
