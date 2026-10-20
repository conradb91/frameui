// Local visual regressions only: generated fixtures, isolated Electron profiles, no publishing.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const output=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'frameui-capture-regressions-'));
fs.mkdirSync(output,{recursive:true});
const cases=[
 {name:'circular-counter-badges',file:'circular-counter-badges.html',flags:{FRAMEUI_GENERAL_AUDIT:'1',FRAMEUI_CIRCLE_AUDIT:'1',FRAMEUI_AUDIT_WIDTHS:'1440,1920'}},
 {name:'css-mask-icons',file:'css-mask-icons.html',flags:{FRAMEUI_GENERAL_AUDIT:'1',FRAMEUI_MASK_ICON_AUDIT:'1',FRAMEUI_AUDIT_WIDTHS:'1440,1920'}},
 {name:'category-card-spacing',file:'category-card-spacing.html',flags:{FRAMEUI_CARD_AUDIT:'1',FRAMEUI_GENERAL_AUDIT:'1',FRAMEUI_AUDIT_WIDTHS:'1440,1920'}},
 {name:'rich-text-gradients',file:'capture-rich-gradient-text.html',flags:{FRAMEUI_TEXT_AUDIT:'1'}},
 {name:'list-markers',file:'list-markers.html',flags:{FRAMEUI_LIST_AUDIT:'1'}},
 {name:'svg-transforms',file:'capture-svg-transforms.html',flags:{}},
 {name:'wide-drawers',file:'wide-drawer.html',flags:{FRAMEUI_GENERAL_AUDIT:'1',FRAMEUI_DRAWER_AUDIT:'1',FRAMEUI_AUDIT_WIDTHS:'1440,1920'}},
 {name:'full-scroll-drawers',file:'scrolling-drawer.html',flags:{FRAMEUI_GENERAL_AUDIT:'1',FRAMEUI_SCROLL_DRAWER_AUDIT:'1',FRAMEUI_AUDIT_EXPAND_PANELS:'1',FRAMEUI_AUDIT_WIDTHS:'1440,1920'}},
];
const report=[];
for(const item of cases){
 const destination=path.join(output,item.name),env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('FRAMEUI_AUDIT_')||/^FRAMEUI_(GENERAL|TEXT|LIST|QUALITY|DRAWER|SCROLL_DRAWER|CARD|MASK_ICON|CIRCLE)_AUDIT$/.test(key))delete env[key];
 Object.assign(env,item.flags,{FRAMEUI_ASSERT_COMPLETENESS:'1',FRAMEUI_AUDIT_FIXTURE:path.resolve('tests/fixtures',item.file),FRAMEUI_AUDIT_OUTPUT:destination});
 const result=spawnSync(process.execPath,[path.resolve('scripts/audit-capture-fidelity.cjs')],{env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
 fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'run.log'),(result.stdout??'')+(result.stderr??''));
 if(result.status!==0){console.error('FAIL: '+item.name+' — '+(result.error?.message??'see '+path.join(destination,'run.log')));process.exitCode=1;break}
 const checks=JSON.parse(fs.readFileSync(path.join(destination,'results.json'),'utf8')).map(r=>({width:r.width,diffPercent:r.diffPercent}));
 report.push({name:item.name,checks});console.log('PASS: '+item.name+' · '+checks.map(r=>r.width+' px ('+r.diffPercent.toFixed(3)+'% differing pixels)').join(', '));
}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2));
console.log('Local regression artifacts: '+output);
