import {test,expect} from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {nodePlatform,executableEnvironment,nodeCommand} = require('../../../hosting/stacker/lib/runtime-platform.cjs')
const {windowsBuilds,verifyWindowsPhp} = require('../../../hosting/stacker/lib/windows-php.cjs')
const {matchesConstraint} = require('../../../hosting/stacker/lib/runtime-manager.cjs')
test('runtime layouts select actual Windows, Linux and Mac distribution formats',()=>{
  expect(nodePlatform('win32','x64')).toMatchObject({catalogFile:'win-x64-zip',extension:'zip',executable:'node.exe',bin:''})
  expect(nodePlatform('linux','arm64')).toMatchObject({catalogFile:'linux-arm64',extension:'tar.gz'})
  expect(nodePlatform('darwin','arm64')).toMatchObject({catalogFile:'osx-arm64-tar'})
  expect(()=>nodePlatform('win32','ia32')).toThrow('No approved')
})
test('Windows command environments have one PATH key and retain directory separators',()=>{
  const env = executableEnvironment(['C:\\Frame UI\\node'],{Path:'C:\\Windows',OTHER:'retained'},'win32')
  expect(env).toEqual({PATH:'C:\\Frame UI\\node;C:\\Windows',OTHER:'retained'})
})
test('Windows npm invokes its JavaScript CLI directly without a command shell',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-node-command-'))
  try {
    const script=path.join(root,'node_modules/npm/bin/npm-cli.js');await fs.mkdir(path.dirname(script),{recursive:true});await fs.writeFile(script,'')
    expect(nodeCommand('npm',['install','a&b'],root,'win32')).toEqual([path.join(root,'node.exe'),[script,'install','a&b']])
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
test('Node version ranges support wildcards and reject unknown syntax',()=>{
  expect(matchesConstraint('v22.8.0','22.x')).toBe(true)
  expect(matchesConstraint('v24.1.0','>=20 <23')).toBe(false)
  expect(matchesConstraint('v22.8.0','nonsense')).toBe(false)
})
test('Windows PHP selects only matching NTS binaries with official checksums',()=>{
  const release={version:'8.4.20','nts-vs17-x64':{zip:{path:'php-8.4.20-nts-Win32-vs17-x64.zip',sha256:'a'.repeat(64)}},'ts-vs17-x64':{zip:{path:'php-8.4.20-Win32-vs17-x64.zip',sha256:'b'.repeat(64)}}}
  expect(windowsBuilds({'8.4':release},'x64')).toHaveLength(1)
  expect(windowsBuilds({'8.4':release},'arm64')).toHaveLength(0)
})
test('Windows PHP executable validation rejects another architecture',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-pe-'))
  try{
    const header=Buffer.alloc(128);header.write('MZ');header.writeUInt32LE(80,60);header.writeUInt32LE(0x4550,80);header.writeUInt16LE(0x8664,84)
    const binary=path.join(root,'php.exe');await fs.writeFile(binary,header)
    await verifyWindowsPhp(binary,'x64')
    await expect(verifyWindowsPhp(binary,'arm64')).rejects.toThrow('architecture')
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
