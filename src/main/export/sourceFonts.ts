import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import type {WebContents} from 'electron'
import type {VisualDocument} from '../../shared/types/visualDesign'
import type {StructuredFont} from '../../shared/types/structuredDesign'
import {getRegisteredProject} from '../../core/workspace/models/recentProjectsStore'
import {servePrototype,managedPrototypeRoutes,isImportedPrototype} from '../artifacts/prototypeImport'
const canonical=(s:string)=>s.replace(/["']/g,'').trim().toLowerCase()
/** Recover font bytes from a managed HTML artifact for older captures that omitted webfonts.
 * Reads HTML/CSS only; does not execute the prototype or change the active repository.
 */
export async function restoreArtifactFonts(document:VisualDocument,contents:WebContents,userData:string,signal:AbortSignal):Promise<VisualDocument>{
 if(!document.projectId||!document.pages.some(p=>p.artifactSource))return document
 const project=getRegisteredProject(userData,document.projectId)
 if(!project||!isImportedPrototype(project.path,userData))return document
 const missing=new Set<string>()
 for(const page of document.pages){
  if(!page.artifactSource)continue
  const present=new Set((page.structured?.fonts??page.fonts??[]).map(f=>canonical(f.family)))
  const walk=(nodes:NonNullable<typeof page.structured>['children'])=>{for(const n of nodes){if(n.typography){const first=canonical(n.typography.fontFamily.split(',')[0]);if(first&&!/^(system-ui|-apple-system|sans-serif|serif|monospace|arial)$/.test(first)&&!present.has(first))missing.add(first)}walk(n.children)}}
  if(page.structured)walk(page.structured.children)
 }
 if(!missing.size)return document
 const url=await servePrototype(project.path),routes=await managedPrototypeRoutes(project.path),visited=new Set<string>(),loaded:StructuredFont[]=[],fontCache=new Map<string,Promise<string>>()
 const read=async(address:string,binary=false)=>{
  const parsed=new URL(address);if(!['http:','https:','data:'].includes(parsed.protocol))throw Error('Unsupported font resource')
  if(parsed.protocol==='data:'){if(address.length>7000000)throw Error('Font resource too large');return address}
  const response=await contents.session.fetch(address,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])})
  if(!response.ok)throw Error('Source font resource unavailable')
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>5000000)throw Error('Font resource too large')
  return binary?`data:${response.headers.get('content-type')?.split(';')[0]||'font/woff2'};base64,${bytes.toString('base64')}`:bytes.toString('utf8')
 }
 const css=async(text:string,base:string,depth=0):Promise<void>=>{
  signal.throwIfAborted();if(depth>3)return
  const sheet=postcss.parse(text),imports:string[]=[],rules:Record<string,string>[]=[]
  sheet.walkAtRules(rule=>{if(rule.name.toLowerCase()==='font-face'){const values:Record<string,string>={};rule.walkDecls(d=>{values[d.prop.toLowerCase()]=d.value});rules.push(values)}else if(rule.name.toLowerCase()==='import'){const m=/(?:url\(\s*)?["']?([^"')\s;]+)/.exec(rule.params);if(m)imports.push(new URL(m[1],base).href)}})
  for(const values of rules){
   if(!values['font-family']||!missing.has(canonical(values['font-family'])))continue
   const match=/url\(\s*["']?([^"')]+)["']?\s*\)/.exec(values.src??'');if(!match)continue
   const address=new URL(match[1],base).href
   try{if(!fontCache.has(address))fontCache.set(address,read(address,true));loaded.push({family:values['font-family'].replace(/^["']|["']$/g,''),weight:values['font-weight']??'400',style:values['font-style']??'normal',unicodeRange:values['unicode-range'],stretch:values['font-stretch'],data:await fontCache.get(address)!})}catch{signal.throwIfAborted()}
  }
  for(const address of imports.slice(0,20))if(visited.size<30&&!visited.has(address)){visited.add(address);try{await css(await read(address),address,depth+1)}catch{signal.throwIfAborted()}}
 }
 const paths=[...new Set(document.pages.flatMap(p=>p.artifactSource?[p.artifactSource.path]:[]))].filter(p=>routes.includes(p.split(/[?#]/)[0])).slice(0,20)
 for(const route of paths){
  signal.throwIfAborted();const address=new URL(route,url).href
  try{const html=await read(address);for(const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))await css(match[1],address)
   for(const match of html.matchAll(/<link\b[^>]*>/gi)){const tag=match[0];if(!/\brel\s*=\s*["']stylesheet["']/i.test(tag))continue;const href=/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];if(!href)continue;const linked=new URL(href.replace(/&amp;/g,'&'),address).href;if(!visited.has(linked)){visited.add(linked);try{await css(await read(linked),linked)}catch{signal.throwIfAborted()}}}
  }catch{signal.throwIfAborted()}
 }
 if(!loaded.length)return document
 const unique=[...new Map(loaded.map(f=>[JSON.stringify([f.family,f.weight,f.style,f.unicodeRange]),f])).values()]
 return {...document,pages:document.pages.map(page=>{
  if(!page.artifactSource)return page
  const old=page.structured?.fonts??page.fonts??[],keys=new Set(old.map(f=>JSON.stringify([f.family,f.weight,f.style,f.unicodeRange]))),fonts=[...old,...unique.filter(f=>!keys.has(JSON.stringify([f.family,f.weight,f.style,f.unicodeRange])))];return {...page,fonts,...(page.structured?{structured:{...page.structured,fonts}}:{})}
 })}
}
