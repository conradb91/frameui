const {spawnSync}=require('node:child_process')
const result=spawnSync(process.env.FRAMEUI_ELECTRON_PATH||require('electron'),process.argv.slice(2),{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',windowsHide:true})
if(result.error)console.error(result.error.message)
process.exitCode=result.status??1
