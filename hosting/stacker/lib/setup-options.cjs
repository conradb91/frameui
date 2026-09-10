function databaseChoiceFromOptions(options = {}) {
  if (options.databaseMode === 'existing') return 'existing'
  if (options.databaseMode === 'create') {
    return ['sqlite', 'postgres', 'mariadb'].includes(options.databaseEngine) ? options.databaseEngine : null
  }
  return ['skip', 'existing', 'sqlite', 'postgres', 'mariadb'].includes(options.database) ? options.database : null
}

function inferredManagedDatabaseChoice(project = {}) {
  if (project.database?.engine || project.databaseTarget?.classification === 'remote') return null
  const engines = [...new Set((project.databaseHints || []).map(hint => hint === 'PostgreSQL' ? 'postgres' : hint === 'MariaDB/MySQL' ? 'mariadb' : hint === 'SQLite' ? 'sqlite' : null).filter(Boolean))]
  return engines.length === 1 ? engines[0] : null
}

module.exports = { databaseChoiceFromOptions, inferredManagedDatabaseChoice }
