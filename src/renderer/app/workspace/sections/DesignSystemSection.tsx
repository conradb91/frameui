import { useMemo } from 'react'
import { useProjectStore } from '../../../state/projectStore'
import type { Token, TokenSource } from '@shared/types/model/projectModel'

const SOURCE_LABEL: Record<TokenSource, string> = {
  'tailwind-v3': 'Tailwind CSS (config)',
  'tailwind-v4': 'Tailwind CSS (@theme)',
  'css-custom-properties': 'CSS custom properties',
  none: 'No style tokens detected',
}

/**
 * Turns code tokens into something a designer can actually look at — real
 * colours/spacing/radius/breakpoints from the project, shown as swatches
 * and a scale rather than a bare list of names. No typography section:
 * FrameUI has no font-size/weight/line-height extraction implemented yet —
 * showing one would mean inventing values.
 */
export function DesignSystemSection() {
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const tokens = activeIndex?.projectModel.tokens
  const tokenSource = activeIndex?.projectModel.tokenSource

  const byCategory = useMemo(() => {
    const groups: Record<Token['category'], Token[]> = { color: [], spacing: [], radius: [], breakpoint: [] }
    for (const token of tokens ?? []) groups[token.category].push(token)
    return groups
  }, [tokens])

  if (!tokens || !tokenSource) {
    return <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-3">Reading the project…</div>
  }

  const isEmpty = tokens.length === 0

  return (
    <div className="flex-1 overflow-y-auto px-12 py-9">
      <div className="mb-1 text-[22px] font-bold text-white">Design System</div>
      <div className="mb-8 text-[12.5px] text-text-3">{SOURCE_LABEL[tokenSource]}</div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-[12.5px] text-text-3">
          No Tailwind config or CSS custom properties found — colours, spacing and radius won't be labeled "Project" in the
          designer.
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {byCategory.color.length > 0 && (
            <section>
              <SectionTitle>Colours</SectionTitle>
              <div className="flex flex-wrap gap-4">
                {byCategory.color.map((t) => (
                  <div key={t.id} className="w-24">
                    <div className="h-14 w-full rounded-lg border border-border" style={{ background: t.value || '#1b1b20' }} />
                    <div className="mt-1.5 truncate text-[11.5px] font-medium text-text-2" title={t.name}>
                      {t.name}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[10px] text-text-3">{t.value}</span>
                      <ConfidenceTag confidence={t.confidence} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {byCategory.spacing.length > 0 && (
            <section>
              <SectionTitle>Spacing</SectionTitle>
              <div className="flex flex-wrap items-end gap-3">
                {byCategory.spacing.map((t) => (
                  <div key={t.id} className="flex flex-col items-center gap-1.5">
                    <div className="rounded bg-accent/40" style={{ width: t.value, height: 20, minWidth: 4 }} />
                    <div className="font-mono text-[10.5px] text-text-3">{t.name}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {byCategory.radius.length > 0 && (
            <section>
              <SectionTitle>Radius</SectionTitle>
              <div className="flex flex-wrap gap-4">
                {byCategory.radius.map((t) => (
                  <div key={t.id} className="flex flex-col items-center gap-1.5">
                    <div className="h-14 w-14 border border-border bg-panel-2" style={{ borderRadius: t.value }} />
                    <div className="font-mono text-[10.5px] text-text-3">{t.name}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {byCategory.breakpoint.length > 0 && (
            <section>
              <SectionTitle>Breakpoints</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {byCategory.breakpoint.map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <span className="w-16 font-mono text-text-2">{t.name}</span>
                    <span className="font-mono text-text-3">{t.value}</span>
                    <ConfidenceTag confidence={t.confidence} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3.5 text-[13px] font-semibold text-text">{children}</div>
}

function ConfidenceTag({ confidence }: { confidence: Token['confidence'] }) {
  return confidence === 'full' ? (
    <span className="rounded px-1 py-px text-[8.5px] font-bold tracking-wide text-accent-2">PROJECT</span>
  ) : (
    <span className="rounded px-1 py-px text-[8.5px] font-bold tracking-wide text-warning">DEFAULT</span>
  )
}
