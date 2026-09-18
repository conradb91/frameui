const { execFile } = require('child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
function security(args) {
  return new Promise((resolve,reject)=>execFile('/usr/bin/security',args,{maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(new Error(stderr.trim()||'Credential storage failed.')):resolve(stdout.trim())))
}
class Keychain {
  constructor(servicePrefix='com.stacker.localdev',options={}) { this.servicePrefix=servicePrefix; this.options=options }
  service(name){return `${this.servicePrefix}.${name}`}
  get platform(){return this.options.platform || process.platform}
  vault(name,account) {
    const electron=this.options.storage ? null : require('electron')
    const storage=this.options.storage || electron.safeStorage
    if (!storage.isEncryptionAvailable() || (this.platform==='linux' && storage.getSelectedStorageBackend?.()==='basic_text')) throw new Error('Encrypted credential storage is unavailable on this computer.')
    const root=this.options.directory || path.join(electron.app.getPath('userData'),'LocalEnvironment','credentials')
    const key=crypto.createHash('sha256').update(this.service(name)+'\0'+account).digest('hex')
    return {storage,root,file:path.join(root,key+'.encrypted')}
  }
  async set(name,account,value){
    if(this.platform==='darwin'){await security(['add-generic-password','-U','-s',this.service(name),'-a',account,'-w',value]);return true}
    const {storage,root,file}=this.vault(name,account)
    await fs.mkdir(root,{recursive:true,mode:0o700})
    const temporary=file+'.'+crypto.randomUUID()+'.writing'
    try{await fs.writeFile(temporary,storage.encryptString(value),{mode:0o600,flag:'wx'});await fs.rename(temporary,file)}finally{await fs.rm(temporary,{force:true})}
    return true
  }
  async get(name,account){
    if(this.platform==='darwin')return security(['find-generic-password','-s',this.service(name),'-a',account,'-w']).catch(()=>null)
    const {storage,file}=this.vault(name,account)
    const bytes=await fs.readFile(file).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))
    if(!bytes)return null
    try{return storage.decryptString(bytes)}catch{throw new Error('A saved credential could not be decrypted. Restore access to this computer’s credential storage before retrying.')}
  }
  async remove(name,account){
    if(this.platform==='darwin')await security(['delete-generic-password','-s',this.service(name),'-a',account]).catch(()=>null)
    else await fs.rm(this.vault(name,account).file,{force:true})
    return true
  }
}
module.exports={Keychain}
