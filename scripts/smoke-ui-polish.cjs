const {_electron}=require('playwright-core')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-ui-polish-'))
 const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
 let app,reviewProfile
 try{
  const executable=process.env.FRAMEUI_PACKAGED_APP
  app=await _electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.',`--user-data-dir=${root}`],env})
  if(executable){reviewProfile=await app.evaluate(({app})=>app.getPath('userData'));assert(path.basename(reviewProfile).startsWith('review-'))}
  const page=await app.firstWindow();page.setDefaultTimeout(20000)
  const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  const output='docs/verification/ide-polish';fs.mkdirSync(output,{recursive:true})
  const shot=async name=>{await page.screenshot({path:`${output}/${name}.png`,animations:'disabled'})}
  await page.getByRole('button',{name:'Skip introduction',exact:true}).click()
  await page.getByLabel('light appearance').click()
  await page.getByRole('button',{name:'Create Blank Design',exact:true}).click()
  await page.evaluate(()=>window.frameuiFlushSaves())
  await page.evaluate(async()=>{
   const [summary]=await window.frameui.design.list();const doc=await window.frameui.design.load(summary.id)
   const base=doc.pages[0]
   const object={id:crypto.randomUUID(),kind:'Rectangle',name:'Surface',x:80,y:100,width:340,height:240,rotation:0,fill:'#e7eeff',stroke:'#a9bfef',strokeWidth:1,opacity:1,fillOpacity:1,strokeOpacity:1,radius:[18,18,18,18],hidden:false,locked:false,clip:false,fontFamily:'Arial',fontSize:24,fontWeight:'500',lineHeight:32,letterSpacing:0,textAlign:'left',layout:{direction:'none',alignment:'start',distribution:'start',gap:0,padding:0,wrap:false,constraints:'left-top'},children:[]}
   const text={...object,id:crypto.randomUUID(),kind:'Text',name:'Heading',text:'Make space for ideas.',fill:'#243957',stroke:'none',strokeWidth:0,x:110,y:135,width:300,height:48,children:[]}
   const libraryId=crypto.randomUUID(),projectId='polish-fixture'
   const pages=['Dashboard','Settings','Team'].map((name,i)=>({...base,id:crypto.randomUUID(),name,route:['/','/settings','/team'][i],state:'Desktop',width:1440,height:1000,objects:[{...object,id:crypto.randomUUID()},{...text,id:crypto.randomUUID()}]}))
   const vars=[{id:crypto.randomUUID(),name:'Primary blue',collection:'Colours',type:'Colour',value:'#2864ed'},{id:crypto.randomUUID(),name:'Ink',collection:'Colours',type:'Colour',value:'#202a3b'},{id:crypto.randomUUID(),name:'Surface',collection:'Colours',type:'Colour',value:'#f5f7fa'},{id:crypto.randomUUID(),name:'Base spacing',collection:'Spacing',type:'Number',value:'8'}]
   const library={...doc,id:libraryId,projectId,name:'Studio',pages,variables:vars,sourceComponents:[{id:'button',name:'PrimaryButton',file:'src/components/Button.tsx'},{id:'card',name:'ProjectCard',file:'src/components/Card.tsx'}],pageRegistry:pages.map(p=>({pattern:p.route,url:p.route,name:p.name,authProfile:'standard',area:'Application',status:'Discovered'}))}
   await window.frameui.design.save(library)
   await window.frameui.design.save({...doc,name:'Product exploration',libraryId,projectId,pages:[pages[0]],variables:vars})
  })
  await page.reload();await page.getByRole('button',{name:'Open Studio',exact:true}).click()
  const nav=page.getByRole('navigation',{name:'Project navigation'})
  for(const theme of ['light','dark']){
   await page.getByLabel(`${theme} appearance`).click();await page.waitForTimeout(150)
   for(const section of ['Designs','Pages','Components','Styles','Assets','Archive']){
    if(section==='Archive'){await nav.getByRole('button',{name:'Designs',exact:true}).click();await page.getByRole('button',{name:'View archive',exact:true}).click()}
    else await nav.getByRole('button',{name:section,exact:true}).click()
    await page.getByRole('heading',{name:section==='Styles'?'Design Tokens & Styles':section,exact:true,level:1}).waitFor()
    assert(await page.locator('.ide-library-main').evaluate(el=>el.scrollWidth<=el.clientWidth),'library must not overflow')
    await shot(`${section.toLowerCase()}-${theme}`)
   }
  }
  await nav.getByRole('button',{name:'Designs',exact:true}).click()
  await page.getByLabel('Search designs',{exact:true}).fill('missing')
  await page.getByText('No matching designs',{exact:true}).waitFor()
  await page.getByLabel('Search designs',{exact:true}).fill('')
  await page.getByRole('button',{name:'Archive Product exploration',exact:true}).click()
  await page.getByRole('button',{name:'View archive',exact:true}).click()
  await page.getByRole('button',{name:'Restore',exact:true}).click()
  await nav.getByRole('button',{name:'Pages',exact:true}).click()
  await page.getByRole('button',{name:'Captured',exact:true}).click()
  assert.equal(await page.locator('.pages-route').count(),3)
  await page.getByRole('button',{name:'Archive /settings',exact:true}).click()
  assert.equal(await page.locator('.pages-route').count(),2)
  await page.getByRole('button',{name:'View archive',exact:true}).click()
  await page.getByRole('button',{name:'Restore',exact:true}).click()
  await nav.getByRole('button',{name:'Projects',exact:true}).click()
  await page.getByRole('button',{name:'Archive Studio',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Open Studio',exact:true}).count(),0)
  await page.getByRole('button',{name:'View archived projects',exact:true}).click()
  await page.getByRole('button',{name:'Restore Studio',exact:true}).click()
  await page.getByRole('button',{name:'View archived projects',exact:true}).click()
  await page.getByRole('button',{name:'Open Studio',exact:true}).click()
  await nav.getByRole('button',{name:'Components',exact:true}).click()
  await page.getByLabel('Search components').fill('missing')
  await page.getByText('No matching components',{exact:true}).waitFor()
  await nav.getByRole('button',{name:'Styles',exact:true}).click()
  await page.getByLabel('Search tokens').fill('missing')
  await page.getByText('No matching styles',{exact:true}).waitFor()
  await nav.getByRole('button',{name:'Collapse project rail'}).click()
  assert.equal(await nav.getByRole('button',{name:'Assets',exact:true}).count(),1)
  await nav.getByRole('button',{name:'Expand project rail'}).click()
  await nav.getByRole('button',{name:'Designs',exact:true}).click()
  await page.getByRole('button',{name:'New Design',exact:true}).click()
  await shot('new-design-dark');await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Open Product exploration',exact:true}).click()
  for(const theme of ['dark','light']){
   await page.getByRole('button',{name:'Workspace settings',exact:true}).click()
   await page.getByLabel(`${theme} appearance`).click()
   await shot(`settings-${theme}`)
   await page.getByRole('button',{name:'Done',exact:true}).click()
   await shot(`canvas-${theme}`)
   await page.getByRole('button',{name:'Export',exact:true}).click()
   await page.getByRole('dialog',{name:'Export design'}).waitFor();assert(await page.locator('.ide-export-scope input').first().evaluate(el=>el.getBoundingClientRect().width<=18),'scope radio must stay compact');await shot(`export-${theme}`);await page.keyboard.press('Escape')
   await page.keyboard.press('Meta+k');await page.getByRole('dialog',{name:'Search and commands'}).waitFor();await shot(`commands-${theme}`);await page.keyboard.press('Escape')
  }
  for(const [command,title] of [['Explore design system','Design system'],['Open application map','Application map']]){
   await page.keyboard.press('Meta+k');await page.getByLabel('Search pages, objects and commands').fill(command);await page.keyboard.press('Enter')
   await page.getByRole('heading',{name:title,exact:true}).waitFor();await shot(title.toLowerCase().replaceAll(' ','-'));await page.getByRole('button',{name:'Back to canvas',exact:true}).click()
  }
  const rect=page.locator('[data-object-id]').first()
  await rect.click({position:{x:30,y:100}})
  await shot('inspector-selected')
  await page.getByRole('button',{name:'Present',exact:true}).click()
  assert.equal(await page.locator('.ide-tools:visible,.ide-sidebar:visible,.ide-inspector:visible').count(),0)
  await page.getByRole('button',{name:/Exit presentation/}).click()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720))
  await shot('canvas-compact')
  assert(await page.locator('.ide-tools').evaluate(el=>el.scrollWidth<=el.clientWidth),'all toolbar controls must fit at minimum width')
  assert(await page.locator('.ide-top').evaluate(el=>el.scrollWidth<=el.clientWidth),'editor header must fit minimum width')
  assert(await page.locator('.ide-inspector').evaluate(el=>el.scrollWidth<=el.clientWidth),'inspector must not overflow')
  assert.deepEqual(errors,[])
  console.log('PASS: six project sections in both themes, empty search states, rail collapse, editor, inspector, settings/export/commands, presentation and minimum-width layout.')
 }finally{if(app)await app.close();if(reviewProfile&&path.basename(reviewProfile).startsWith('review-'))fs.rmSync(reviewProfile,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1})
