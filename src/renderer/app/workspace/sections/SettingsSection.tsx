import { useProjectStore } from '../../../state/projectStore'
import { useUiStore } from '../../../state/uiStore'
import { LivePreviewPanel } from '../../../components/project/LivePreviewPanel'
import type { SupportLevel } from '@shared/types/projectIndex'

const SUPPORT_LABEL: Record<SupportLevel, string> = {
  supported: 'Supported',
  partial: 'Partial Support',
  'inspect-only': 'Inspect Only',
}
const SUPPORT_COLOR: Record<SupportLevel, string> = {
  supported: 'text-success border-success/30 bg-success/10',
  partial: 'text-warning border-warning/30 bg-warning/10',
  'inspect-only': 'text-text-2 border-border bg-panel-2',
}

/**
 * Project metadata lives here now, not as the main landing screen — a
 * designer opened FrameUI to work on the product, not to learn their stack
 * uses JavaScript (see the shell's design note).
 */
export function SettingsSection() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const indexing = useProjectStore((s) => s.indexing)
  const reindex = useProjectStore((s) => s.reindex)
  const setView = useUiStore((s) => s.setView)

  if (!activeProject) return null

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7">
      <div className="mb-1 text-[18px] font-semibold text-text">Project Settings</div>
      <div className="mb-7 font-mono text-[10.5px] text-text-3">{activeProject.path}</div>

      <div className="max-w-3xl">
        <div className="mb-6 flex items-center justify-between border-y border-border py-3">
          <div>
            <div className="text-[11.5px] font-medium text-text">Code access · Read only</div>
            <div className="mt-1 text-[10.5px] text-text-3">Application files remain unchanged until a staged change is explicitly applied.</div>
          </div>
          {activeIndex && (
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${SUPPORT_COLOR[activeIndex.supportLevel]}`}>
              {SUPPORT_LABEL[activeIndex.supportLevel]}
            </span>
          )}
        </div>

        {activeIndex && (
          <section className="mb-6"><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">Development environment</div><div className="grid grid-cols-2 border border-border bg-panel"><MetaRow label="Framework" value={frameworkLabel(activeIndex.framework, activeIndex.phpFramework)} /><MetaRow label="Language" value={activeIndex.language === 'php' ? 'PHP' : capitalize(activeIndex.language)} /><MetaRow label="Bundler" value={activeIndex.framework === 'php' ? 'Not applicable' : activeIndex.bundler === 'unknown' ? 'Unrecognized' : capitalize(activeIndex.bundler)} /><MetaRow label="Route style" value={routeStyleLabel(activeIndex.routerStyle)} /></div></section>
        )}

        <div className="mb-6 flex items-center justify-between border-y border-border py-3">
          <div>
            <div className="text-[11.5px] font-medium text-text">Project analysis</div>
            <div className="mt-1 text-[10.5px] text-text-3">
              {activeIndex ? `Last scanned ${activeIndex.scannedFileCount.toLocaleString()} files in ${(activeIndex.scanDurationMs / 1000).toFixed(1)}s.` : '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void reindex()}
            disabled={indexing}
            className="shrink-0 rounded-[5px] border border-border bg-panel-2 px-3 py-1.5 text-[10.5px] font-semibold text-text-2 hover:text-text disabled:opacity-60"
          >
            {indexing ? 'Rebuilding…' : 'Rebuild Project Index'}
          </button>
        </div>

        <div className="mb-6">
          <LivePreviewPanel devCommand={activeIndex?.devCommand ?? null} />
        </div>

        <div className="flex items-center justify-between border-y border-border py-3">
          <div>
            <div className="text-[11.5px] font-medium text-text">Live application capture</div>
            <div className="mt-1 max-w-md text-[10.5px] text-text-3">
              Opens your running application inside FrameUI so you can sign in normally — FrameUI never sees or stores your
              password. The session stays local to this project.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setView('capture-session')}
            className="shrink-0 rounded-[5px] bg-blue-600 px-3 py-1.5 text-[10.5px] font-semibold text-white"
          >
            Start Capture Session
          </button>
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b border-r border-border px-3 py-2.5"><span className="text-[10px] text-text-3">{label}</span><span className="text-[10.5px] font-medium text-text-2">{value}</span></div> }

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function frameworkLabel(framework: string, phpFramework: string | null): string {
  if (framework === 'react') return 'React'
  if (framework === 'vue') return 'Vue'
  if (framework === 'svelte') return 'Svelte / SvelteKit'
  if (framework === 'astro') return 'Astro'
  if (framework === 'node') return 'Node.js templates'
  if (framework === 'static') return 'Static HTML'
  if (framework === 'php') return phpFramework === 'codeigniter' ? 'PHP (CodeIgniter)' : phpFramework === 'laravel' ? 'PHP (Laravel)' : 'PHP'
  return 'Unrecognized'
}

function routeStyleLabel(style: string): string {
  switch (style) {
    case 'codeigniter':
      return 'CodeIgniter Routes'
    case 'next-app':
      return 'Next App Router'
    case 'next-pages':
      return 'Next Pages Router'
    case 'conventional':
      return 'Conventional'
    case 'filesystem':
      return 'File-system routes'
    case 'templates':
      return 'Template views'
    case 'static':
      return 'Static pages'
    default:
      return 'Unrecognized'
  }
}
