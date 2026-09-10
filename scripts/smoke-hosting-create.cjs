const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-create-hosting-'));
  let app;
  try {
    app = await electron.launch({ executablePath: process.env.FRAMEUI_ELECTRON_PATH || require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${root}/profile`], env: { ...process.env, ELECTRON_RUN_AS_NODE: '', FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' } });
    const page = await app.firstWindow();
    page.on('pageerror', error => console.error('Renderer error:', error.message));
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, root);
    await page.getByRole('button', { name: 'Create Project', exact: true }).click();
    await page.screenshot({ path: '/private/tmp/frameui-create-review.png' });
    await page.getByRole('button', { name: 'Choose location & review', exact: true }).click();
    const create = page.getByRole('button', { name: 'Create application', exact: true });
    await create.waitFor();
    assert.equal(await create.isDisabled(), true);
    assert.equal(fs.existsSync(path.join(root, 'my-project')), false);
    await page.getByRole('dialog', { name: 'Create application project' }).getByRole('checkbox').check();
    await create.click();
    await page.getByRole('heading', { name: 'Local environment', exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert(fs.readFileSync(path.join(root, 'my-project/index.html'), 'utf8').includes('It works'));
    const records = await page.evaluate(() => window.frameui.project.listLibrary());
    assert.equal(records.length, 1);
    assert.equal(records[0].name, 'my-project');
    await page.screenshot({ path: '/private/tmp/frameui-local-environment.png' });
    console.log('Creation approval, starter files, FrameUI registration and local setup handoff passed.');
  } finally { if (app) await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
