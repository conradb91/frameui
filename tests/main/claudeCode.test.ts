import { test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claudeCodeAuthenticated, runClaudeCode, startDesignBridge } from '../../src/main/ai/claudeCode'

test('design bridge requires private authorization and rejects browser origins and unknown tools', async () => {
  let calls = 0
  const bridge = await startDesignBridge([{name:'inspect',description:'Inspect',input_schema:{type:'object'}}], async () => { calls++; return {content:[{type:'text',text:'ok'}]} }, new AbortController().signal)
  const {url,headers} = bridge.config.mcpServers.frameui
  const body = JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'inspect'}})
  try {
    expect((await fetch(url,{method:'POST',body})).status).toBe(403)
    expect((await fetch(url,{method:'POST',headers:{...headers,Origin:'http://evil.local'},body})).status).toBe(403)
    expect(calls).toBe(0)
    const call = await fetch(url,{method:'POST',headers,body}).then(r=>r.json())
    expect(call.result.content[0].text).toBe('ok')
    expect(calls).toBe(1)
    const unknown = await fetch(url,{method:'POST',headers,body:body.replace('inspect','Bash')}).then(r=>r.json())
    expect(unknown.result.isError).toBe(true)
    expect(calls).toBe(1)
  } finally { await bridge.close() }
})

test('bridge serializes document mutations and refuses calls after cancellation', async () => {
  const controller = new AbortController()
  let active = 0, maximum = 0, calls = 0
  const bridge = await startDesignBridge([{name:'edit',description:'Edit',input_schema:{type:'object'}}],async()=>{
    calls++; maximum=Math.max(maximum,++active)
    await new Promise(resolve=>setTimeout(resolve,10)); active--
    return {content:[{type:'text',text:'ok'}]}
  },controller.signal)
  const {url,headers} = bridge.config.mcpServers.frameui
  const call = (id:number)=>fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'edit'}})})
  try {
    await Promise.all([call(1),call(2)])
    expect(maximum).toBe(1); expect(calls).toBe(2)
    controller.abort()
    expect((await call(3)).status).toBe(400);expect(calls).toBe(2)
  } finally { await bridge.close() }
})

test('CLI auth status checks login without reading or returning credentials', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-cli-test-')), cli=path.join(dir,'claude')
  try {
    fs.writeFileSync(cli,'#!/bin/sh\n[ "$1" = "auth" ] && [ "$2" = "status" ] || exit 9\nprintf \'{"loggedIn":true,"authMethod":"claude.ai"}\'\n',{mode:0o700})
    expect(await claudeCodeAuthenticated(cli)).toBe(true)
    fs.writeFileSync(cli,'#!/bin/sh\necho private-error >&2\nexit 1\n',{mode:0o700})
    expect(await claudeCodeAuthenticated(cli)).toBe(false)
    await expect(runClaudeCode(cli,[])).rejects.toThrow('Claude Code could not complete')
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
})

test('CLI cancellation and timeout terminate the child', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-cli-test-')),cli=path.join(dir,'claude')
  try {
    fs.writeFileSync(cli,'#!/bin/sh\nexec sleep 30\n',{mode:0o700})
    const controller=new AbortController()
    const running=runClaudeCode(cli,[],{signal:controller.signal})
    controller.abort()
    await expect(running).rejects.toThrow('cancelled')
    await expect(runClaudeCode(cli,[],{timeout:20})).rejects.toThrow('timed out')
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
})

test('streamed CLI events survive split chunks and preserve readable task diagnostics', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-cli-stream-')),script=path.join(dir,'fixture.cjs')
  try {
    fs.writeFileSync(script,`process.stdout.write('{"type":"stream_event","event":'); setTimeout(()=>{process.stdout.write('{"delta":{"type":"text_delta","text":"Hello"}}}\\n{"type":"result","subtype":"success","result":"Hello"}\\n')},10)`)
    const events: any[]=[]
    await runClaudeCode(process.execPath,[script],{onEvent:event=>events.push(event)})
    expect(events.map(e=>e.type)).toEqual(['stream_event','result'])
    expect(events[0].event.delta.text).toBe('Hello')
    fs.writeFileSync(script,`console.error('Error: --input-format=stream-json requires output-format=stream-json.');process.exit(1)`)
    // A shell fixture keeps the -p diagnostic switch out of the interpreter's options.
    const cli=path.join(dir,'claude')
    fs.writeFileSync(cli,'#!/bin/sh\necho "Error: --input-format=stream-json requires output-format=stream-json." >&2\nexit 1\n',{mode:0o700})
    await expect(runClaudeCode(cli,['-p'])).rejects.toThrow('--input-format=stream-json requires output-format=stream-json')
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
})

test('task diagnostics redact credentials, login URLs and email addresses', async () => {
  const {cliErrorDetail}=await import('../../src/main/ai/claudeCode')
  const result=cliErrorDetail('API failed sk-ant-oat01-private Bearer secret-value https://claude.ai/oauth?code=private user@example.com token=private')
  expect(result).not.toContain('private');expect(result).not.toContain('secret-value');expect(result).not.toContain('user@example.com')
  expect(result).toContain('API failed')
})

test('Claude turn-limit completion remains reviewable instead of discarding tool work',async()=>{
 const {runDesignWithClaudeCode}=await import('../../src/main/ai/claudeCode')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-cli-limit-')),previous=process.env.PATH
 try{
  fs.writeFileSync(path.join(dir,'claude'),'#!/bin/sh\necho \'{"type":"result","subtype":"error_max_turns","is_error":true,"errors":["Reached maximum number of turns (48)"]}\'\nexit 1\n',{mode:0o700})
  process.env.PATH=dir+path.delimiter+previous
  const message=await runDesignWithClaudeCode({system:'test',content:[],model:'default',tools:[],execute:async()=>({}),signal:new AbortController().signal})
  expect(message).toContain('Draft paused')
  expect(message).toContain('continue')
 }finally{process.env.PATH=previous;fs.rmSync(dir,{recursive:true,force:true})}
})
