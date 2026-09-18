const {execFile}=require('node:child_process')
/** Wait for Windows tree termination so a retry cannot race taskkill. */
async function signalProcess(pid,child,signal,processGroup=null,{platform=process.platform,execute=execFile,kill=process.kill.bind(process)}={}) {
  if (!Number.isSafeInteger(pid) || pid<=0) return false
  if (platform==='win32') return new Promise(resolve=>execute('taskkill.exe',['/pid',String(pid),'/T','/F'],{windowsHide:true,timeout:10000},error=>resolve(!error)))
  try { if(processGroup)kill(-processGroup,signal);else if(child)child.kill(signal);else kill(pid,signal);return true }catch{return false}
}
module.exports={signalProcess}
