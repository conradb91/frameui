const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {downloadVerified,extractArchive}=require('./verified-archive.cjs')
const {verifyWindowsPhp}=require('./windows-php.cjs')
class WindowsDatabaseRuntime {
 constructor(root,emit,architecture=process.arch){this.arch=architecture;this.root=path.join(root,'databases','win32');this.emit=emit}
 catalog(engine){return require('./windows-database-catalog.json').filter(entry=>entry.engine===engine && entry.architecture===this.arch).map(entry=>({...entry,installed:this.installedVersions(engine).includes(entry.version)}))}
 installedVersions(engine){return this.catalogEntries(engine).filter(entry=>entry.requiredExecutables.every(file=>sync.existsSync(path.join(this.root,engine,entry.version,this.arch,'bin',file)))).map(entry=>entry.version)}
 catalogEntries(engine){return require('./windows-database-catalog.json').filter(entry=>entry.engine===engine && entry.architecture===this.arch)}
 binDir(engine){for(const entry of this.catalogEntries(engine)){const dir=path.join(this.root,engine,entry.version,this.arch,'bin');if(entry.requiredExecutables.every(file=>sync.existsSync(path.join(dir,file))))return {dir,version:entry.version,variant:engine==='postgres'?'postgres':'mysql'}}return null}
 async install(engine){
  const entry=this.catalogEntries(engine)[0]
  if(!entry)throw new Error('No approved Windows database build matches this architecture.')
  const {validRuntime,publishRuntime}=require('./database-runtime-manager.cjs')
  const target=path.join(this.root,engine,entry.version,this.arch)
  if(entry.requiredExecutables.every(file=>sync.existsSync(path.join(target,'bin',file))) && await validRuntime(path.join(target,'bin',entry.executable),entry.version))return {installed:true,version:entry.version,path:target}
  const archive=path.join(this.root,'downloads',entry.file)
  let failure
  for(let attempt=0;attempt<3;attempt++){
   const staging=target+'.installing-'+crypto.randomUUID()
   try{
    this.emit('database-runtime',{engine,version:entry.version,status:'Downloading',progress:0})
    await downloadVerified({urls:[entry.url],checksum:entry.sha256,archive,onProgress:(received,total)=>this.emit('database-runtime',{engine,version:entry.version,status:'Downloading',progress:total?Math.round(received/total*100):null})})
    this.emit('database-runtime',{engine,version:entry.version,status:'Installing',progress:100})
    await extractArchive(archive,staging,1)
    const bin=path.join(staging,'bin')
    for(const executable of entry.requiredExecutables)await verifyWindowsPhp(path.join(bin,executable),this.arch)
    await require('./windows-crt.cjs').installLocalCrt(bin)
    if(!(await validRuntime(path.join(bin,entry.executable),entry.version)))throw new Error('The Windows database executable did not pass its startup check.')
    await publishRuntime(staging,target)
    this.emit('database-runtime',{engine,version:entry.version,status:'Installed',progress:100})
    return {installed:true,version:entry.version,path:target}
   }catch(error){failure=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*2**attempt))}
   finally{await fs.rm(staging,{recursive:true,force:true,maxRetries:3})}
  }
  this.emit('database-runtime',{engine,version:entry.version,status:'Failed',error:failure.message})
  throw failure
 }
 async remove(engine,version){if(!this.catalogEntries(engine).some(entry=>entry.version===version))throw new Error('Unknown Windows database version.');await fs.rm(path.join(this.root,engine,version),{recursive:true,force:true})}
}
module.exports={WindowsDatabaseRuntime}
