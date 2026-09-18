const {readEffectiveEnvironment,parseEnv,isEnvironmentSecret} = require('./environment.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
/** Rewrite only explicit local API connections whose original port identifies one service. */
function serviceOverrides(variables,services,applicationUrl) {
  const result = {}
  for (const item of variables) {
    if (!/(?:API|BACKEND|SERVICE|SERVER).*URL$/i.test(item.key) || isEnvironmentSecret(item.key)) continue
    let url
    try { url = new URL(item.value) } catch { continue }
    if (!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password) continue
    const matches = services.filter(service=>Number(service.preferredPort) === Number(url.port || (url.protocol === 'https:' ? 443 : 80)))
    if (matches.length !== 1) continue
    const base = new URL(applicationUrl)
    base.pathname = `/__frameui_services/${encodeURIComponent(matches[0].id)}${url.pathname}`
    base.search = url.search
    result[item.key] = base.href
  }
  return result
}
async function configureServiceConnections(project,services) {
  const environment = await readEffectiveEnvironment(project)
  const updates = serviceOverrides(environment.variables,services,project.localUrl)
  if (!Object.keys(updates).length) return []
  const file = path.join(project.path,'.env.stacker.local')
  const prior = await fs.readFile(file,'utf8').catch(error=>error.code === 'ENOENT' ? '' : Promise.reject(error))
  const values = new Map(parseEnv(prior).filter(item=>item.type==='variable').map(item=>[item.key,item.value]))
  for(const [key,value] of Object.entries(updates)) values.set(key,value)
  const temporary=file+'.'+require('node:crypto').randomUUID()+'.writing'
  try { await fs.writeFile(temporary,[...values].map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600}); await fs.rename(temporary,file) }
  finally { await fs.rm(temporary,{force:true}) }
  return Object.keys(updates)
}
module.exports = {serviceOverrides,configureServiceConnections}
