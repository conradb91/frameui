import {designStructure,resolveDesignSettings} from '@shared/aiDesign'
import {componentCandidates,designOutline,hasDesign,repositoryDesignContext,reviewReuse} from '@core/ai/designContext'
import { prototypeTools,executePrototypeTool } from '../prototype/tools'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { AiRequest, AiResult } from '@shared/types/ai'
import type { ProjectIndex } from '@shared/types/projectIndex'
import type { VisualObject } from '@shared/types/visualDesign'
import { resolveProjectFonts } from './fonts'
import { artboardSummary, inspectPage, inspectSelection, createArtboard, createCanvasNode, changeCanvasNode, deleteCanvasNode, cloneComponent, bindToken, canvasLayout, cloneElement } from '@core/ai/canvas'
import { readSource, safeRepoPath, redactSecrets } from './repoAccess'
import { compareImages, renderArtboard, inspectArtboardRender, renderRepositoryComponent } from './preview'

const definitions:Record<string,string>={
 propose_design_token:'Create or update a shared prototype-only design token. name is its semantic name, query is color, spacing, radius, typography or effect, text is its CSS value. Reuses an existing proposed token with the same name. Use the returned tokenId with set_fill, set_radius, set_typography, set_spacing or set_effect (set_spacing uses the token as gap). Changes update linked native elements consistently; source repository tokens are never overwritten.',
 record_design_decision:'Explain a necessary new component/icon or proposed visual variant after searching the repository. id is its native root, query is new or variant, reason explains the gap and how it follows existing conventions (24+ characters). componentId identifies the inspected existing component considered or extended. This records a proposal, never creates a source component or claims unsupported props exist.',
 resize_artboard:'Change the current draft artboard width and height without scaling typography or controls. For mobile, set the target viewport then deliberately recompose and resize its sections with move_element, resize_element and set_layout; existing coordinates are retained until you edit them.',
 validate_design:'Audit repository reuse and render modified screens to check text overflow and overlapping text. Resolve errors before finishing; warnings must be disclosed.',fit_text:'Measure actual rendered text using resolved fonts and resize its native box to fit. id is a text element; render again to check neighbouring elements for overlap.',get_design_context:'Inspect the actual reference screen hierarchy, relevant repository components, tokens, assets and layout rules. Use this before designing.',clone_element:'Reuse a real captured element or component subtree without reconstructing its styles. id is source element ID, templateId is source artboard, pageId is destination. Optional parentId, x, y. Returns the cloned editable subtree and its new IDs.',set_border:'Set border width and colour on an existing element.',set_visibility:'Show or hide an existing element. visible is boolean.',search_repo:'Search indexed source files for a literal query. Restricted files are excluded.',read_file:'Read one project source file (200 KB maximum).',find_route:'Find routes by query.',list_routes:'List project routes.',find_component:'Search existing components before creating anything new.',inspect_component:'Read indexed component props, variants, dependencies and source.',find_component_usage:'Find screens using a component.',list_assets:'List project images, fonts and icons.',get_asset:'Get metadata for a project asset; use its path in create_image.',get_design_tokens:'Find project tokens by query.',get_fonts:'List fonts already resolved by FrameUI.',list_artboards:'List artboards and design patterns.',inspect_artboard:'Inspect the layout tree of an artboard.',inspect_selection:'Inspect the selected elements and their parents.',find_similar_artboard:'Find closest existing artboards by names, layers and components.',
 create_input:'Create a real local prototype input. inputType can be text, email, password, number, date or time; placeholder is optional hint text, not a saved value. Its returned element ID is also its runtime variable name; declare that name using set_prototype_variables for conditional navigation.',create_artboard:'Create an editable FrameUI artboard; templateId clones an existing screen.',create_frame:'Create a container.',create_text:'Create text using resolved project typography. Omit width and height for measured auto sizing. Supply width for intentional wrapping. Never add manual line breaks just to force fitting.',create_image:'Create an image from a project asset path.',create_vector:'Create an SVG path vector.',create_component_instance:'Reuse a real indexed component. props is an optional object of actual prop names to string or JSON-encoded scalar values, e.g. {variant:"primary",children:"Continue"}. Inspect component props first. Captured instances preserve appearance; new variants are compiled from source, not invented.',set_layout:'Set row or column layout.',set_spacing:'Set padding and gap.',set_fill:'Set fill, preferably using tokenId.',set_typography:'Set typography using an existing font family or token.',set_radius:'Set radius, preferably using tokenId.',set_effect:'Set shadow.',move_element:'Move an element.',resize_element:'Resize an element.',delete_element:'Delete a canvas element only.',render_artboard:'Render the current artboard and return an image.',capture_artboard:'Render the current artboard and return an image.',compare_images:'Compare the attached reference against an artboard; report pixel differences honestly.',capture_runtime:'Request user-approved runtime validation. Never silently start an application or navigate an authenticated runtime.',propose_file_change:'Code mode only: propose complete replacement content for review. Does not write files.',propose_new_file:'Code mode only: propose a new source file after searching components. Does not write files.',run_build:'Code mode: stage the indexed build command for user approval.',run_tests:'Code mode: stage the indexed test command for user approval.',run_project:'Code mode: stage the indexed development command for user approval.'
}
const schema=z.object({placeholder:z.string().max(300).optional(),inputType:z.enum(['text','email','password','number','date','time','checkbox','radio']).optional(),url:z.string().url().max(2048).optional(),query:z.string().max(500).optional(),path:z.string().max(1000).optional(),pageId:z.string().max(100).optional(),id:z.string().max(100).optional(),parentId:z.string().max(100).optional(),templateId:z.string().max(100).optional(),componentId:z.string().max(100).optional(),name:z.string().max(200).optional(),text:z.string().max(20000).optional(),content:z.string().max(200000).optional(),reason:z.string().max(2000).optional(),tokenId:z.string().max(200).optional(),x:z.number().finite().min(-20000).max(20000).optional(),y:z.number().finite().min(-20000).max(20000).optional(),width:z.number().finite().min(1).max(10000).optional(),height:z.number().finite().min(1).max(20000).optional(),fill:z.string().max(150).optional(),fontFamily:z.string().max(200).optional(),fontSize:z.number().min(1).max(500).optional(),fontWeight:z.string().max(20).optional(),lineHeight:z.number().min(1).max(1000).optional(),gap:z.number().min(0).max(1000).optional(),padding:z.number().min(0).max(1000).optional(),radius:z.number().min(0).max(1000).optional(),direction:z.enum(['row','column','none']).optional(),shadow:z.string().max(300).optional(),vectorPath:z.string().max(50000).optional(),props:z.record(z.string().max(1000)).refine(p=>Object.keys(p).length<=30).optional(),visible:z.boolean().optional(),borderColor:z.string().max(150).optional(),borderWidth:z.number().min(0).max(100).optional(),letterSpacing:z.number().min(-20).max(100).optional(),textAlign:z.enum(['left','center','right','justify']).optional(),viewBox:z.string().max(100).optional()}).strict()
const numeric=new Set(['x','y','width','height','fontSize','lineHeight','gap','padding','radius','borderWidth','letterSpacing'])
const batchSchema=z.object({operations:z.array(z.object({tool:z.string(),args:z.record(z.unknown()),ref:z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).optional()}).strict()).min(1).max(120)}).strict()
export const claudeTools=[{name:"apply_design_batch",description:"Preferred for building screens and full prototypes efficiently. Atomic ordered operations using any canvas or prototype tool except rendering, repository or source tools. Each operation is {tool,args,ref?}; refer to prior returned IDs with $ref anywhere in args, including JSON data strings. Example: {operations:[{tool:\"create_artboard\",args:{name:\"Home\"},ref:\"home\"},{tool:\"create_text\",args:{pageId:\"$home\",text:\"Welcome\"}}]}. All operations roll back if any fails. Use batches for layout, styling, navigation, modals and drawers, then render representative screens.",input_schema:{type:"object",properties:{operations:{type:"array",items:{type:"object",properties:{tool:{type:"string"},args:{type:"object",additionalProperties:true},ref:{type:"string"}},required:["tool","args"],additionalProperties:false}}},required:["operations"],additionalProperties:false}},...prototypeTools,...Object.entries(definitions).map(([name,description])=>({name,description,input_schema:{type:'object',properties:Object.fromEntries(Object.keys(schema.shape).map(key=>[key,key==='props'?{type:'object',additionalProperties:{type:'string'}}:{type:key==='visible'?'boolean':numeric.has(key)?'number':'string'}])),additionalProperties:false}}))]
export class DesignTools {
  readonly result:AiResult
  private autoText=new Map<string,{width:boolean;height:boolean}>()
  private inherited=new Set<string>()
  private remember(nodes:import('@shared/types/structuredDesign').StructuredNode[]){for(const n of nodes){this.inherited.add(n.id);this.remember(n.children)}}
  private searched=false
  private inspected=new Set<string>()
  private resolvedFonts: NonNullable<import('@shared/types/visualDesign').VisualPage['fonts']>
  private comparisons=0
  private lastPageId:string
  constructor(readonly request:AiRequest,readonly index:ProjectIndex|null,readonly root:string|null,readonly signal:AbortSignal,runId:string,readonly relatedPages:import('@shared/types/visualDesign').VisualPage[]=[]){this.result={runId,document:structuredClone(request.document),message:'',changes:[],commands:[]};this.lastPageId=request.pageId;for(const page of request.document.pages)this.remember(page.structured?.children??[]);this.resolvedFonts=root&&index?resolveProjectFonts(root,index):[]}
  allPages(){return [...this.result.document.pages,...this.relatedPages.filter(p=>!this.result.document.pages.some(current=>current.id===p.id))]}
  referencePage(){const current=this.request.document.pages.find(p=>p.id===this.request.pageId);return hasDesign(current)?current:this.allPages().find(p=>hasDesign(p)&&this.request.document.pages.some(old=>old.id===p.id))}
  summary(){return {designContext:repositoryDesignContext(this.index,this.referencePage(),this.request.prompt,resolveDesignSettings(this.request.design,this.request.structure)),design:resolveDesignSettings(this.request.design,this.request.structure),structure:designStructure(resolveDesignSettings(this.request.design,this.request.structure)),target:this.request.target,prototype:this.result.document.prototype,project:this.index?{framework:this.index.framework,components:this.index.projectModel.components.length,tokens:this.index.projectModel.tokens.length}:null,artboards:this.allPages().map(artboardSummary).slice(0,100),selection:this.request.selection,currentArtboard:this.request.pageId,style:this.request.style,mode:this.request.mode}}
  private async fitAutoText(page:import('@shared/types/visualDesign').VisualPage){
    const nodes=new Map<string,import('@shared/types/structuredDesign').StructuredNode>();const visit=(ns:import('@shared/types/structuredDesign').StructuredNode[])=>{for(const n of ns){nodes.set(n.id,n);visit(n.children)}};visit(page.structured?.children??[])
    const pending=[...this.autoText].filter(([id])=>nodes.has(id));if(!pending.length)return
    let inspection=await inspectArtboardRender(page,this.signal),resized=false
    for(const [id,flags] of pending){const node=nodes.get(id)!,metric=inspection.text.find(t=>t.id===id);if(!metric)continue;if(flags.width){const parent=node.parentId?nodes.get(node.parentId):undefined;const available=Math.max(1,(parent?.bounds.width??page.width)-node.bounds.x-(parent?.layout.padding?.right??0));changeCanvasNode(page,id,{width:Math.max(1,Math.min(available,metric.naturalWidth+2))});resized=true}}
    if(resized)inspection=await inspectArtboardRender(page,this.signal)
    for(const [id,flags] of pending){const metric=inspection.text.find(t=>t.id===id);if(metric&&flags.height)changeCanvasNode(page,id,{height:Math.max(1,metric.requiredHeight)});this.autoText.delete(id)}
  }
  reuseReview(){const report=reviewReuse(this.request.document,this.result.document,this.index,this.inherited,designStructure(resolveDesignSettings(this.request.design,this.request.structure)),this.request.design);report.reference=this.referencePage()?.name;return report}
  async review(){
    const report=this.reuseReview()
    for(const page of report.pages.slice(0,8)){const native=this.result.document.pages.find(p=>p.id===page.id)!;if(!native.structured)continue;try{await this.fitAutoText(native);const inspection=await inspectArtboardRender(native,this.signal);page.warnings.push(...inspection.warnings);const names:Record<string,string>={};const visit=(ns:import('@shared/types/structuredDesign').StructuredNode[])=>{for(const n of ns){names[n.id]=n.name;visit(n.children)}};visit(native.structured.children);page.warnings=page.warnings.map(w=>Object.entries(names).reduce((text,[id,name])=>text.replaceAll(id,'“'+name+'”'),w))}catch(error){this.signal.throwIfAborted();page.warnings=['Preview unavailable: '+(error instanceof Error?error.message:'Rendering failed.')]}}
    if(report.pages.length>8)for(const page of report.pages.slice(8))page.warnings=['Visual check pending. Preview this screen before approval.']
    return report
  }
  async execute(name:string,raw:unknown):Promise<unknown>{
    this.signal.throwIfAborted();
    if(name==='apply_design_batch'){
      const inspected=new Set(this.inspected);const batch=batchSchema.parse(raw),before=structuredClone(this.result.document),last=this.lastPageId,searched=this.searched,refs:Record<string,string>={},results:unknown[]=[]
      const resolve=(value:unknown):unknown=>{if(typeof value==='string')return value.replace(/\$([A-Za-z][A-Za-z0-9_]*)/g,(match,key)=>{if(!(key in refs))throw new Error('Unknown batch reference '+match);return refs[key]});if(Array.isArray(value))return value.map(resolve);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)]));return value}
      try{for(const op of batch.operations){
        if(!/^(propose_design_token|record_design_decision|clone_element|create_(artboard|frame|text|input|image|vector|component_instance)|set_(layout|spacing|fill|typography|radius|effect|border|visibility|prototype_variables)|move_element|resize_element|resize_artboard|delete_element|configure_(flow|interaction|scenario|state|requirement)|bind_prototype_input|remove_prototype_item)$/.test(op.tool))throw new Error('Tool not allowed in a design batch: '+op.tool)
        const output=await this.execute(op.tool,resolve(op.args)) as {id?:string};results.push(output)
        if(op.ref){if(refs[op.ref])throw new Error('Duplicate batch reference '+op.ref);if(!output?.id)throw new Error('This tool does not return an ID');refs[op.ref]=output.id}
      }return {refs,results}}catch(error){this.result.document=before;this.lastPageId=last;this.searched=searched;this.inspected=inspected;throw error}
    }
