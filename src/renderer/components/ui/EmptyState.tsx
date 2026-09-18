import type { ReactNode } from 'react'

export function EmptyState({ icon, title, description, actions, hint }: {
  icon: ReactNode
  title: string
  description: ReactNode
  actions?: ReactNode
  hint?: ReactNode
}) {
  return <div className="ide-empty-state"><div className="ide-empty-content">
    <span className="ide-empty-icon" aria-hidden="true">{icon}</span>
    <h2>{title}</h2><p>{description}</p>
    {actions && <div className="ide-empty-actions">{actions}</div>}
    {hint && <div className="ide-empty-hint">{hint}</div>}
  </div></div>
}
