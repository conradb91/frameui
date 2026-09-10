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
  if (/remote database/i.test(detail)) return { title: 'This project needs local data', message: 'Its saved connection points outside this computer. Choose a local database in Advanced setup before continuing.', detail }
  if (/database|mysql|postgres|sqlite/i.test(detail)) return { title: 'Some screens need local data', message: 'Choose a local database in Advanced setup, then retry. Your original project and data have not been changed.', detail }
  if (/php|gzip|checksum|archive|download|network|ENOTFOUND|ECONNRESET/i.test(detail)) return { title: 'A project component could not be prepared', message: 'FrameUI could not finish preparing a required component. Check your connection and retry. Your original project files are safe.', detail }
  return { title: 'The project needs attention', message: 'FrameUI could not finish opening the local application. Your original project files are safe. Retry, or open technical details for help.', detail }
}
