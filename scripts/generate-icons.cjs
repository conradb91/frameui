// Run on macOS: node scripts/generate-icons.cjs. SVG is the source of truth.
const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async () => {
 const root = path.resolve(__dirname, '..');
 const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'icon-window.cjs')], env: {...process.env, ELECTRON_RUN_AS_NODE: ''} });
 try {
  const page = await app.firstWindow();
  await page.setViewportSize({width:1024,height:1024});
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${fs.readFileSync(path.join(root,'build/icon.svg'),'utf8')}`);
  await page.screenshot({path:path.join(root,'build/icon.png'),omitBackground:true});
 } finally { await app.close(); }
 const iconset = path.join(root,'build/icon.iconset'); fs.mkdirSync(iconset,{recursive:true});
 for(const size of [16,32,128,256,512]) for(const scale of [1,2]) execFileSync('sips',['-z',String(size*scale),String(size*scale),path.join(root,'build/icon.png'),'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
 execFileSync('iconutil',['-c','icns',iconset,'-o',path.join(root,'build/icon.icns')]);
 const images = [16,32,48,64,128,256].map(size=> { const file=path.join(iconset,`win-${size}.png`); execFileSync('sips',['-z',String(size),String(size),path.join(root,'build/icon.png'),'--out',file],{stdio:'ignore'}); return {size,data:fs.readFileSync(file)}; });
 const header=Buffer.alloc(6+images.length*16); header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
 images.forEach(({size,data},i)=>{const pos=6+i*16;header[pos]=size===256?0:size;header[pos+1]=size===256?0:size;header.writeUInt16LE(1,pos+4);header.writeUInt16LE(32,pos+6);header.writeUInt32LE(data.length,pos+8);header.writeUInt32LE(offset,pos+12);offset+=data.length;});
 fs.writeFileSync(path.join(root,'build/icon.ico'),Buffer.concat([header,...images.map(i=>i.data)]));
 fs.rmSync(iconset,{recursive:true});
 fs.mkdirSync(path.join(root,'public'),{recursive:true});
 fs.copyFileSync(path.join(root,'build/icon.svg'),path.join(root,'public/icon.svg'));
 console.log('Generated macOS, Windows and PNG application icons.');
})().catch(error=>{console.error(error);process.exitCode=1;});
