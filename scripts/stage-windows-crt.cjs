// Stage app-local runtime DLLs from the Windows build machine's installed Visual Studio tools.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto')
const {execFileSync}=require('node:child_process')
async function stage(){
 if(process.platform!=='win32')throw new Error('Windows runtime staging requires a Windows build machine with Visual C++ build tools.')
 const architecture=process.env.FRAMEUI_WINDOWS_ARCH||process.arch
 if(!['x64','arm64'].includes(architecture))throw new Error('Unsupported Windows architecture.')
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe')
 const installation=execFileSync(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim()
 if(!installation)throw new Error('Visual C++ build tools were not found.')
 const redist=path.join(installation,'VC/Redist/MSVC')
 const versions=(await fs.readdir(redist)).filter(name=>/^\d+(?:\.\d+)+$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))
 let source
 for(const version of versions){const root=path.join(redist,version,architecture);const names=await fs.readdir(root).catch(()=>[]);const name=names.find(name=>/^Microsoft\.VC\d+\.CRT$/i.test(name));if(name){source=path.join(root,name);break}}
 if(!source)throw new Error('The selected architecture’s redistributable CRT files were not found.')
 const destination=path.resolve(__dirname,'../build/windows-crt',architecture)
 const staging=destination+'.staging-'+crypto.randomUUID()
 try{
  await fs.mkdir(staging,{recursive:true});const files={}
  for(const name of await fs.readdir(source))if(/^(?:concrt|msvcp|vcruntime)\d+(?:_[a-z0-9]+)*\.dll$/i.test(name)){
   const bytes=await fs.readFile(path.join(source,name));files[name]=crypto.createHash('sha256').update(bytes).digest('hex');await fs.writeFile(path.join(staging,name),bytes)
  }
  if(!files['vcruntime140.dll']||!files['msvcp140.dll'])throw new Error('The CRT payload is incomplete.')
  await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify({architecture,files},null,2))
  await require('../hosting/stacker/lib/database-runtime-manager.cjs').publishRuntime(staging,destination)
  console.log(`Staged ${Object.keys(files).length} app-local CRT DLLs for ${architecture}.`)
 }finally{await fs.rm(staging,{recursive:true,force:true})}
}
stage().catch(error=>{console.error(error.message);process.exitCode=1})
