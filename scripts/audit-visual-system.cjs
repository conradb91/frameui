// Run after building. Uses a temporary project and isolated Electron profile.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-visual-'));
 const output = process.env.FRAMEUI_VISUAL_OUTPUT || path.join(fixture, 'screenshots');
 fs.mkdirSync(output, { recursive: true });
 fs.writeFileSync(path.join(fixture, 'index.html'), '<html><body><main><h1>Project artwork</h1><button>Continue</button></main></body></html>');
 const app = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${fixture}-profile`], env: {...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1', ELECTRON_RUN_AS_NODE:''} });
 const errors = [];
 try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({dialog}, fixture) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[fixture]});}, fixture);
  async function inspect(name, theme) {
   const result = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const unexpectedFonts = [], smallText = [];
    for (const el of document.querySelectorAll('body *')) {
     if (el.closest('[data-frameui-node-id],.project-library-rail')) continue;
     const style = getComputedStyle(el);
     if (!el.getClientRects().length || style.visibility === 'hidden') continue;
     if (![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
     if (!style.fontFamily.includes('SF Pro Text') && !style.fontFamily.includes('SFMono-Regular')) unexpectedFonts.push([el.tagName, style.fontFamily]);
     if (parseFloat(style.fontSize) < 11) smallText.push([el.textContent.slice(0,40), style.fontSize]);
    }
    return {unexpectedFonts, smallText, background:getComputedStyle(document.body).backgroundColor, accent:root.getPropertyValue('--ui-accent').trim(), scheme:root.colorScheme, overflow:document.documentElement.scrollWidth > innerWidth};
   });
   assert.deepEqual(result.unexpectedFonts, [], `${name}: font inheritance`);
   assert.deepEqual(result.smallText, [], `${name}: readable chrome text`);
   assert.equal(result.scheme, theme);
   assert.equal(result.accent, '#2563eb');
   assert.equal(result.overflow, false, `${name}: horizontal overflow`);
   await page.screenshot({path:path.join(output, `${theme}-${name}.png`)});
   console.log(`PASS ${theme}: ${name}`);
  }
  for (const theme of ['light','dark']) {
   await page.getByRole('radio',{name:theme === 'light' ? 'Light':'Dark',exact:true}).check();
   await inspect('onboarding', theme);
  }
  await page.getByRole('button',{name:'Get started'}).click();
  await inspect('project-library','dark');
  await page.getByRole('button',{name:'Open Project',exact:true}).first().click();
  await page.getByRole('heading',{name:'A place for your next idea.'}).waitFor();
  for (const theme of ['dark','light']) {
   // Leave the project Appearance section before opening another picker.
   const navigation = page.getByPlaceholder(/Quick open/);
   await navigation.fill('Open Application');
   await navigation.focus();
   await page.getByRole('button',{name:'Open Application Command',exact:true}).click();
   await page.getByRole('button',{name:'Application settings',exact:true}).click();
   await page.getByRole('dialog',{name:'Application settings'}).getByRole('radio',{name:theme === 'light' ? 'Light':'Dark',exact:true}).check();
   await inspect('settings-dialog',theme);
   await page.getByRole('button',{name:'Close settings',exact:true}).click();
   for (const command of ['Open Application','Open Pages','Find Component','Open Design System','Open Journey','Open Features','Open Review','Open Problems','Open Project Settings']) {
    const input = page.getByPlaceholder(/Quick open/);
    await input.fill(command);
    await input.focus();
    await page.getByRole('button',{name:command+' Command',exact:true}).click();
    await input.blur();
    await page.waitForTimeout(160);
    await inspect(command.toLowerCase().replaceAll(' ','-'),theme);
   }
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
 } finally { await app.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
