export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'Opened just now'
  if (minutes < 60) return `Opened ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Opened ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Opened yesterday'
  if (days < 7) return `Opened ${days} days ago`
  return `Opened ${new Date(iso).toLocaleDateString()}`
}
