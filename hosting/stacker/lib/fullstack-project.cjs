const fs = require('fs/promises')
const path = require('path')

function safePackageName(value) {
  return String(value || 'stacker-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stacker-project'
}

function databaseModule(engine) {
  if (engine === 'postgres') return `import { Pool } from 'pg'\n\nexport const db = new Pool({\n  host: process.env.DB_HOST,\n  port: Number(process.env.DB_PORT),\n  database: process.env.DB_DATABASE,\n  user: process.env.DB_USERNAME,\n  password: process.env.DB_PASSWORD,\n})\n\nexport async function checkDatabase() {\n  await db.query('SELECT 1')\n}\n`
  if (engine === 'mariadb') return `import mysql from 'mysql2/promise'\n\nexport const db = mysql.createPool({\n  host: process.env.DB_HOST,\n  port: Number(process.env.DB_PORT),\n  database: process.env.DB_DATABASE,\n  user: process.env.DB_USERNAME,\n  password: process.env.DB_PASSWORD,\n  connectionLimit: 5,\n})\n\nexport async function checkDatabase() {\n  await db.query('SELECT 1')\n}\n`
  if (engine === 'sqlite') return `import Database from 'better-sqlite3'\n\nconst filename = process.env.DB_DATABASE\nexport const db = new Database(filename)\n\nexport async function checkDatabase() {\n  db.prepare('SELECT 1').get()\n}\n`
  return `export const db = null\n\nexport async function checkDatabase() {}\n`
}

function serverModule(engine) {
  const databaseEnabled = engine !== 'none'
  return `import cors from 'cors'\nimport dotenv from 'dotenv'\nimport express from 'express'\nimport { checkDatabase } from './db/index.js'\n\ndotenv.config({ path: new URL('../.env', import.meta.url) })\n\nconst app = express()\nconst port = Number(process.env.PORT || 5174)\n\napp.disable('x-powered-by')\napp.use(cors({ origin: false }))\napp.use(express.json())\n\napp.get('/api', (_request, response) => {\n  response.json({ application: process.env.APP_NAME || 'Stacker project', database: ${databaseEnabled ? "'configured'" : "'not configured'"} })\n})\n\napp.get('/api/health', async (_request, response) => {\n  try {\n    await checkDatabase()\n    response.json({ status: 'ok', database: ${databaseEnabled ? "'connected'" : "'not configured'"} })\n  } catch (error) {\n    response.status(503).json({ status: 'error', message: error.message })\n  }\n})\n\nconst server = app.listen(port, '127.0.0.1', () => {\n  console.log(\`API ready on port \${port}\`)\n})\n\nfor (const signal of ['SIGINT', 'SIGTERM']) {\n  process.on(signal, () => server.close(() => process.exit(0)))\n}\n`
}

function supervisorModule() {
  return `import { spawn } from 'node:child_process'\nimport fs from 'node:fs'\n\nconst manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))\nconst manager = manifest.stacker?.packageManager || 'npm'\nconst clientPort = String(process.env.PORT || 5173)\nconst apiPort = String(process.env.API_PORT || Number(clientPort) + 1)\n\nfunction clientCommand() {\n  if (manager === 'pnpm') return ['pnpm', ['--dir', 'client', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', clientPort]]\n  if (manager === 'yarn') return ['yarn', ['--cwd', 'client', 'dev', '--host', '127.0.0.1', '--port', clientPort]]\n  return ['npm', ['--prefix', 'client', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', clientPort]]\n}\n\nconst [clientExecutable, clientArgs] = clientCommand()\nconst children = [\n  spawn(process.execPath, ['server/src/server.js'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort } }),\n  spawn(clientExecutable, clientArgs, { stdio: 'inherit', env: process.env }),\n]\nlet stopping = false\nfunction stop(code = 0) {\n  if (stopping) return\n  stopping = true\n  for (const child of children) if (child.exitCode == null) child.kill('SIGTERM')\n  setTimeout(() => process.exit(code), 250).unref()\n}\nfor (const child of children) {\n  child.on('error', error => { console.error(error.message); stop(1) })\n  child.on('exit', code => { if (!stopping) stop(code || 1) })\n}\nfor (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))\n`
}

function viteConfig(frontend) {
  const pluginImport = frontend === 'react' ? "import react from '@vitejs/plugin-react'\n" : frontend === 'vue' ? "import vue from '@vitejs/plugin-vue'\n" : ''
  const plugins = frontend === 'react' ? '  plugins: [react()],' : frontend === 'vue' ? '  plugins: [vue()],' : ''
  return `import { defineConfig } from 'vite'\n${pluginImport}\nexport default defineConfig({\n${plugins ? `${plugins}\n` : ''}  server: {\n    proxy: {\n      '/api': {\n        target: \`http://127.0.0.1:\${process.env.API_PORT || 5174}\`,\n        changeOrigin: false,\n      },\n    },\n  },\n})\n`
}

async function writeFullStackSupportFiles(target, { name, frontend, database = 'none', packageManager = 'npm', apiPort = 5174 }) {
  const packageName = safePackageName(name)
  const driver = database === 'postgres' ? ['pg'] : database === 'mariadb' ? ['mysql2'] : database === 'sqlite' ? ['better-sqlite3'] : []
  const clientCommand = (script, optional = false) => packageManager === 'pnpm'
    ? `pnpm --dir client run ${script}${optional ? ' --if-present' : ''}`
    : packageManager === 'yarn' ? `yarn --cwd client ${script}` : `npm --prefix client run ${script}${optional ? ' --if-present' : ''}`
  const rootManifest = {
    name: packageName,
    private: true,
    type: 'module',
    workspaces: ['client', 'server'],
    scripts: {
      dev: 'node scripts/start.mjs',
      build: clientCommand('build'),
      test: clientCommand('test', true),
    },
    stacker: { recipe: `${frontend}-vite-express-${database}`, packageManager, applicationPort: 5173, apiPort },
  }
  const serverManifest = {
    name: `${packageName}-server`,
    private: true,
    type: 'module',
    scripts: { dev: 'node src/server.js' },
    dependencies: Object.fromEntries(['express', 'cors', 'dotenv', ...driver].map(dependency => [dependency, 'latest'])),
  }
  const serverEnvironment = [
    `APP_NAME=${packageName}`,
    `PORT=${apiPort}`,
    'DB_HOST=127.0.0.1',
    'DB_PORT=',
    `DB_DATABASE=${packageName.replace(/-/g, '_')}`,
    `DB_USERNAME=${packageName.replace(/-/g, '_')}`,
    'DB_PASSWORD=',
    'DATABASE_URL=',
    '',
  ].join('\n')
  await Promise.all([
    fs.mkdir(path.join(target, 'server', 'src', 'db'), { recursive: true }),
    fs.mkdir(path.join(target, 'server', 'src', 'routes'), { recursive: true }),
    fs.mkdir(path.join(target, 'scripts'), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(path.join(target, 'package.json'), `${JSON.stringify(rootManifest, null, 2)}\n`, { flag: 'wx' }),
    fs.writeFile(path.join(target, 'server', 'package.json'), `${JSON.stringify(serverManifest, null, 2)}\n`, { flag: 'wx' }),
    fs.writeFile(path.join(target, 'server', '.env'), serverEnvironment, { mode: 0o600, flag: 'wx' }),
    fs.writeFile(path.join(target, 'server', '.env.example'), serverEnvironment.replace(/^DB_PASSWORD=.*$/m, 'DB_PASSWORD='), { flag: 'wx' }),
    fs.writeFile(path.join(target, 'server', 'src', 'db', 'index.js'), databaseModule(database), { flag: 'wx' }),
    fs.writeFile(path.join(target, 'server', 'src', 'routes', 'index.js'), `export const apiPrefix = '/api'\n`, { flag: 'wx' }),
    fs.writeFile(path.join(target, 'server', 'src', 'server.js'), serverModule(database), { flag: 'wx' }),
    fs.writeFile(path.join(target, 'scripts', 'start.mjs'), supervisorModule(), { flag: 'wx' }),
    fs.writeFile(path.join(target, 'client', '.env'), 'VITE_API_URL=/api\n', { flag: 'wx' }),
    fs.writeFile(path.join(target, 'client', 'vite.config.js'), viteConfig(frontend)),
    fs.writeFile(path.join(target, '.gitignore'), 'node_modules/\nclient/dist/\nserver/.env\n.DS_Store\n', { flag: 'wx' }),
    ...(packageManager === 'pnpm' ? [fs.writeFile(path.join(target, 'pnpm-workspace.yaml'), "packages:\n  - 'client'\n  - 'server'\n", { flag: 'wx' })] : []),
  ])
  return { recipeId: rootManifest.stacker.recipe, apiPort, files: ['client', 'server', 'scripts/start.mjs'] }
}

module.exports = { writeFullStackSupportFiles, databaseModule, serverModule, supervisorModule, viteConfig, safePackageName }
