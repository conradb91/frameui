const { execFile } = require('child_process')
const fs = require('fs/promises')

const DESTRUCTIVE_PATTERN = /^\s*(DELETE|UPDATE|DROP|TRUNCATE|ALTER|INSERT|CREATE|REPLACE|GRANT|REVOKE)\b/i
const MAX_ROWS = 500
const PAGE_SIZE = 50

function quoteIdentifier(value, engine = 'sqlite') {
  const name = String(value || '')
  if (!name || name.length > 128 || name.includes('\0')) throw new Error('Invalid database identifier.')
  return engine === 'mariadb' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`
}

function sqlLiteral(value) {
  if (value === null || value === undefined || value === '') return value === '' ? "''" : 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid numeric value.')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function serializable(value) { return typeof value === 'bigint' ? String(value) : value }
function csvCell(value) { const text = value == null ? '' : String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text }
function safeType(value) {
  const type = String(value || 'TEXT').trim()
  if (!/^[A-Za-z][A-Za-z0-9 ]*(?:\([0-9, ]+\))?(?:\s+UNSIGNED)?$/i.test(type)) throw new Error('Choose a valid database column type.')
  return type
}

function execCapture(file, args, options = {}) {
  return new Promise((resolve, reject) => execFile(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 30_000, ...options }, (error, stdout, stderr) => error ? reject(Object.assign(new Error(stderr?.trim() || error.message), { stderr })) : resolve(stdout)))
}

// Minimal RFC4180 CSV parser: handles quoted fields, doubled-quote escaping,
// and commas/newlines inside quoted fields. Good enough for psql --csv and
// sqlite3 -csv output; not a general-purpose CSV library.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const push = () => { row.push(field); field = '' }
  const pushRow = () => { push(); rows.push(row); row = [] }
  while (i < text.length) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i += 1; continue
      }
      field += char; i += 1; continue
    }
    if (char === '"') { inQuotes = true; i += 1; continue }
    if (char === ',') { push(); i += 1; continue }
    if (char === '\r') { i += 1; continue }
    if (char === '\n') { pushRow(); i += 1; continue }
    field += char; i += 1
  }
  if (field.length || row.length) pushRow()
  if (!rows.length) return { columns: [], rows: [] }
  const [columns, ...body] = rows.filter(r => !(r.length === 1 && r[0] === ''))
  return { columns, rows: body }
}

function unescapeMysqlBatch(value) {
  if (value === 'NULL') return null
  return value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
}

function parseMysqlBatch(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(line => line.length)
  if (!lines.length) return { columns: [], rows: [] }
  const columns = lines[0].split('\t')
  const rows = lines.slice(1).map(line => line.split('\t').map(unescapeMysqlBatch))
  return { columns, rows }
}

class DatabaseAdmin {
  constructor(databaseManager, databaseServices) {
    this.databaseManager = databaseManager
    this.databaseServices = databaseServices
  }

  async connectionFor(project) {
    const info = await this.databaseManager.info(project)
    if (info.engine === 'SQLite') {
      if (!info.file) throw new Error('No project SQLite database was detected.')
      return { engine: 'sqlite', file: info.file }
    }
    if (info.service) {
      const { engine, connection, password, binaries } = await this.databaseServices.projectConnection(project)
      if (!binaries) throw new Error('The compatible database tools are no longer available.')
      if (connection.managed !== false) await this.databaseServices.start(engine)
      return { engine, connection, password, binaries }
    }
    throw new Error('No project database is configured for administration.')
  }

  async listTables(project) {
    const conn = await this.connectionFor(project)
    if (conn.engine === 'sqlite') {
      const result = await this.sqliteQuery(conn.file, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      return Promise.all(result.rows.map(async row => ({ name: row[0], rowCount: Number((await this.sqliteQuery(conn.file, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(row[0])}`)).rows[0]?.[0] || 0) })))
    }
    if (conn.engine === 'postgres') {
      const result = await this.query(project, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name", { confirm: true })
      return Promise.all(result.rows.map(async row => ({ name: row[0], rowCount: Number((await this.psqlQuery(conn, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(row[0], conn.engine)}`)).rows[0]?.[0] || 0) })))
    }
    const result = await this.query(project, 'SHOW TABLES', { confirm: true })
    return Promise.all(result.rows.map(async row => ({ name: row[0], rowCount: Number((await this.mysqlQuery(conn, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(row[0], conn.engine)}`)).rows[0]?.[0] || 0) })))
  }

  async overview(project) {
    const conn = await this.connectionFor(project)
    const tables = await this.listTables(project)
    let version = 'Unknown'
    let size = 0
    let database = project.name
    if (conn.engine === 'sqlite') {
      version = (await this.sqliteQuery(conn.file, 'SELECT sqlite_version() AS version')).rows[0]?.[0] || version
      size = require('fs').statSync(conn.file).size
      database = require('path').basename(conn.file)
    } else if (conn.engine === 'postgres') {
      version = (await this.psqlQuery(conn, 'SHOW server_version')).rows[0]?.[0] || version
      size = Number((await this.psqlQuery(conn, 'SELECT pg_database_size(current_database()) AS size')).rows[0]?.[0] || 0)
      database = conn.connection.database
    } else {
      version = (await this.mysqlQuery(conn, 'SELECT VERSION() AS version')).rows[0]?.[0] || version
      size = Number((await this.mysqlQuery(conn, "SELECT COALESCE(SUM(data_length + index_length), 0) AS size FROM information_schema.tables WHERE table_schema = DATABASE()" )).rows[0]?.[0] || 0)
      database = conn.connection.database
    }
    return { connected: true, engine: conn.engine === 'postgres' ? 'PostgreSQL' : conn.engine === 'mariadb' ? 'MariaDB/MySQL' : 'SQLite', version, size, database, tableCount: tables.length, tables }
  }

  async structure(project, table) {
    const conn = await this.connectionFor(project)
    const q = quoteIdentifier(table, conn.engine)
    if (conn.engine === 'sqlite') {
      const columns = (await this.sqliteQuery(conn.file, `PRAGMA table_info(${q})`)).rows.map(row => ({ position: row[0], name: row[1], type: row[2] || 'TEXT', nullable: !row[3], defaultValue: row[4], primary: Boolean(row[5]), autoIncrement: Boolean(row[5] && /INT/i.test(row[2] || '')) }))
      const indexRows = (await this.sqliteQuery(conn.file, `PRAGMA index_list(${q})`)).rows
      const indexes = await Promise.all(indexRows.map(async row => ({ name: row[1], unique: Boolean(row[2]), columns: (await this.sqliteQuery(conn.file, `PRAGMA index_info(${quoteIdentifier(row[1])})`)).rows.map(item => item[2]) })))
      const relations = (await this.sqliteQuery(conn.file, `PRAGMA foreign_key_list(${q})`)).rows.map(row => ({ name: `fk_${table}_${row[3]}`, column: row[3], referencedTable: row[2], referencedColumn: row[4], onUpdate: row[5], onDelete: row[6] }))
      return { columns, indexes, relations, primaryKey: columns.find(column => column.primary)?.name || null }
    }
    if (conn.engine === 'postgres') {
      const columnsResult = await this.psqlQuery(conn, `SELECT column_name,data_type,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name=${sqlLiteral(table)} ORDER BY ordinal_position`)
      const primaryResult = await this.psqlQuery(conn, `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=${sqlLiteral(table)}::regclass AND i.indisprimary`)
      const primary = primaryResult.rows.map(row => row[0])
      const indexResult = await this.psqlQuery(conn, `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=${sqlLiteral(table)} ORDER BY indexname`)
      const relationResult = await this.psqlQuery(conn, `SELECT tc.constraint_name,kcu.column_name,ccu.table_name,ccu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name=${sqlLiteral(table)}`)
      return { columns: columnsResult.rows.map(row => ({ name: row[0], type: row[1], nullable: row[2] === 'YES', defaultValue: row[3], position: row[4], primary: primary.includes(row[0]), autoIncrement: /nextval/i.test(row[3] || '') })), indexes: indexResult.rows.map(row => ({ name: row[0], definition: row[1], unique: /CREATE UNIQUE INDEX/i.test(row[1]) })), relations: relationResult.rows.map(row => ({ name: row[0], column: row[1], referencedTable: row[2], referencedColumn: row[3] })), primaryKey: primary[0] || null }
    }
    const columnsResult = await this.mysqlQuery(conn, `SHOW FULL COLUMNS FROM ${q}`)
    const indexResult = await this.mysqlQuery(conn, `SHOW INDEX FROM ${q}`)
    const relationResult = await this.mysqlQuery(conn, `SELECT constraint_name,column_name,referenced_table_name,referenced_column_name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name=${sqlLiteral(table)} AND referenced_table_name IS NOT NULL`)
    const columns = columnsResult.rows.map(row => ({ name: row[0], type: row[1], nullable: row[3] === 'YES', primary: row[4] === 'PRI', unique: row[4] === 'UNI', defaultValue: row[5], autoIncrement: /auto_increment/i.test(row[6] || '') }))
    const indexGroups = new Map()
    indexResult.rows.forEach(row => { const current = indexGroups.get(row[2]) || { name: row[2], unique: row[1] === '0', columns: [] }; current.columns.push(row[4]); indexGroups.set(row[2], current) })
    return { columns, indexes: [...indexGroups.values()], relations: relationResult.rows.map(row => ({ name: row[0], column: row[1], referencedTable: row[2], referencedColumn: row[3] })), primaryKey: columns.find(column => column.primary)?.name || null }
  }

  async browse(project, table, options = {}) {
    const conn = await this.connectionFor(project)
    const schema = await this.structure(project, table)
    const pageSize = Math.max(10, Math.min(100, Number(options.pageSize) || PAGE_SIZE))
    const page = Math.max(1, Number(options.page) || 1)
    const q = quoteIdentifier(table, conn.engine)
    let where = ''
    if (String(options.search || '').trim()) {
      const term = sqlLiteral(`%${String(options.search).trim()}%`)
      const cast = conn.engine === 'mariadb' ? column => `CAST(${quoteIdentifier(column.name, conn.engine)} AS CHAR)` : column => `CAST(${quoteIdentifier(column.name, conn.engine)} AS TEXT)`
      const operator = conn.engine === 'postgres' ? 'ILIKE' : 'LIKE'
      where = ` WHERE ${schema.columns.map(column => `${cast(column)} ${operator} ${term}`).join(' OR ')}`
    }
    const allowedSort = schema.columns.some(column => column.name === options.sortColumn) ? options.sortColumn : schema.primaryKey
    const order = allowedSort ? ` ORDER BY ${quoteIdentifier(allowedSort, conn.engine)} ${String(options.sortDirection).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}` : ''
    const count = await (conn.engine === 'sqlite' ? this.sqliteQuery(conn.file, `SELECT COUNT(*) AS count FROM ${q}${where}`) : conn.engine === 'postgres' ? this.psqlQuery(conn, `SELECT COUNT(*) AS count FROM ${q}${where}`) : this.mysqlQuery(conn, `SELECT COUNT(*) AS count FROM ${q}${where}`))
    const result = await (conn.engine === 'sqlite' ? this.sqliteQuery(conn.file, `SELECT * FROM ${q}${where}${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`) : conn.engine === 'postgres' ? this.psqlQuery(conn, `SELECT * FROM ${q}${where}${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`) : this.mysqlQuery(conn, `SELECT * FROM ${q}${where}${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`))
    return { ...result, total: Number(count.rows[0]?.[0] || 0), page, pageSize, primaryKey: schema.primaryKey }
  }

  async tableAction(project, payload = {}) {
    const conn = await this.connectionFor(project)
    const table = quoteIdentifier(payload.table || payload.name, conn.engine)
    let sql
    if (payload.action === 'create') sql = conn.engine === 'sqlite' ? `CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT)` : conn.engine === 'postgres' ? `CREATE TABLE ${table} (id BIGSERIAL PRIMARY KEY)` : `CREATE TABLE ${table} (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY)`
    else if (payload.action === 'rename') sql = `ALTER TABLE ${table} RENAME TO ${quoteIdentifier(payload.name, conn.engine)}`
    else {
      if (payload.confirmation !== payload.table) throw new Error(`Type “${payload.table}” to confirm this action.`)
      if (payload.action === 'drop') sql = `DROP TABLE ${table}`
      else if (payload.action === 'empty') sql = conn.engine === 'sqlite' ? `DELETE FROM ${table}` : conn.engine === 'postgres' ? `TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE` : `TRUNCATE TABLE ${table}`
      else throw new Error('Unsupported table action.')
    }
    return this.query(project, sql, { confirm: true })
  }

  async deleteRow(project, payload = {}) {
    if (!payload.confirm) throw new Error('Confirm the row deletion before continuing.')
    const conn = await this.connectionFor(project)
    const schema = await this.structure(project, payload.table)
    if (!schema.primaryKey || payload.keyColumn !== schema.primaryKey) throw new Error('This table needs a primary key before rows can be edited safely.')
    return this.query(project, `DELETE FROM ${quoteIdentifier(payload.table, conn.engine)} WHERE ${quoteIdentifier(schema.primaryKey, conn.engine)}=${sqlLiteral(payload.keyValue)}`, { confirm: true })
  }

  async saveRow(project, payload = {}) {
    const conn = await this.connectionFor(project)
    const schema = await this.structure(project, payload.table)
    const allowed = new Set(schema.columns.map(column => column.name))
    const entries = Object.entries(payload.values || {}).filter(([column]) => allowed.has(column))
    if (!entries.length) throw new Error('Enter at least one column value.')
    const table = quoteIdentifier(payload.table, conn.engine)
    if (payload.mode === 'edit') {
      if (!schema.primaryKey || payload.keyValue === undefined) throw new Error('This table needs a primary key before rows can be edited safely.')
      const assignments = entries.filter(([column]) => column !== schema.primaryKey).map(([column, value]) => `${quoteIdentifier(column, conn.engine)}=${sqlLiteral(value)}`)
      if (!assignments.length) throw new Error('No editable values changed.')
      return this.query(project, `UPDATE ${table} SET ${assignments.join(',')} WHERE ${quoteIdentifier(schema.primaryKey, conn.engine)}=${sqlLiteral(payload.keyValue)}`, { confirm: true })
    }
    const filtered = entries.filter(([column, value]) => !(column === schema.primaryKey && (value === '' || value == null) && schema.columns.find(item => item.name === column)?.autoIncrement))
    return this.query(project, `INSERT INTO ${table} (${filtered.map(([column]) => quoteIdentifier(column, conn.engine)).join(',')}) VALUES (${filtered.map(([, value]) => sqlLiteral(value)).join(',')})`, { confirm: true })
  }

  async columnAction(project, payload = {}) {
    const conn = await this.connectionFor(project)
    const table = quoteIdentifier(payload.table, conn.engine)
    const column = quoteIdentifier(payload.column || payload.name, conn.engine)
    let sql
    if (payload.action === 'add') {
      const attributes = `${safeType(payload.type)}${payload.nullable === false ? ' NOT NULL' : ''}${payload.unique ? ' UNIQUE' : ''}${payload.defaultValue !== undefined && payload.defaultValue !== '' ? ` DEFAULT ${sqlLiteral(payload.defaultValue)}` : ''}`
      sql = `ALTER TABLE ${table} ADD COLUMN ${column} ${attributes}`
    } else if (payload.action === 'rename') sql = `ALTER TABLE ${table} RENAME COLUMN ${column} TO ${quoteIdentifier(payload.name, conn.engine)}`
    else if (payload.action === 'type') {
      if (conn.engine === 'sqlite') throw new Error('SQLite requires a table rebuild to change a column type. Create a migration for this change.')
      sql = conn.engine === 'postgres' ? `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${safeType(payload.type)}` : `ALTER TABLE ${table} MODIFY COLUMN ${column} ${safeType(payload.type)}${payload.nullable === false ? ' NOT NULL' : ' NULL'}`
    } else if (payload.action === 'drop') {
      if (payload.confirmation !== payload.column) throw new Error(`Type “${payload.column}” to confirm this action.`)
      sql = `ALTER TABLE ${table} DROP COLUMN ${column}`
    } else throw new Error('Unsupported column action.')
    return this.query(project, sql, { confirm: true })
  }

  async indexAction(project, payload = {}) {
    const conn = await this.connectionFor(project)
    const table = quoteIdentifier(payload.table, conn.engine)
    const index = quoteIdentifier(payload.name, conn.engine)
    let sql
    if (payload.action === 'create') {
      const schema = await this.structure(project, payload.table)
      const columns = (payload.columns || []).filter(column => schema.columns.some(item => item.name === column))
      if (!columns.length) throw new Error('Choose at least one valid column for the index.')
      sql = `CREATE ${payload.unique ? 'UNIQUE ' : ''}INDEX ${index} ON ${table} (${columns.map(column => quoteIdentifier(column, conn.engine)).join(',')})`
    } else if (payload.action === 'drop') sql = conn.engine === 'mariadb' ? `DROP INDEX ${index} ON ${table}` : `DROP INDEX ${index}`
    else throw new Error('Unsupported index action.')
    return this.query(project, sql, { confirm: true })
  }

  async relationAction(project, payload = {}) {
    const conn = await this.connectionFor(project)
    if (conn.engine === 'sqlite') throw new Error('SQLite relationships require a table rebuild. Create a project migration so the schema remains reproducible.')
    const table = quoteIdentifier(payload.table, conn.engine)
    const name = quoteIdentifier(payload.name, conn.engine)
    let sql
    if (payload.action === 'create') sql = `ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${quoteIdentifier(payload.column, conn.engine)}) REFERENCES ${quoteIdentifier(payload.referencedTable, conn.engine)} (${quoteIdentifier(payload.referencedColumn, conn.engine)})`
    else if (payload.action === 'drop') sql = `ALTER TABLE ${table} DROP ${conn.engine === 'mariadb' ? 'FOREIGN KEY' : 'CONSTRAINT'} ${name}`
    else throw new Error('Unsupported relationship action.')
    return this.query(project, sql, { confirm: true })
  }

  async importCsv(project, table, file) {
    const parsed = parseCsv(await fs.readFile(file, 'utf8'))
    if (!parsed.columns.length) throw new Error('The selected CSV file has no header row.')
    const schema = await this.structure(project, table)
    const allowed = new Set(schema.columns.map(column => column.name))
    if (parsed.columns.some(column => !allowed.has(column))) throw new Error('CSV columns must match columns in the selected table.')
    for (const row of parsed.rows) await this.saveRow(project, { table, mode: 'add', values: Object.fromEntries(parsed.columns.map((column, index) => [column, row[index] ?? null])) })
    return { imported: parsed.rows.length, table }
  }

  async exportCsv(project, table, file) {
    const conn = await this.connectionFor(project)
    const sql = `SELECT * FROM ${quoteIdentifier(table, conn.engine)}`
    const result = conn.engine === 'sqlite' ? await this.sqliteQuery(conn.file, sql) : conn.engine === 'postgres' ? await this.psqlQuery(conn, sql) : await this.mysqlQuery(conn, sql)
    const contents = [result.columns, ...result.rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n'
    await fs.writeFile(file, contents, { mode: 0o600 })
    return { exported: result.rows.length, table, destination: file }
  }

  async importSql(project, file) {
    const sql = await fs.readFile(file, 'utf8')
    if (!sql.trim()) throw new Error('The selected SQL file is empty.')
    const conn = await this.connectionFor(project)
    if (conn.engine === 'sqlite') {
      try {
        const { DatabaseSync } = require('node:sqlite')
        const db = new DatabaseSync(conn.file, { readOnly: false })
        try { db.exec(sql) } finally { db.close() }
      } catch (error) { throw new Error(error.message) }
    } else if (conn.engine === 'postgres') await this.psqlQuery(conn, sql)
    else await this.mysqlQuery(conn, sql)
    return { imported: true, file }
  }

  async query(project, sql, { confirm = false, limit = MAX_ROWS } = {}) {
    if (typeof sql !== 'string' || !sql.trim()) throw new Error('Enter a SQL statement to run.')
    if (DESTRUCTIVE_PATTERN.test(sql) && !confirm) return { requiresConfirmation: true, sql }
    const conn = await this.connectionFor(project)
    const start = Date.now()
    const result = conn.engine === 'sqlite' ? await this.sqliteQuery(conn.file, sql)
      : conn.engine === 'postgres' ? await this.psqlQuery(conn, sql)
      : await this.mysqlQuery(conn, sql)
    const truncated = result.rows.length > limit
    return { ...result, rows: result.rows.slice(0, limit), truncated, tookMs: Date.now() - start }
  }

  async sqliteQuery(file, sql) {
    try {
      const { DatabaseSync } = require('node:sqlite')
      const db = new DatabaseSync(file, { readOnly: false })
      try {
        const isSelectLike = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(sql)
        const stmt = db.prepare(sql)
        if (isSelectLike) {
          const records = stmt.all()
          const columns = records.length ? Object.keys(records[0]) : (stmt.columns?.() || []).map(c => c.name)
          return { columns, rows: records.map(record => columns.map(column => serializable(record[column]))) }
        }
        const info = stmt.run()
        return { columns: ['changes', 'lastInsertRowid'], rows: [[info.changes, String(info.lastInsertRowid)]] }
      } finally { db.close() }
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') return this.sqliteQueryViaCli(file, sql)
      throw new Error(error.message.replace(/^.*node:sqlite[^:]*:\s*/i, ''))
    }
  }

  async sqliteQueryViaCli(file, sql) {
    const output = await execCapture('/usr/bin/sqlite3', ['-header', '-csv', file, sql])
    return parseCsv(output)
  }

  async psqlQuery(conn, sql) {
    const args = ['-h', conn.connection.host, '-p', String(conn.connection.port), '-U', conn.connection.username, '-d', conn.connection.database, '--csv', '-v', 'ON_ERROR_STOP=1', '-c', sql]
    const output = await execCapture(conn.binaries.psql, args, { env: { ...process.env, PGPASSWORD: conn.password } })
    return parseCsv(output)
  }

  async mysqlQuery(conn, sql) {
    const args = ['--protocol=TCP', '-h', conn.connection.host, '-P', String(conn.connection.port), '-u', conn.connection.username, '--batch', '--default-character-set=utf8mb4', conn.connection.database, '-e', sql]
    const output = await execCapture(conn.binaries.client, args, { env: { ...process.env, MYSQL_PWD: conn.password } })
    return parseMysqlBatch(output)
  }
}

module.exports = { DatabaseAdmin, parseCsv, parseMysqlBatch, DESTRUCTIVE_PATTERN }
