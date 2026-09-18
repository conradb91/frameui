// Run on macOS: node scripts/generate-icons.cjs. build/icon.png is the supplied master logo.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async () => {
 const root = path.resolve(__dirname, '..');
 const iconset = path.join(root,'build/icon.iconset'); fs.mkdirSync(iconset,{recursive:true});
 for(const size of [16,32,128,256,512]) for(const scale of [1,2]) execFileSync('sips',['-z',String(size*scale),String(size*scale),path.join(root,'build/icon.png'),'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
 execFileSync('iconutil',['-c','icns',iconset,'-o',path.join(root,'build/icon.icns')]);
 const images = [16,32,48,64,128,256].map(size=> { const file=path.join(iconset,`win-${size}.png`); execFileSync('sips',['-z',String(size),String(size),path.join(root,'build/icon.png'),'--out',file],{stdio:'ignore'}); return {size,data:fs.readFileSync(file)}; });
 const header=Buffer.alloc(6+images.length*16); header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
 images.forEach(({size,data},i)=>{const pos=6+i*16;header[pos]=size===256?0:size;header[pos+1]=size===256?0:size;header.writeUInt16LE(1,pos+4);header.writeUInt16LE(32,pos+6);header.writeUInt32LE(data.length,pos+8);header.writeUInt32LE(offset,pos+12);offset+=data.length;});
 fs.writeFileSync(path.join(root,'build/icon.ico'),Buffer.concat([header,...images.map(i=>i.data)]));
 for (const [name, size, height, width] of [['installer-sidebar',150,314,164],['installer-header',48,57,150]]) {
  const temporary = path.join(iconset, `${name}.png`);
  execFileSync('sips',['-z',String(size),String(size),path.join(root,'build/icon.png'),'--out',temporary],{stdio:'ignore'});
  execFileSync('sips',['-p',String(height),String(width),'--padColor','FFFFFF',temporary,'--out',temporary],{stdio:'ignore'});
  execFileSync('sips',['-s','format','bmp',temporary,'--out',path.join(root,'build',`${name}.bmp`)],{stdio:'ignore'});
 }
 fs.rmSync(iconset,{recursive:true});
 fs.mkdirSync(path.join(root,'public'),{recursive:true});
 fs.copyFileSync(path.join(root,'build/icon.png'),path.join(root,'public/icon.png'));
 const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image width="1024" height="1024" href="data:image/png;base64,${fs.readFileSync(path.join(root,'build/icon.png')).toString('base64')}"/></svg>`;
 for (const directory of ['build','public']) fs.writeFileSync(path.join(root,directory,'icon.svg'),svg); 
 console.log('Generated macOS, Windows and PNG application icons.');
})().catch(error=>{console.error(error);process.exitCode=1;});
