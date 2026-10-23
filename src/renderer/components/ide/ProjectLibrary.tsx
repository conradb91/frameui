import {PrototypeInstructionsModal} from './PrototypeInstructionsModal'
import './design-library.css'
import { userFacingError } from '../../lib/userFacingError'
import type { RuntimeConnection } from '@shared/types/project'
import { PagesWorkspace } from './PagesWorkspace'
import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, FileDown, FilePlus2, ChevronRight, RefreshCcw, MoreHorizontal, Search, Archive, ArrowRight, Monitor, Box, Plus, Layers, CheckCircle2, Workflow, LayoutGrid, List } from 'lucide-react'
import type { VisualDocument } from '@shared/types/visualDesign'
import type { ProjectIndex } from '@shared/types/projectIndex'
import type { FrameUiApi } from '@shared/ipc-contract'
import { ThemeControl, EmptyState, HighlightMatch, ActionMenu, type IdeAction } from './Ui'
import { AssetBrowser, type LibraryAsset } from './AssetBrowser'
import { NewDesignModal } from './NewDesignModal'
import { ProjectNav, type ProjectSection } from './ProjectNav'
import { CaptureWorkspace } from './CaptureWorkspace'
import { detectedAssets } from './pageLibrary'
import { formatRoute, humanizeName } from './displayFormat'
import { useStoredValue } from './preferences'

