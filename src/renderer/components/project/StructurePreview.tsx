import type { PageStructureItem } from '@shared/types/pageStructure'

function elementStyle(tagName: string): string {
  const tag = tagName.toLowerCase()
  if (/^(?:h1|h2|h3|h4|h5|h6)$/.test(tag)) return 'h-2.5 w-2/3 rounded-[2px] bg-slate-700/55'
  if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') return 'h-4 w-20 rounded-[3px] border border-blue-400/35 bg-blue-400/18'
  if (tag === 'img' || tag === 'picture' || tag === 'video' || tag === 'canvas') return 'h-12 w-full rounded-[3px] border border-slate-300 bg-slate-200/70'
  if (tag === 'nav' || tag === 'header') return 'min-h-5 w-full border-b border-slate-300 bg-slate-100'
  if (tag === 'footer') return 'min-h-4 w-full border-t border-slate-300 bg-slate-100/80'
  if (tag === 'p' || tag === 'span' || tag === 'label' || tag === 'a') return 'h-1.5 w-3/4 rounded-[1px] bg-slate-500/35'
  return 'min-h-3 w-full rounded-[2px] border border-slate-300/70 bg-white/55'
}

function PreviewElement({ item, path, depth, compact, onSelect }: { item: PageStructureItem; path: string; depth: number; compact: boolean; onSelect?: (item: PageStructureItem, path: string) => void }) {
  if (depth > (compact ? 3 : 7)) return null
  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      title={item.textPreview ? `${item.tagName}: ${item.textPreview}` : item.tagName}
      onClick={(event) => { event.stopPropagation(); onSelect?.(item, path) }}
      className={`block text-left transition hover:outline hover:outline-1 hover:outline-blue-400/70 ${elementStyle(item.tagName)} ${item.isKnownComponent ? 'ring-1 ring-blue-400/20' : ''}`}
    >
      {item.children.length > 0 && (
        <span className={`flex w-full flex-col ${compact ? 'gap-0.5 p-0.5' : 'gap-1 p-1.5'}`}>
          {item.children.slice(0, compact ? 5 : 12).map((child, index) => (
            <PreviewElement key={`${path}.${index}`} item={child} path={`${path}.${index}`} depth={depth + 1} compact={compact} onSelect={onSelect} />
          ))}
        </span>
      )}
    </div>
  )
}

export function StructurePreview({ structure, compact = false, onSelect }: { structure: PageStructureItem[]; compact?: boolean; onSelect?: (item: PageStructureItem, path: string) => void }) {
  if (structure.length === 0) return <div className="flex h-full items-center justify-center px-4 text-center text-[10px] text-text-3">No visual structure detected</div>
  return (
    <div className={`flex h-full w-full flex-col overflow-hidden bg-[#f7f8fa] ${compact ? 'gap-1 p-2' : 'gap-2 p-4'}`}>
      <div className="mb-0.5 flex gap-1 opacity-50"><span className="h-1.5 w-1.5 rounded-full bg-red-400" /><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /><span className="h-1.5 w-1.5 rounded-full bg-green-400" /></div>
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${compact ? 'gap-0.5' : 'gap-1.5'}`}>
        {structure.slice(0, compact ? 8 : 20).map((item, index) => <PreviewElement key={index} item={item} path={`${index}`} depth={0} compact={compact} onSelect={onSelect} />)}
      </div>
    </div>
  )
}
