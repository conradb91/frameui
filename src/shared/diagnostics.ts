const secretKey = /app[_-]?key|password|passwd|secret|token|api[_-]?key|private[_-]?key|cookie|authorization|credential|connection[_-]?strings?|database[_-]?url|^db_url$/i
export function sanitizeDiagnostics(value: unknown): unknown {
  if (typeof value === 'string') return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/((?:[\w.-]*(?:app[_-]?key|password|passwd|secret|token|api[_-]?key|private[_-]?key|cookie|authorization|credential|database[_-]?url|db_url)[\w.-]*)["']?\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\r\n,;]+)/gi, '$1[redacted]')
    .replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, '$1 [redacted]')
    .replace(/:\/\/[^\s/@]+:[^\s@]+@/g, '://[redacted]@')
    .replace(/Stacker/g, 'FrameUI')
  if (Array.isArray(value)) return value.map(sanitizeDiagnostics)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[redacted]' : sanitizeDiagnostics(item)]))
  return value
}
export function preparationFailure(cause: unknown): { title: string; message: string; detail: string } {
  const detail = String(sanitizeDiagnostics(cause instanceof Error ? cause.message : String(cause)))
  if (/Setup was interrupted/i.test(detail)) return { title: 'Setup was interrupted', message: 'Your completed steps are saved. Try again when you’re ready to continue.', detail }
  if (/contains .*data\. Choose a compatible|valid SQLite database file|selected database file is empty/i.test(detail)) return { title: 'Choose a compatible database file', message: detail.replace(/^Error invoking remote method '[^']+': Error: /, ''), detail }
  if (/migration/i.test(detail)) return { title: 'Migrations could not be completed', message: 'Your local workspace is saved. Try again or choose another database source.', detail }
  if (/import|restore failed/i.test(detail)) return { title: 'The database file could not be imported', message: 'Your application has not started. Try again or choose another database file.', detail }
  if (/cache unable to write|writable.*(?:permission|not writable)/i.test(detail)) return { title: 'The application needs a writable cache', message: 'Check the private workspace folder permissions, then try again.', detail }
  if (/doesn.t exist|no such table|no (?:application )?tables|undefined table|base table.*not found/i.test(detail)) return { title: 'Your local database needs its tables', message: 'Choose a database file or migrations to prepare the local database.', detail }
  if (/remote database/i.test(detail)) return { title: 'This project needs local data', message: 'Its saved connection points outside this computer. Choose a database file or migrations for a private local database.', detail }
  if (/database|mysql|postgres|sqlite/i.test(detail)) return { title: 'Local database needs attention', message: 'Try again or choose another database source. Your completed setup steps are saved.', detail }
  if (/php|gzip|checksum|archive|download|network|ENOTFOUND|ECONNRESET/i.test(detail)) return { title: 'A project component could not be prepared', message: 'FrameUI could not finish preparing a required component. Check your connection and retry. Your original project files are safe.', detail }
  return { title: 'The project needs attention', message: 'FrameUI could not finish opening the local application. Your original project files are safe. Retry, or open technical details for help.', detail }
}
