const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto')
async function installLocalCrt(destination,architecture=process.arch,root=null){
 const roots=root?[root]:[...(process.resourcesPath?[path.join(process.resourcesPath,'windows-crt')]:[]),path.resolve(__dirname,'../../../build/windows-crt')]
 let payload,manifest
 for(const candidate of roots){payload=path.join(candidate,architecture);manifest=await fs.readFile(path.join(payload,'manifest.json'),'utf8').then(JSON.parse).catch(()=>null);if(manifest)break}
 if(!manifest)return false
 if(manifest.architecture!==architecture||!manifest.files?.['vcruntime140.dll']||!manifest.files?.['msvcp140.dll'])throw new Error('The Windows runtime support files are incomplete.')
 const verified=[]
 for(const [name,checksum] of Object.entries(manifest.files)){
  if(!/^(?:concrt|msvcp|vcruntime)\d+(?:_[a-z0-9]+)*\.dll$/i.test(name)||!/^[a-f0-9]{64}$/.test(checksum))throw new Error('Invalid Windows runtime support manifest.')
  const bytes=await fs.readFile(path.join(payload,name))
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==checksum)throw new Error('Windows runtime support integrity verification failed.')
  await require('./windows-php.cjs').verifyWindowsPhp(path.join(payload,name),architecture)
  verified.push([name,bytes])
 }
 for(const [name] of verified){const existing=await fs.lstat(path.join(destination,name)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));if(existing && !existing.isFile())throw new Error('Unsafe Windows runtime support destination.')}
 for(const [name,bytes] of verified)await fs.writeFile(path.join(destination,name),bytes)
 return true
}
module.exports={installLocalCrt}
