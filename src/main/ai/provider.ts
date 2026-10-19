import { findClaudeCode, claudeCodeAuthenticated, claudeCodeModels, runClaudeCode } from './claudeCode'
import fs from 'node:fs'
import path from 'node:path'
import electron from 'electron'
import { cliAvailable, cliToken, promptApiKey, removeApiKey, savedApiKey, saveApiKey } from './credentials'
import type { ClaudeStatus,ClaudeEffort } from '@shared/types/ai'
import { writeJsonFileAtomic } from '@core/workspace/atomicJson'

type Settings = { authentication: 'api-key' | 'cli' | 'claude-code' | null; model: string; workspace?:string;efforts?:Record<string,ClaudeEffort> }
const settingsFile = () => path.join(electron.app.getPath('userData'), 'ai-provider.json')
function settings(): Settings { try { const raw=JSON.parse(fs.readFileSync(settingsFile(),'utf8')).data; return { authentication: ['api-key','cli','claude-code'].includes(raw.authentication) ? raw.authentication : null, model: typeof raw.model==='string' ? raw.model : '', efforts:raw.efforts&&typeof raw.efforts==='object'?raw.efforts:{},workspace:typeof raw.workspace==='string'?raw.workspace:undefined } } catch { return { authentication:null, model:'' } } }
let observedWorkspace:string|undefined
let models: ClaudeStatus['models'] = []
export async function anthropicRequest(endpoint: 'models' | 'messages', body?: unknown, signal?: AbortSignal, auth?: { type: 'api-key' | 'cli'; secret: string; workspace?:string }): Promise<unknown> {
  const config=settings()
  const type = auth?.type ?? config.authentication
  if (!type) throw new Error('Connect Claude before starting a task.')
  if (type === 'claude-code') throw new Error('Claude Code requests must run through the official CLI.')
  const secret = auth?.secret ?? (type === 'api-key' ? await savedApiKey() : await cliToken())
  if (!secret) throw new Error('Reconnect Claude to restore access.')
  const response = await fetch(`https://api.anthropic.com/v1/${endpoint}`, {
    method: body ? 'POST' : 'GET', redirect:'error',
    headers: { 'anthropic-version':'2023-06-01', 'content-type':'application/json', authorization:`Bearer ${secret}`, ...((auth?auth.workspace:config.workspace)?{'anthropic-workspace-id':(auth?auth.workspace:config.workspace)!}:{}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(20000),
  }).catch(() => { throw new Error(signal?.aborted ? 'Claude task cancelled.' : 'Cannot reach Anthropic. Check your connection and retry.') })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(response.status===401 || response.status===403 ? 'Anthropic rejected the connection. Check your key and workspace access.' : response.status===429 ? 'Anthropic usage or rate limit reached. Check your Console account and retry later.' : response.status===400?'Anthropic rejected the request. For a multi-workspace API key, enter its workspace ID and reconnect.':`Anthropic request failed (${response.status}).`)
  }
  observedWorkspace=response.headers.get('anthropic-workspace-id')??auth?.workspace??config.workspace
  const raw=await response.text()
  if(raw.length>12_000_000) throw new Error('Anthropic response exceeded the safe size limit.')
  return JSON.parse(raw)
}
async function loadModels(auth?: { type:'api-key'|'cli'; secret:string; workspace?:string }) {
  if (!auth && settings().authentication === 'claude-code') { const executable=findClaudeCode();if(!executable){models=[];return}models = await claudeCodeModels(executable); return }
  const result=await anthropicRequest('models',undefined,undefined,auth) as {data?: {id:string;display_name:string}[]}
  models=(result.data ?? []).filter(m=>typeof m.id==='string' && typeof m.display_name==='string').map(m=>({id:m.id,name:m.display_name}))
  if(!models.length) throw new Error('No Claude models are available for this account.')
}
export async function providerStatus(refresh=false): Promise<ClaudeStatus> {
  const config=settings()
  const executable = findClaudeCode()
  const codeConnected = config.authentication === 'claude-code' && !!executable && await claudeCodeAuthenticated(executable)
  if(refresh && config.authentication&&(config.authentication!=='claude-code'||codeConnected)) await loadModels()
  return { connected:config.authentication==='claude-code'?codeConnected:config.authentication!==null, authentication:config.authentication, model:config.model, effort:selectedEffort(),models, workspace:observedWorkspace??config.workspace, claudeCodeAvailable:!!executable, cliAvailable:await cliAvailable(), browserLoginAvailable:!electron.app.isPackaged }
}
export async function connectProvider(method:'api-key'|'cli'|'cli-login'|'claude-code'|'claude-code-login',workspace?:string): Promise<ClaudeStatus> {
  if (method === 'claude-code' || method === 'claude-code-login') {
    const executable = findClaudeCode()
    if (!executable) throw new Error('Install the official Claude Code CLI, then retry. FrameUI will detect its standard installation location.')
    if (method === 'claude-code-login') await runClaudeCode(executable, ['auth', 'login'], {timeout:180_000})
    if (!await claudeCodeAuthenticated(executable)) throw new Error('Sign in with Claude Code first. Run claude auth login in Terminal, then choose Use existing Claude Code login.')
    models = await claudeCodeModels(executable); observedWorkspace = undefined
    const old = settings()
    fs.mkdirSync(path.dirname(settingsFile()), {recursive:true})
    writeJsonFileAtomic(settingsFile(), {authentication:'claude-code',efforts:old.efforts, model:models.some(m=>m.id===old.model)?old.model:'default'})
    return providerStatus()
  }
  const type=method==='api-key'?'api-key':'cli'
  const secret=type==='api-key'?await promptApiKey():await cliToken(method==='cli-login')
  if(type==='api-key' && !/^sk-ant-api[\w-]+$/.test(secret)) throw new Error('Enter an Anthropic Console API key, not a Claude subscription token.')
  observedWorkspace=undefined
  await loadModels({type,secret,workspace:type==='api-key'?workspace:undefined})
  if(type==='api-key') await saveApiKey(secret)
  const config=settings();config.authentication=type;config.workspace=observedWorkspace??workspace
  if(!models.some(m=>m.id===config.model))config.model=models.find(m=>/sonnet/i.test(m.id))?.id ?? models[0].id
  fs.mkdirSync(path.dirname(settingsFile()),{recursive:true});writeJsonFileAtomic(settingsFile(),config)
  return providerStatus()
}
export async function disconnectProvider() { if(settings().authentication==='api-key')await removeApiKey();writeJsonFileAtomic(settingsFile(),{authentication:null,model:''});models=[];observedWorkspace=undefined;return providerStatus() }
export async function setProviderModel(model:string) { if(!models.length)await loadModels();if(!models.some(m=>m.id===model))throw new Error('Select an available Claude model.');writeJsonFileAtomic(settingsFile(),{...settings(),model});return providerStatus() }
export const selectedModel=()=>settings().model

export const usesClaudeCode=()=>settings().authentication==='claude-code'

export function selectedEffort():ClaudeEffort {const config=settings(),value=config.efforts?.[config.model]??'default';return value==='default'||models.find(m=>m.id===config.model)?.effortLevels?.includes(value)?value:'default'}
export async function setProviderEffort(effort:ClaudeEffort){const config=settings();if(!models.length)await loadModels();if(effort!=='default'&&!models.find(m=>m.id===config.model)?.effortLevels?.includes(effort))throw new Error('This model does not support that effort level.');writeJsonFileAtomic(settingsFile(),{...config,efforts:{...config.efforts,[config.model]:effort}});return providerStatus()}
