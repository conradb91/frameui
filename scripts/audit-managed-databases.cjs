const fs=require('node:fs/promises')
const path=require('node:path')
const net=require('node:net')
const assert=require('node:assert/strict')
const {execFile}=require('node:child_process')
const {DatabaseRuntimeManager}=require('../hosting/stacker/lib/database-runtime-manager.cjs')
const {DatabaseServices}=require('../hosting/stacker/lib/database-services.cjs')
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
async function run(file,args,env){return new Promise((resolve,reject)=>execFile(file,args,{env,timeout:60000},(error,stdout)=>error?reject(error):resolve(stdout.trim())))}
;(async()=>{
 const root=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'frameui-db-audit-')), cache=process.env.FRAMEUI_DATABASE_CACHE || path.join(require('node:os').tmpdir(),'frameui-db-runtime-audit')
 const secrets=new Map(),credentials={get:async(name,account)=>secrets.get(name+account),set:async(name,account,value)=>secrets.set(name+account,value)}
 const runtime=new DatabaseRuntimeManager(cache,(_,e)=>{if(e.status!=='Downloading'||e.progress===100)console.log(e.engine,e.status)})
 const services=new DatabaseServices(root,credentials,()=>{},runtime)
 try{
  for(const engine of ['postgres','mariadb']){
   services.ports[engine]=await freePort()
   await runtime.install(engine)
   await services.initialize(engine);await services.start(engine)
   const bin=services.binaries(engine),password=await services.password(engine)
   const query=async sql=>engine==='postgres'?run(bin.psql,['-h','127.0.0.1','-p',String(services.ports[engine]),'-U','stacker','-d','postgres','-At','-c',sql],{...process.env,PGPASSWORD:password}):run(bin.client,['--protocol=TCP','-h','127.0.0.1','-P',String(services.ports[engine]),'-u','root','-N','-e',sql],process.env)
   assert.equal(await query('SELECT 42'),'42')
   await services.stop(engine);await services.start(engine)
   assert.equal(await query('SELECT 43'),'43')
   await services.stop(engine)
   console.log(engine+' verified download → initialize → start → SQL → stop → restart → SQL passed')
  }
 }finally{await services.shutdown();await fs.rm(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error.message);process.exitCode=1})