if(prototypeTools.some(t=>t.name===name))return executePrototypeTool(this.result.document,name,raw);if(!(name in definitions))throw new Error('Unknown FrameUI tool.')
    const a=schema.parse(raw),model=this.index?.projectModel
    const query=(a.query??'').toLowerCase(),match=(v:unknown)=>JSON.stringify(v).toLowerCase().includes(query)
    const doc=this.result.document,page=this.allPages().find(p=>p.id===(a.pageId??this.lastPageId))
    const requirePage=()=>{if(page&&!doc.pages.some(p=>p.id===page.id))throw new Error('Clone this related artboard into the current design before editing it.');if(!page)throw new Error('Select or create an artboard first.');return page}
    const requireRoot=()=>{if(!this.root)throw new Error('Open a local repository first.');return this.root}
    const components=model?.components??[]
    const assets=model?.assets??[]
    const fonts=Array.from(new Set([...(this.referencePage()?artboardSummary(this.referencePage()!).fonts:[]),...this.resolvedFonts.map(f=>f.family),...this.allPages().flatMap(p=>[...artboardSummary(p).fonts,...(p.fonts??p.structured?.fonts??[]).map(f=>f.family)])].flatMap(f=>[f,f.split(',')[0].trim().replace(/^["']|["']$/g,'')])))
    switch(name){
      case 'validate_design':return this.review()
      case 'get_design_context':return repositoryDesignContext(this.index,this.referencePage(),this.request.prompt,resolveDesignSettings(this.request.design,this.request.structure))
      case 'clone_element':{const source=this.allPages().find(p=>p.id===(a.templateId??this.referencePage()?.id));if(!source||!a.id)throw new Error('Choose a source artboard and element ID.');const node=cloneElement(source,requirePage(),a.id,a.x,a.y,a.parentId);this.remember([node]);return {id:node.id,node}}
      case 'set_visibility':{if(!a.id||a.visible===undefined)throw new Error('Provide id and visible.');const walk=(ns:import('@shared/types/structuredDesign').StructuredNode[]):boolean=>{for(const n of ns){if(n.id===a.id){n.visibility=a.visible!;return true}if(walk(n.children))return true}return false};if(!walk(requirePage().structured?.children??[]))throw new Error('Element not found.');return {updated:a.id}}
      case 'set_border':{if(!a.id)throw new Error('Element id required.');changeCanvasNode(requirePage(),a.id,{stroke:a.borderColor??a.fill??'#d1d5db',strokeWidth:a.borderWidth??1});return {updated:a.id}}
      case 'list_routes':case 'find_route':return model?.pages.filter(match).slice(0,80)??[]
      case 'find_component':this.searched=true;return components.filter(match).slice(0,50)
      case 'inspect_component':case 'find_component_usage':{const c=components.find(c=>c.id===a.componentId||c.id===a.id);if(!c)throw new Error('Indexed component not found.');const info=model?.designSystem?.components.find(i=>i.componentId===c.id);if(name==='find_component_usage')return info?.usages??[];const source=readSource(requireRoot(),c.source.filePath);this.inspected.add(c.id);return {component:c,intelligence:info,source}}
      case 'read_file':return readSource(requireRoot(),a.path??'')
      case 'search_repo':{if(!query)throw new Error('Enter a literal search query.');const hits:unknown[]=[];for(const file of Object.keys(this.index?.files??{}).slice(0,3000)){if(hits.length>=40)break;try{const content=readSource(requireRoot(),file);const lines=content.split('\n');for(let i=0;i<lines.length&&hits.length<40;i++)if(lines[i].toLowerCase().includes(query))hits.push({path:file,line:i+1,text:lines[i].slice(0,500)})}catch{/* Restricted or oversized files never reach Claude. */}}return hits}
      case 'list_assets':return assets.filter(match).slice(0,100)
      case 'get_asset':return assets.find(x=>x.id===a.id||x.source.filePath===a.path)??null
      case 'get_design_tokens':return [...(model?.tokens??[]),...doc.variables.filter(v=>v.collection.startsWith('AI proposal / ')).map(v=>({id:v.id,name:v.name,value:v.value,category:v.collection.slice(14),origin:'proposed design token'}))].filter(match).slice(0,150)
      case 'get_fonts':return {resolvedFamilies:fonts,files:assets.filter(a=>a.kind==='font'),typography:model?.tokens.filter(t=>t.category==='typography')??[]}
      case 'list_artboards':return this.allPages().map(artboardSummary)
      case 'find_similar_artboard':return this.allPages().map(artboardSummary).filter(match).slice(0,10)
      case 'inspect_artboard':if(!page)throw new Error('Artboard not found.');return inspectPage(page)
      case 'inspect_selection':return inspectSelection(requirePage(),this.request.selection)
      case 'create_artboard':{if(!this.searched&&components.length)throw new Error('Search existing components before creating an artboard.');const templateId=a.templateId??(!this.request.design&&this.request.structure==='preserve'?this.referencePage()?.id:undefined),template=this.allPages().find(p=>p.id===templateId);const target=templateId&&!doc.pages.some(p=>p.id===templateId)?{...doc,pages:this.allPages()}:doc;const p=createArtboard(target,a.name??'New screen',a.width??template?.width??1440,a.height??template?.height??1000,templateId);if(target!==doc)doc.pages.push(p);this.lastPageId=p.id;p.fonts=structuredClone(template?.fonts??template?.structured?.fonts??(page?.fonts?.length?page.fonts:this.resolvedFonts));if(p.structured)p.structured.fonts=p.fonts;if(template)this.remember(p.structured?.children??[]);return {...artboardSummary(p),reusedFrom:templateId,nodes:template?designOutline(p,100).nodes:undefined}}
      case 'create_component_instance':{
        if(!this.searched)throw new Error('Search existing components first.')
        const c=components.find(c=>c.id===a.componentId);if(!c)throw new Error('Choose an indexed component.')
        const intelligence=model?.designSystem?.components.find(i=>i.componentId===c.id)
        for(const [key,value] of Object.entries(a.props??{})){const prop=intelligence?.props.find(p=>p.name===key);if(intelligence?.props.length&&!prop&&key!=='children')throw new Error('Unknown component prop '+key);if(prop?.values.length&&!prop.values.includes(value))throw new Error('Use a real '+key+' variant: '+prop.values.join(', '))}
        try{if(a.props&&Object.keys(a.props).length)throw new Error('This variant has no compatible captured instance');const id=cloneComponent({...doc,pages:this.allPages()},requirePage(),c.id,c.name,c.source.filePath,a.x??0,a.y??0,a.parentId);return {id}}catch(error){
          if(!(error instanceof Error)||!error.message.includes('no compatible captured instance'))throw error
          const target=requirePage();if(!target.structured)throw error
          readSource(requireRoot(),c.source.filePath)
          const rendered=await renderRepositoryComponent(requireRoot(),model!,c.id,a.width??320,this.signal,a.props)
          const temp={...target,id:crypto.randomUUID(),objects:[],structured:rendered.frame}
          const node=temp.structured.children[0];if(!node)throw new Error('Component source preview produced no visible elements.')
          node.componentBinding={componentId:c.id,confidence:1,variant:a.props};node.source={...node.source,file:c.source.filePath,component:c.name};node.type='ComponentInstance'
          const id=cloneComponent({...doc,pages:[...doc.pages,temp]},target,c.id,c.name,c.source.filePath,a.x??0,a.y??0,a.parentId)
          target.fonts=[...(target.fonts??[]),...rendered.fonts.filter(f=>!target.fonts?.some(old=>old.family===f.family&&old.weight===f.weight&&old.style===f.style))];target.structured.fonts=target.fonts
          return {id,warnings:rendered.warnings,preview:'source-derived; runtime validation recommended'}
        }
      }
      case 'propose_design_token':{
        if(!a.name?.trim()||!a.text?.trim()||a.text.length>300||!['color','spacing','radius','typography','effect'].includes(a.query??''))throw new Error('Provide a token name, category query and CSS value (up to 300 characters).')
        const numericValue=Number.parseFloat(a.text);if(['spacing','radius','typography'].includes(a.query!)&&(!Number.isFinite(numericValue)||numericValue<0))throw new Error('Use a non-negative CSS numeric value for this token.')
        const collection='AI proposal / '+a.query,existing=doc.variables.find(v=>v.collection===collection&&v.name.toLowerCase()===a.name!.trim().toLowerCase()),token=existing??{id:crypto.randomUUID(),collection,name:a.name.trim(),type:a.query==='color'?'Colour' as const:['spacing','radius','typography'].includes(a.query!)?'Number' as const:'String' as const,value:a.text.trim()}
        token.value=a.text.trim();if(!existing)doc.variables.push(token)
        // Update every existing binding to this proposed token in the isolated prototype.
        for(const p of doc.pages){const walk=(nodes:import('@shared/types/structuredDesign').StructuredNode[])=>{for(const n of nodes){for(const [property,binding] of Object.entries(n.tokenBindings??{})){if(binding?.token!==token.id)continue;const value=Number.parseFloat(token.value)*(token.value.endsWith('rem')?16:1),patch:Partial<VisualObject>={};if(property==='color'||property==='backgroundColor')patch.fill=token.value;else if(property==='borderRadius')patch.radius=[value,value,value,value];else if(property==='fontSize')patch.fontSize=value;else if(property==='boxShadow')patch.shadow=token.value;else if(property==='gap'||property==='padding')patch.layout={...canvasLayout(p,n.id),[property]:value};changeCanvasNode(p,n.id,patch);bindToken(p,n.id,property,token)}walk(n.children)}};walk(p.structured?.children??[])}
        return {tokenId:token.id,id:token.id,name:token.name,value:token.value,origin:'Proposed shared design token. Repository values are unchanged.'}
      }
      case 'record_design_decision':{
        if(!this.searched&&components.length)throw new Error('Search the existing repository components before proposing a new component.')
        if(!a.id||!a.reason||a.reason.trim().length<24||!['new','variant'].includes(a.query??''))throw new Error('Provide an element id, query new or variant, and a specific reason of at least 24 characters.')
        if(a.query==='variant'&&!a.componentId)throw new Error('A proposed variant must identify its existing component.')
        if(a.componentId&&!this.inspected.has(a.componentId))throw new Error('Inspect the considered component before recording a replacement or variant.')
        let target:import('@shared/types/structuredDesign').StructuredNode|undefined;const visit=(nodes:import('@shared/types/structuredDesign').StructuredNode[])=>{for(const n of nodes){if(n.id===a.id)target=n;visit(n.children)}};visit(requirePage().structured?.children??[])
        if(!target)throw new Error('Native design element not found.');const candidates=componentCandidates(this.index,target);if(candidates.length&&!candidates.some(c=>c.id===a.componentId))throw new Error('Identify an inspected project component candidate before proposing its replacement: '+candidates.map(c=>c.id).join(', '))
        target.designProposal={kind:a.query as 'new'|'variant',reason:a.reason.trim(),componentId:a.componentId}
        return {id:target.id,proposal:target.designProposal,message:'Recorded for design approval and developer handoff. Repository source is unchanged.'}
      }
      case 'resize_artboard':{const target=requirePage();if(a.width!==undefined)target.width=a.width;if(a.height!==undefined)target.height=a.height;if(target.structured){target.structured.width=target.width;target.structured.height=target.height}target.edited=true;delete target.thumbnail;return {id:target.id,width:target.width,height:target.height}}
      case 'create_input':case 'create_frame':case 'create_text':case 'create_image':case 'create_vector':{
        if(a.fontFamily&&fonts.length&&!fonts.includes(a.fontFamily))throw new Error('Use a resolved project font.');
        const values:Partial<VisualObject>={name:a.name??a.text?.slice(0,40)??name,x:a.x??0,y:a.y??0,width:a.width??160,height:a.height??(name==='create_text'?32:100),fill:a.fill??(name==='create_text'?'#111111':'transparent'),radius:[a.radius??0,a.radius??0,a.radius??0,a.radius??0],shadow:a.shadow,strokeWidth:a.borderWidth,stroke:a.borderColor,text:a.text,fontFamily:a.fontFamily??fonts[0]??'sans-serif',fontSize:a.fontSize??16,fontWeight:a.fontWeight??'400',textAlign:a.textAlign??'left',letterSpacing:a.letterSpacing??0,lineHeight:a.lineHeight??Math.round((a.fontSize??16)*1.4)}
        if(a.fontFamily&&fonts.length&&!fonts.includes(a.fontFamily))throw new Error('Use a font family returned by get_fonts.')
        if(name==='create_image'){
          const asset=assets.find(x=>x.source.filePath===a.path||x.id===a.id);if(!asset||!this.root)throw new Error('Choose a project image asset.')
          const target=path.resolve(this.root,asset.source.filePath),real=fs.realpathSync(target),relative=path.relative(fs.realpathSync(this.root),real)
          if(relative.startsWith('..')||path.isAbsolute(relative)||fs.statSync(real).size>5_000_000)throw new Error('Asset is outside the project or exceeds 5 MB.')
          const ext=path.extname(real).toLowerCase(),mime=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'} as Record<string,string>)[ext];if(!mime)throw new Error('Unsupported image asset.');values.src=`data:${mime};base64,${fs.readFileSync(real).toString('base64')}`
        }
        if(name==='create_vector'){values.path=a.vectorPath;values.viewBox=a.viewBox}
        for(const key of Object.keys(values) as (keyof VisualObject)[])if(values[key]===undefined)delete values[key]
        const id=createCanvasNode(requirePage(),name==='create_input'?'Input':name==='create_text'?'Text':name==='create_image'?'Image':name==='create_vector'?'Vector':'Frame',values,a.parentId);if(name==='create_input'&&(a.placeholder||a.inputType)){const walk=(nodes:import('@shared/types/structuredDesign').StructuredNode[])=>{for(const n of nodes){if(n.id===id&&n.source.control){n.source.control.placeholder=a.placeholder;n.source.control.type=a.inputType??'text'}walk(n.children)}};walk(requirePage().structured?.children??[])}if(name==='create_text'&&(a.width===undefined||a.height===undefined))this.autoText.set(id,{width:a.width===undefined,height:a.height===undefined});return {id}
      }
      case 'set_layout':case 'set_spacing':case 'set_fill':case 'set_typography':case 'set_radius':case 'set_effect':case 'move_element':case 'resize_element':{
        if(!a.id)throw new Error('Element id is required.')
        const patch:Partial<VisualObject>={}
        const token=a.tokenId?(model?.tokens.find(t=>t.id===a.tokenId)??doc.variables.find(t=>t.id===a.tokenId)):undefined;if(a.tokenId&&!token)throw new Error('Unknown project or proposed design token.')
        let property=''
        if(name==='move_element'){patch.x=a.x;patch.y=a.y}
        if(name==='resize_element'){patch.width=a.width;patch.height=a.height}
        if(name==='set_fill'){patch.fill=token?.value??a.fill;property='fill'}
        if(name==='set_typography'){patch.fontFamily=a.fontFamily;patch.fontSize=a.fontSize;patch.fontWeight=a.fontWeight;patch.lineHeight=a.lineHeight;patch.text=a.text;patch.textAlign=a.textAlign;patch.letterSpacing=a.letterSpacing;if(a.fontFamily&&fonts.length&&!fonts.includes(a.fontFamily))throw new Error('Use a resolved project font.');property='fontSize';if(token){const size=Number.parseFloat(token.value);if(Number.isFinite(size))patch.fontSize=token.value.endsWith('rem')?size*16:size;else patch.fontFamily=token.value}}
        if(name==='set_radius'&&token&&!Number.isFinite(Number.parseFloat(token.value)))throw new Error('Use a numeric radius token.');
        if(name==='set_radius'){const r=token?Number.parseFloat(token.value)*(token.value.endsWith('rem')?16:1):a.radius??0;patch.radius=[r,r,r,r];property='borderRadius'}
        if(name==='set_effect'){patch.shadow=token?.value??a.shadow;property='boxShadow'}
        if(name==='set_layout'||name==='set_spacing'){const previous=canvasLayout(requirePage(),a.id);patch.layout={...previous,direction:a.direction??previous.direction,gap:a.gap??previous.gap,padding:a.padding??previous.padding};if(token){const value=Number.parseFloat(token.value)*(token.value.endsWith('rem')?16:1);if(!Number.isFinite(value)||value<0)throw new Error('Use a non-negative spacing token.');patch.layout.gap=value;property='gap'}}
        if(patch.fontFamily&&fonts.length&&!fonts.includes(patch.fontFamily))throw new Error('Use a resolved project font.');
        for(const key of Object.keys(patch) as (keyof VisualObject)[])if(patch[key]===undefined)delete patch[key]
        if(this.request.style==='project'&&!token&&patch.fill){const existing=model?.tokens.find(t=>t.value.toLowerCase()===patch.fill?.toLowerCase());if(existing){bindToken(requirePage(),a.id,property,existing)}}
        changeCanvasNode(requirePage(),a.id,patch);if(token)bindToken(requirePage(),a.id,property,token);return {updated:a.id}
      }
      case 'delete_element':if(!a.id)throw new Error('Element id is required.');deleteCanvasNode(requirePage(),a.id);return {deleted:a.id}
      case 'fit_text':{const target=requirePage(),inspection=await inspectArtboardRender(target,this.signal),metric=inspection.text.find(t=>t.id===a.id);if(!metric)throw new Error('Visible text element not found.');changeCanvasNode(target,metric.id,{height:Math.max(1,metric.requiredHeight),...(metric.requiredWidth>metric.width+2?{width:Math.min(target.width,Math.max(metric.width,metric.requiredWidth+2))}:{})});return {updated:metric.id,height:metric.requiredHeight,message:'Check sibling spacing and render again.'}}
      case 'render_artboard':case 'capture_artboard':{await this.fitAutoText(requirePage());return inspectArtboardRender(requirePage(),this.signal)}
      case 'compare_images':{if(++this.comparisons>3)throw new Error('Maximum three visual correction passes reached. Return the current result for review.');if(!this.request.reference)throw new Error('Attach a reference screenshot first.');const comparison=compareImages(this.request.reference,await renderArtboard(requirePage(),this.signal));this.result.comparison={matchPercent:comparison.matchPercent,description:comparison.description};return comparison}
      case 'capture_runtime':{this.result.runtimeValidationRequested=true;const target=requirePage();const base=a.url??doc.appUrl;if(base)this.result.runtimeValidation={url:new URL(a.path??target.route??'/',base).href,pageId:target.id};return {approvalRequired:true,message:'Runtime comparison is staged for user approval. FrameUI will validate the project origin before loading it.'}}
      case 'propose_file_change':case 'propose_new_file':{
        if(this.request.mode!=='code')throw new Error('Design mode cannot propose repository changes.')
        if(!a.path||a.content===undefined)throw new Error('Path and complete file content are required.')
        if(name==='propose_new_file'&&!this.searched)throw new Error('Search existing components before proposing a new file.')
        const target=safeRepoPath(requireRoot(),a.path,true),exists=fs.existsSync(target)
        if(name==='propose_new_file'&&exists)throw new Error('This file already exists.')
        if(name==='propose_file_change'&&!exists)throw new Error('Use propose_new_file for new files.')
        const before=exists?fs.readFileSync(target,'utf8'):null
        if(before!==null&&(before.length>200000||redactSecrets(before)!==before))throw new Error('This file contains restricted content or is too large for AI editing.')
        const change={path:a.path,before,after:a.content,reason:a.reason??'Claude proposal'};const previous=this.result.changes.findIndex(c=>c.path===a.path);if(previous>=0)this.result.changes[previous]=change;else this.result.changes.push(change)
        return {proposed:a.path,approvalRequired:true}
      }
      case 'run_build':case 'run_tests':case 'run_project':{
        if(this.request.mode!=='code')throw new Error('Switch to Design + Code to propose commands.')
        const root=requireRoot(),script=name==='run_build'?'build':name==='run_tests'?'test':'dev'
        const pkg=JSON.parse(readSource(root,'package.json'));if(typeof pkg.scripts?.[script]!=='string')throw new Error(`No ${script} script is defined in package.json.`)
        const command={id:crypto.randomUUID(),name:script,command:'npm',args:['run',script],cwd:root};this.result.commands.push(command);return {approvalRequired:true,command}
      }
    }
  }
}

export const designOnlyTools=claudeTools.filter(t=>!['propose_file_change','propose_new_file','run_build','run_tests','run_project'].includes(t.name))