export function ProjectLibrary({ document, onBack, onRefresh, onCapture, onOpen, onCreate, onRender, onImportPrototype, initialSection = 'Designs', onSectionChange, notice }: {
  document: VisualDocument; onBack: () => void; onRefresh: () => void; onOpen: (id: string) => void;
  /** Write-back for an on-demand capture session (`CaptureWorkspace`) —
   * same document-replacement contract `DesignIde`'s own `change()` uses. */
  onCapture: (document: VisualDocument) => void
  onCreate: (name: string, asset?: LibraryAsset, fileId?: string, viaCapture?: boolean, autoNamed?: boolean, captureUrl?: string) => void; initialSection?: ProjectSection
  onSectionChange?: (section: ProjectSection) => void; notice?: string
  onImportPrototype: () => void
  onRender: (route: string) => void
}) {
  const [instructionsOpen,setInstructionsOpen]=useState(false)
  const [runtime,setRuntime]=useState<RuntimeConnection|null>(null)
  useEffect(()=>{let alive=true;void window.frameui.project.getRuntime().then(r=>{if(alive)setRuntime(r)}).catch(()=>{});const update=(event:Event)=>setRuntime((event as CustomEvent<RuntimeConnection>).detail);window.addEventListener('frameui:runtime-updated',update);return()=>{alive=false;window.removeEventListener('frameui:runtime-updated',update)}},[document.projectId])
  const [captureBusy, setCaptureBusy] = useState(false)
  const [files,setFiles] = useState<Awaited<ReturnType<FrameUiApi['design']['list']>>>([])
  const [section,setSectionState] = useState<ProjectSection>(initialSection)
  const [index,setIndex] = useState<ProjectIndex|null>(null)
  const [query,setQuery] = useState('')
  const [sort,setSort] = useState('recent')
  const [designView,setDesignView] = useStoredValue<'grid'|'list'>('frameui:design-view','grid')
  const [designType,setDesignType] = useState('all')
  const [error,setError] = useState('')
  const [newDesign,setNewDesign] = useState<{ initialAsset?: LibraryAsset } | null>(null)
  const [menu,setMenu] = useState<{x:number;y:number;fileId:string}|null>(null)
  const [archived,setArchived] = useState<string[]>(() => {try {return JSON.parse(localStorage.getItem(`frameui:archive:${document.id}`)||'[]')} catch {return []}})
  const [archivedPages,setArchivedPages] = useStoredValue<string[]>(`frameui:archived-pages:${document.id}`, [])
  // Capture is not a destination of its own — it's a tool, opened on demand
  // over the current view and closed again on Done, not a section you
  // switch between.
  const [captureSession, setCaptureSession] = useState<{ route?: string } | null>(null)
  function setSection(next: ProjectSection) {
    if (captureBusy) return
    setSectionState(next)
    setQuery('')
    onSectionChange?.(next)
  }
  /** Opens an on-demand capture session — the only way a project actually
   * gets real captured pages/components, as opposed to `onRender`'s static
   * parse-from-source path. An optional route pre-scopes the flow to one
   * specific page (e.g. "capture this page"). */
  function onImport(route?: string) {
    setCaptureSession({ route })
  }
  useEffect(() => {let alive=true;void window.frameui.design.list().then(items => {if(alive)setFiles(items.filter(i => i.libraryId===document.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)))}).catch(e=>{if(alive)setError(userFacingError(e))});return()=>{alive=false}},[document.id])
  useEffect(() => {let alive=true;void window.frameui.project.getIndex().then(next=>{if(alive)setIndex(next)}).catch(e=>{if(alive)setError(userFacingError(e))});return()=>{alive=false}},[document.projectId])
  function archive(id: string) {const next=archived.includes(id)?archived.filter(i=>i!==id):[...archived,id];setArchived(next);localStorage.setItem(`frameui:archive:${document.id}`,JSON.stringify(next))}
  function archivePage(pattern: string) {setArchivedPages(archivedPages.includes(pattern)?archivedPages.filter(p=>p!==pattern):[...archivedPages,pattern])}
  const pagesCount = document.pageRegistry?.length ?? 0
  const componentsCount = document.sourceComponents?.length ?? 0
  const stylesCount = document.variables.length
  const assets=useMemo(()=>detectedAssets(document.pages),[document.pages])
  const active=files.filter(f=>!archived.includes(f.id))
  const matchingDesigns = active.filter(f=>f.name.toLowerCase().includes(query.toLowerCase())&&(designType==='all'||(designType==='screens'?f.pageCount>0:f.pageCount===0))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):b.updatedAt.localeCompare(a.updatedAt))
  const application = index?.applications?.[0]
  const savedAppUrl = document.appUrl && !/^about:blank\/?$/i.test(document.appUrl.trim()) ? document.appUrl : undefined
  const resolvedAppUrl = savedAppUrl || application?.url || undefined
  const prototypeOnly=document.pages.some(page=>!!page.artifactSource)
  const appOnly=!!index?.rootPath.replace(/\\/g,'/').includes('/application-projects/')
  const heading = section==='Designs'?document.name:section==='Styles' ? 'Design Tokens & Styles' : section
  const namedCollections = ['Colours','Typography','Spacing','Radius','Shadows']
  const styleCategories = [...namedCollections,'Variables'].map(label=>({label,items:document.variables.filter(v=>(label==='Variables'?!namedCollections.includes(v.collection):v.collection===label) && `${v.collection} ${v.name}`.toLowerCase().includes(query.toLowerCase()))})).filter(c=>c.items.length)
  const sectionDescriptions: Record<ProjectSection, string> = {
    Designs: 'Explore ideas with your product’s components. Build flows and test before approval.',
    Pages: 'Capture the screens you need as editable design layers.',
    Components: 'Reusable pieces from your codebase, ready for your next design.',
    Styles: 'The colours, typography and design values that make your product yours.',
    Assets: 'Images and visual resources collected from your project.',
    Archive: 'Previous work, kept safely here whenever you need it again.',
  }
  const matchingComponents = (document.sourceComponents ?? []).filter(c => `${c.name} ${c.file}`.toLowerCase().includes(query.toLowerCase()))
  const menuFile = menu && files.find(f=>f.id===menu.fileId)
  const fileActions: IdeAction[] = menuFile ? [
    { id:'open', label:'Open', run:()=>onOpen(menuFile.id) },
    { id:'duplicate', label:'Duplicate', run:()=>{void window.frameui.design.load(menuFile.id).then(d=>{if(d){const copy={...d,id:crypto.randomUUID(),name:`${d.name} copy`};void window.frameui.design.save(copy).then(()=>setFiles(f=>[...f,{id:copy.id, name:copy.name, projectId:copy.projectId, libraryId:copy.libraryId, updatedAt:copy.updatedAt, pageCount:copy.pages.length, thumbnail:copy.pages[0]?.thumbnail, designCount:undefined}]))}})} },
    { id:'archive', label: archived.includes(menuFile.id) ? 'Restore' : 'Archive', run:()=>archive(menuFile.id) },
  ] : []
  return <>
    <header className="ide-top app-drag-region">
      <span className="ide-breadcrumb app-no-drag"><strong>{document.name}</strong><ChevronRight size={12}/><span>{section==='Designs'?'Designs':heading}</span></span>
      {notice && <span className="ide-status-pill" role="status">{notice}</span>}
      <div className="app-no-drag ide-topbar-actions">
        <button title="Refresh from Code" aria-label="Refresh from Code" disabled={captureBusy} onClick={onRefresh}><RefreshCcw size={15}/></button>
        <button disabled={captureBusy} onClick={()=>setInstructionsOpen(true)}><FileDown size={15}/> Claude instructions</button>
        <ThemeControl/>
      </div>
    </header>
    <div className="ide-project-layout">
      <ProjectNav disabled={captureBusy} name={document.name} section={section} onSelect={setSection} onBack={()=>{if(!captureBusy)onBack()}} counts={{Designs:active.length,Pages:pagesCount,Components:componentsCount,Styles:stylesCount,Assets:assets.length,Archive:archived.length+archivedPages.length}}/>

      <main className={`ide-library-main ${section==='Pages'?'pages-library-main':section==='Designs'?'designs-library-main':''}`}>
        <header className="ide-section-heading"><div><h1>{heading}</h1><p>{sectionDescriptions[section]}</p></div>{(section==='Designs'||section==='Pages') && <div className="ide-library-heading-actions"><button disabled={captureBusy} onClick={onImportPrototype}><FolderOpen size={16}/> Import files</button><button aria-label="View archive" disabled={captureBusy} onClick={()=>setSection('Archive')}><Archive size={15}/>Archive</button>{section === 'Designs' && <button className="primary" onClick={() => setNewDesign({})}><FilePlus2 size={16}/> New Design</button>}</div>}</header>
        {(section==='Designs'||section==='Pages')&&<nav className="studio-journey" aria-label="Project workflow">
          <div data-complete="true"><span>✓</span><div><strong>{prototypeOnly?'HTML prototype':appOnly?'Running app':'Project'}</strong><small>{prototypeOnly?'Imported locally':appOnly?'No source mapping':index?.projectModel.components.length?'Indexed & ready':'Add your content'}</small></div></div>
          <button disabled={captureBusy} onClick={()=>{setSection('Pages');requestAnimationFrame(()=>window.dispatchEvent(new Event('frameui:show-connection')))}} data-complete={!!(runtime?.connectedAt||runtime?.verifiedAt)}><span>{(runtime?.connectedAt||runtime?.verifiedAt)?'✓':'2'}</span><div><strong>Connect app</strong><small>{(runtime?.connectedAt||runtime?.verifiedAt)?'Connected':'Localhost or hosted domain'}</small></div></button>
          <button disabled={captureBusy} onClick={()=>setSection('Pages')} data-complete={document.pages.length>0}><span>{document.pages.length?'✓':'3'}</span><div><strong>Capture pages</strong><small>{document.pages.length?`${document.pages.length} screen${document.pages.length===1?'':'s'} ready`:'Choose your starting screens'}</small></div></button>
          <button disabled={captureBusy} onClick={()=>setNewDesign({})}><span>4</span><div><strong>Design &amp; prototype</strong><small>Flows, AI drafts &amp; approval</small></div></button>
        </nav>}
        {section==='Designs' && <>
          <div className="design-start-cards">
            <article className="design-start-card design-start-card--capture"><div><h2>Start from your app</h2><p>Capture pages from your running application to quickly create designs.</p><button className="primary" onClick={()=>onImport()}><Monitor size={16}/>Capture pages</button></div></article>
            <article className="design-start-card design-start-card--components"><Box size={25}/><div><h2>Use components</h2><p>Browse reusable components from your project.</p><button onClick={()=>setSection('Components')}>Explore components<ChevronRight size={16}/></button></div></article>
          </div>
          <div className="ide-designs-toolbar design-library-toolbar"><label><Search size={16}/><input aria-label="Search designs" placeholder="Search designs…" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Sort designs" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Recently edited</option><option value="name">Name A–Z</option></select><select aria-label="Filter design type" value={designType} onChange={e=>setDesignType(e.target.value)}><option value="all">All designs</option><option value="screens">With screens</option><option value="empty">Empty designs</option></select><div className="design-view-switch"><button aria-label="List designs" aria-pressed={designView==='list'} onClick={()=>setDesignView('list')}><List size={17}/></button><button aria-label="Grid designs" aria-pressed={designView==='grid'} onClick={()=>setDesignView('grid')}><LayoutGrid size={17}/></button></div></div>
          {!active.length ? <div className="ide-overview-empty design-library-empty">
            <span className="ide-empty-emblem design-empty-art"><Layers size={40}/><span><Plus size={15}/></span></span><h2>Create your first design</h2><p>Capture a page from your real interface, open a blank canvas or use components to explore an idea. Build flows, collaborate and test before approval.</p>
            <div className="design-empty-actions"><button className="primary" onClick={()=>setSection('Pages')}><Monitor size={16}/>Capture pages</button><button onClick={()=>setNewDesign({})}><Plus size={17}/>Blank design</button><button onClick={()=>setSection('Components')}><Box size={17}/>Explore components</button></div>
            <footer className="design-empty-benefits"><div><Box size={22}/><span><strong>Use your components</strong><small>Consistent with your project's design system.</small></span></div><div><Workflow size={22}/><span><strong>Build flows</strong><small>Link screens and test the full experience.</small></span></div><div><CheckCircle2 size={22}/><span><strong>Share for approval</strong><small>Get feedback and iterate faster.</small></span></div></footer>
          </div> : (
            <>
              <div className="ide-designs-header">
                <h2>Your designs</h2>
              </div>
              {!matchingDesigns.length && <EmptyState title="No matching designs">Try a different name.</EmptyState>}
              <div className={`ide-design-grid ${designView==='list'?'design-library-list':''}`}>{matchingDesigns.map(file=><article className="ide-design-card" key={file.id}>
                <button className="ide-design-thumbnail" onClick={()=>onOpen(file.id)} aria-label={`Open ${file.name}`}>{file.thumbnail ? <img src={file.thumbnail} alt="" loading="lazy"/> : <FolderOpen size={22}/>}</button>
                <div><strong>{file.name}</strong><small>{file.pageCount} frame{file.pageCount===1?'':'s'} · Edited {new Date(file.updatedAt).toLocaleDateString()}</small></div>
                <footer className="ide-design-card-actions"><button onClick={()=>onOpen(file.id)}>Open design <ArrowRight size={13}/></button><button aria-label={`Archive ${file.name}`} title="Archive design" onClick={()=>archive(file.id)}><Archive size={14}/></button></footer>
                <button className="ide-design-more" aria-label={`More actions for ${file.name}`} title="More" onClick={e=>setMenu({x:e.clientX,y:e.clientY,fileId:file.id})}><MoreHorizontal size={14}/></button>
              </article>)}</div>
            </>
          )}
        </>}
        {section==='Pages' && <PagesWorkspace document={document} initialAddress={resolvedAppUrl} archivedPages={archivedPages} onCapture={onCapture} onCreate={page=>setNewDesign({initialAsset:{kind:'screen',page}})} onBusy={setCaptureBusy} onArchive={archivePage}/>}
        {section==='Components' && <>
          <div className="ide-explorer-search"><Search size={13}/><input aria-label="Search components" placeholder="Search components…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
          {matchingComponents.length ? <div className="ide-row-list">{matchingComponents.map(c=><button className="ide-row" key={c.id} onClick={()=>onRender(`component:${c.id}`)}><strong><HighlightMatch text={c.name} query={query}/></strong><small><HighlightMatch text={c.file} query={query}/></small></button>)}</div> : <EmptyState title={query ? "No matching components" : "No components indexed"}>{query ? "Try a different component name or file path." : "Reusable components will appear here after your project is indexed."}</EmptyState>}
        </>}
        {section==='Styles' && <>
          <div className="ide-explorer-search"><Search size={13}/><input aria-label="Search tokens" placeholder="Search tokens…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
          {!styleCategories.length && <EmptyState title={query ? "No matching styles" : "No tokens detected"}>{query ? "Try another name or collection." : "Your project’s design values will appear here when detected."}</EmptyState>}
          {styleCategories.map(cat=><details open key={cat.label} className="ide-explorer-group"><summary>{cat.label} <small>{cat.items.length}</small></summary><div className="ide-library-grid">{cat.items.map(v=>{
            const isFontFamily = cat.label==='Typography' && !/^[\d.]+(px|rem|em|pt|%)$/.test(v.value.trim())
            return <article className="ide-library-card" key={v.id}>{v.type==='Colour'&&<span className="ide-token-swatch" style={{background:v.value}}/>}<strong style={isFontFamily?{fontFamily:v.value}:undefined}>{v.name}</strong><small>{v.type} · {v.value}</small></article>
          })}</div></details>)}
        </>}
        {section==='Assets' && <>
          <div className="ide-explorer-search"><Search size={13}/><input aria-label="Search assets" placeholder="Search assets…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
          {assets.length ? <AssetBrowser destination="design file" kind="components" library={{...document,components:assets}} search={query} onAdd={asset=>setNewDesign({initialAsset:asset})}/> : <EmptyState title="No assets indexed">No project assets indexed yet.</EmptyState>}
        </>}
        {section==='Archive' && <>
          <button onClick={()=>setSection('Designs')}>Back to designs</button>
          {!files.some(f=>archived.includes(f.id)) && !archivedPages.length && <EmptyState title="Nothing archived">Archived design files and pages stay on this computer and can be restored.</EmptyState>}
          {files.filter(f=>archived.includes(f.id)).map(f=><div className="ide-row" key={f.id}><strong>{f.name}</strong><button onClick={()=>archive(f.id)}>Restore</button></div>)}
          {archivedPages.map(pattern=>{const entry=(document.pageRegistry??[]).find(r=>r.pattern===pattern);return <div className="ide-row" key={pattern}><strong>{entry?humanizeName(entry.name,entry.area):pattern}</strong><small>{formatRoute(pattern)}</small><button onClick={()=>archivePage(pattern)}>Restore</button></div>})}
        </>}
        {error&&<div className="ide-error-toast is-inline" role="alert"><span>{userFacingError(error)}</span><button type="button" aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
      </main>
    </div>
    {instructionsOpen&&<PrototypeInstructionsModal onClose={()=>setInstructionsOpen(false)}/>}
    {menu && fileActions.length>0 && <ActionMenu actions={fileActions} x={menu.x} y={menu.y} onClose={()=>setMenu(null)}/>}
    {newDesign && <NewDesignModal
      projectId={document.id}
      appUrl={resolvedAppUrl}
      pages={document.pages}
      existingDesigns={active.map(f=>({id:f.id,name:f.name}))}
      initialAsset={newDesign.initialAsset}
      onCancel={()=>setNewDesign(null)}
      onCreate={(name,asset,fileId,viaCapture,autoNamed,captureUrl)=>{onCreate(name,asset,fileId,viaCapture,autoNamed,captureUrl ?? resolvedAppUrl);setNewDesign(null)}}
    />}
    {captureSession && (
      <div className="ide-capture-overlay">
        <CaptureWorkspace
          document={resolvedAppUrl === document.appUrl ? document : {...document, appUrl: resolvedAppUrl}}
          onCapture={onCapture}
          onDone={()=>setCaptureSession(null)}
          focusRoute={captureSession.route}
        />
      </div>
    )}
  </>
}
