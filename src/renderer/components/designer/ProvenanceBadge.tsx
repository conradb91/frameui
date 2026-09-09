import type { Provenance } from '@shared/types/designNode'

/**
 * Spec Phase 15 — "shown throughout the Feature workspace" without covering
 * the canvas in distracting badges: a small, muted pill, not a loud status
 * chip. Four states, four small distinct treatments, nothing saturated.
 * Renders nothing for legacy nodes that predate the `provenance` field
 * (spec: optional only for backward compatibility) so old drafts never grow
 * a mystery badge.
 */
const PROVENANCE_LABEL: Record<Provenance, string> = {
  existing: 'Existing',
  'existing-modified': 'Existing, Modified',
  new: 'New',
  'reference-only': 'Reference Only',
}

// eslint-disable-next-line react-refresh/only-export-components -- tiny label helper intentionally kept alongside the badge component it labels
export function describeProvenance(provenance: Provenance | undefined): string {
  return provenance ? PROVENANCE_LABEL[provenance] : ''
}

const PROVENANCE_CLASS: Record<Provenance, string> = {
  existing: 'border-border-strong bg-white/[0.04] text-text-3',
  'existing-modified': 'border-warning/30 bg-warning/[0.08] text-warning',
  new: 'border-accent-2/30 bg-accent-2/[0.08] text-accent-2',
  'reference-only': 'border-dashed border-text-3/40 bg-transparent text-text-3',
}

export function ProvenanceBadge({ provenance }: { provenance: Provenance | undefined }) {
  if (!provenance) return null
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-[1px] text-[9px] font-medium leading-[1.5] tracking-wide whitespace-nowrap ${PROVENANCE_CLASS[provenance]}`}
    >
      {PROVENANCE_LABEL[provenance]}
    </span>
  )
}
