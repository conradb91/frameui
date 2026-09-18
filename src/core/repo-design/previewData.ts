/** Deterministic, local-only content. No repository code, clocks or services are executed. */
export function previewValue(field: string, row = 0): string | number | boolean {
  const name = field.replace(/[_-]/g, '').toLowerCase()
  const first = ['Sarah', 'David', 'Nicole', 'Alex', 'Jamie', 'Morgan'][row % 6]
  const last = ['Mitchell', 'Williams', 'Adams', 'Smith', 'Lee', 'Brown'][row % 6]
  if (/password|secret|token|apikey|credential/.test(name)) return ''
  if (name === 'id') return row + 1
  if (/firstname/.test(name)) return first
  if (/lastname|surname/.test(name)) return last
  if (/email/.test(name)) return `${first.toLowerCase()}.${last.toLowerCase()}@example.com`
  if (/name/.test(name)) return `${first} ${last}`
  if (/title/.test(name)) return ['Website Redesign', 'Customer Portal', 'Design Review'][row % 3]
  if (/description|content|message/.test(name)) return 'Review the latest project details and collaborate with your team.'
  if (/role/.test(name)) return ['Administrator', 'Manager', 'Viewer'][row % 3]
  if (/status/.test(name)) return row % 3 === 2 ? 'Pending' : 'Active'
  if (/date|createdat|updatedat/.test(name)) return `2026-09-${String(11 - row % 10).padStart(2, '0')}`
  if (/amount|revenue|price/.test(name)) return 12450 + row * 1250
  if (/count|total/.test(name)) return 24 + row
  if (/progress|percent/.test(name)) return 72 - row * 3
  if (/active|enabled/.test(name)) return true
  if (/image|avatar|photo|url/.test(name)) return ''
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
}
