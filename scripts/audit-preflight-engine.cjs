const { app } = require('electron')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const engine = require('../hosting/stacker/engine.cjs')
const { scanDatabaseSources } = require('../hosting/stacker/lib/database-sources.cjs')
;(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-preflight-engine-'))
 app.setPath('userData', path.join(root, 'profile'))
 await fs.mkdir(app.getPath('userData'), { recursive: true })
 await app.whenReady()
 const runtimeRoot = path.join(app.getPath('userData'), 'LocalEnvironment/runtimes')
 await fs.mkdir(runtimeRoot, { recursive: true })
 const cache = process.env.FRAMEUI_PREFLIGHT_CACHE || '/var/folders/90/gc1n68853tjdwz7gdsdnbvlm0000gn/T/frameui-preflight-budget-M4Utoo/LocalEnvironment/runtimes'
 for (const folder of ['node', 'php', 'composer']) await fs.symlink(path.join(cache, folder), path.join(runtimeRoot, folder))
 await fs.symlink('/tmp/frameui-db-runtime-audit', path.join(runtimeRoot, 'databases'))
 console.log('Audit profile:', root)
 await engine.initialize(null, (channel, event) => { if (channel === 'setup:progress') console.log(event.stage, event.status || '') })
 try {
  for (const kind of (process.env.FRAMEUI_AUDIT_CASE ? [process.env.FRAMEUI_AUDIT_CASE] : ['static', 'postgres-sql', 'postgres-migrations', 'sqlite'])) {
   const source = path.join(root, 'sources', kind), workspace = path.join(root, 'workspaces', kind)
   await fs.mkdir(source, { recursive: true })
   if (kind === 'static') await fs.writeFile(path.join(source, 'index.html'), '<h1>Preflight static application</h1>')
   else if (kind === 'sqlite') {
    await fs.writeFile(path.join(source, '.env'), 'DB_CONNECTION=sqlite\n')
    await fs.writeFile(path.join(source, 'index.php'), '<?php echo "<h1>SQLite application</h1>";')
    require('node:child_process').execFileSync('/usr/bin/sqlite3', [path.join(source, 'sample.sqlite'), 'CREATE TABLE budgets(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO budgets(name) VALUES (\'Audit\');'])
   } else {
    await fs.writeFile(path.join(source, '.env'), 'DATABASE_URL=postgresql://never:connect@production.invalid/original\n')
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: kind, private: true, scripts: { start: 'node server.cjs' }, dependencies: { pg: '8.16.3', ...(kind.endsWith('migrations') ? { prisma: '6.16.2' } : {}) } }))
    await fs.writeFile(path.join(source, 'server.cjs'), "const http=require('http');const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});http.createServer(async(req,res)=>{try{const result=await pool.query('SELECT * FROM budgets');res.setHeader('Content-Type','text/html');res.end('<h1>'+result.rows[0].name+'</h1>')}catch(e){res.statusCode=500;res.end(e.message)}}).listen(Number(process.env.PORT)||3000,'127.0.0.1');")
    const sql = 'CREATE TABLE budgets(id SERIAL PRIMARY KEY, name TEXT); INSERT INTO budgets(name) VALUES (\'Preflight database application\');'
    if (kind.endsWith('migrations')) {
     await fs.mkdir(path.join(source, 'prisma/migrations/202609100001_initial'), { recursive: true })
     await fs.writeFile(path.join(source, 'prisma/schema.prisma'), 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\nmodel budgets {\n id Int @id @default(autoincrement())\n name String?\n}\n')
     await fs.writeFile(path.join(source, 'prisma/migrations/migration_lock.toml'), 'provider = "postgresql"\n')
     await fs.writeFile(path.join(source, 'prisma/migrations/202609100001_initial/migration.sql'), sql)
    } else await fs.writeFile(path.join(source, 'database.sql'), sql)
   }
   await fs.mkdir(path.dirname(workspace), { recursive: true }); await fs.cp(source, workspace, { recursive: true })
   if (process.env.FRAMEUI_AUDIT_FAIL_DEPENDENCY || process.env.FRAMEUI_AUDIT_MISSING_RUNTIME) {
    const file = path.join(workspace, 'package.json'), pkg = JSON.parse(await fs.readFile(file, 'utf8'))
    if (process.env.FRAMEUI_AUDIT_FAIL_DEPENDENCY) pkg.scripts.preinstall = 'node -e "process.exit(42)"'
    if (process.env.FRAMEUI_AUDIT_MISSING_RUNTIME) pkg.engines = { node: '>=999.0.0' }
    await fs.writeFile(file, JSON.stringify(pkg))
   }
   const { project, plan } = await engine.inspect(workspace)
   const sources = await scanDatabaseSources(workspace)
   const database = kind.startsWith('postgres') ? 'postgres' : kind === 'sqlite' ? 'sqlite' : 'skip'
   const options = { runtimeVersion: plan.steps.find(s => s.id === 'runtime')?.version, installDependencies: true, createEnvironment: true, environmentMode: 'local', database, databaseMode: database === 'skip' ? 'skip' : 'create', databaseEngine: database, databaseSource: sources[0], preflightDatabase: true, startWhenReady: true }
   if (process.env.FRAMEUI_AUDIT_MISSING_RUNTIME || process.env.FRAMEUI_AUDIT_FAIL_DEPENDENCY) {
    await assert.rejects(engine.invoke('projects:setup', project.id, options))
    const failed = engine.snapshot(project.id)
    assert(!failed.process?.running)
    if (process.env.FRAMEUI_AUDIT_FAIL_DEPENDENCY) assert.equal(failed.setup.failure.step, 'dependencies')
    else assert(plan.blocking)
    console.log('PASS', process.env.FRAMEUI_AUDIT_MISSING_RUNTIME ? 'missing runtime blocks preparation' : 'failed dependency installation blocks application startup')
    continue
   }
   if (process.env.FRAMEUI_AUDIT_FAIL_MIGRATION && kind === 'postgres-migrations') {
    await fs.writeFile(path.join(workspace, 'prisma/migrations/202609100001_initial/migration.sql'), 'INVALID MIGRATION SQL;')
    options.databaseSource = (await scanDatabaseSources(workspace)).find(source => source.kind === 'migrations')
    await assert.rejects(engine.invoke('projects:setup', project.id, options))
    const failed = engine.snapshot(project.id)
    assert.equal(failed.setup.failure.step, 'running_migrations')
    assert(!failed.process?.running)
    assert.equal(failed.setup.steps.dependencies.status, 'completed')
    console.log('PASS failed migration remains in the migration stage; application never starts')
    continue
   }
   if (kind === 'postgres-sql') {
    const file = path.join(workspace, 'database.sql'), valid = await fs.readFile(file, 'utf8')
    await fs.writeFile(file, 'THIS IS NOT VALID SQL;')
    options.databaseSource = (await scanDatabaseSources(workspace))[0]
    await assert.rejects(engine.invoke('projects:setup', project.id, options))
    const failed = engine.snapshot(project.id)
    assert.equal(failed.setup.failure.step, 'importing_database')
    assert(!failed.process?.running, 'a failed import must never start the application')
    const dependenciesFinished = failed.setup.steps.dependencies.finishedAt
    await fs.writeFile(file, valid)
    options.databaseSource = (await scanDatabaseSources(workspace))[0]
    await engine.inspect(workspace)
    await engine.invoke('projects:setup', project.id, options)
    assert.equal(engine.snapshot(project.id).setup.steps.dependencies.finishedAt, dependenciesFinished, 'retry must retain installed dependencies')
    console.log('PASS failed SQL import stays at database stage and retries without reinstalling dependencies')
   } else await engine.invoke('projects:setup', project.id, options)
   let current = engine.snapshot(project.id)
   assert(current.process.running, kind + ' must be running')
   assert.equal(current.setup.status, 'completed')
   const body = await (await require('electron').net.fetch(current.localUrl)).text()
   assert(body.includes(kind === 'static' ? 'Preflight static' : kind === 'sqlite' ? 'SQLite application' : 'Preflight database application'), kind + ' usable page')
   await engine.invoke('processes:stop', project.id)
   const first = current.setup.steps.running_migrations?.finishedAt || current.setup.steps.importing_database?.finishedAt
   const refreshed = await engine.inspect(workspace)
   await engine.invoke('projects:setup', project.id, { ...options, runtimeVersion: refreshed.plan.steps.find(s => s.id === 'runtime')?.version })
   current = engine.snapshot(project.id)
   assert.equal(current.setup.steps.running_migrations?.finishedAt || current.setup.steps.importing_database?.finishedAt, first, 'unchanged data must not run twice')
   await engine.invoke('processes:stop', project.id)
   if (kind === 'postgres-migrations') {
    await fs.mkdir(path.join(workspace, 'prisma/migrations/202609100002_note'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'prisma/migrations/202609100002_note/migration.sql'), 'ALTER TABLE budgets ADD COLUMN note TEXT;')
    const next = (await scanDatabaseSources(workspace)).find(source => source.kind === 'migrations')
    assert.notEqual(next.signature, options.databaseSource.signature)
    await engine.inspect(workspace)
    await engine.invoke('projects:setup', project.id, { ...options, databaseSource: next })
    assert(engine.snapshot(project.id).process.running)
    await engine.invoke('processes:stop', project.id)
    console.log('PASS new Prisma migration applies to the existing database')
   }
   console.log('PASS', kind, 'first preparation, usable page, stop/reopen, no repeated database import')
  }
 } finally { await engine.shutdown(); app.quit() }
})().catch(error => { console.error(error); app.exit(1) })
