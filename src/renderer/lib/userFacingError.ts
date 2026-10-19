/** Keep Electron transport wrappers and schema internals out of setup messages. */
export function userFacingError(reason: unknown): string {
  const message = String(reason instanceof Error ? reason.message : reason)
    .replace(/^(?:Error: )?Error invoking remote method '[^']+': (?:Error: )?/, '')
    .replace(/^Error: /, '')
  try {
    const issues: unknown = JSON.parse(message)
    if (Array.isArray(issues) && issues.length && issues.every(issue => typeof issue?.message === 'string')) {
      return [...new Set(issues.map(issue => issue.message))].join(' ')
    }
  } catch { /* Most errors are already plain text. */ }
  return message
}
