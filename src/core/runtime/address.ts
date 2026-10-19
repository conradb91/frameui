/** Normalise user-entered app addresses while preserving main-process URL and origin checks. */
export function localAppAddress(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost')
}
export function applicationAddress(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Enter your local application address or HTTPS app address to continue.')
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)&&!/^https?:\/\//i.test(trimmed))throw new Error('Use an HTTP or HTTPS app address.')
  let url: URL
  try {
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:|\/|$)/i.test(trimmed)
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `${local ? 'http' : 'https'}://${trimmed}`)
  } catch { throw new Error('Enter a valid app address, such as http://localhost:3000 or https://app.example.com.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an app address without embedded login details.')
  if (!localAppAddress(url) && url.protocol !== 'https:') throw new Error('Hosted apps require HTTPS.')
  return url.href
}
