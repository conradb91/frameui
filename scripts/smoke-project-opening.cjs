const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-opening-'));
  const profile = `${root}-profile`;
  let app;
  try {
    for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(root, `page-${i}.html`), `<main><h1>Page ${i}</h1><button>Continue</button></main>`);
    app = await electron.launch({ executablePath: process.env.FRAMEUI_ELECTRON_PATH || require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`], env: { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1', ELECTRON_RUN_AS_NODE: '' } });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      globalThis.openingTicks = 0;
      globalThis.openingTimer = setInterval(() => globalThis.openingTicks++, 10);
    }, root);
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.evaluate(() => {
      window.observedSteps = [];
      window.frameui.project.onIndexProgress(({ step }) => window.observedSteps.push(step));
    });
    await page.getByRole('button', { name: 'Open Project', exact: true }).first().click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.getByText('Find screens and components', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to projects', exact: true }).waitFor();
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await page.evaluate(() => window.observedSteps.includes('done'))) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 });
    const steps = await page.evaluate(() => window.observedSteps);
    assert(steps.includes('done'), `Index failed: ${steps}`);
    const ticks = await app.evaluate(() => globalThis.openingTicks);
    assert(ticks > 5, 'Main process did not remain responsive');
    const index = await page.evaluate(() => window.frameui.project.getIndex());
    assert.equal(index.projectModel.pages.length, 300);
    // A rebuild must allow independent main-process IPC while it is running.
    const during = await page.evaluate(async () => {
      let finished = false;
      const work = window.frameui.project.reindex().then(() => { finished = true; });
      await window.frameui.project.listLibrary();
      const responsive = !finished;
      await work;
      return responsive;
    });
    assert(during, 'Indexing blocked independent IPC');
    await page.evaluate(() => window.frameui.project.close());
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    console.log(JSON.stringify({ pages: index.projectModel.pages.length, steps, mainProcessTicks: ticks, ipcResponsiveDuringRebuild: during }));
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
