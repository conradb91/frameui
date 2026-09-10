import { AppearancePicker } from '../../../components/shell/Appearance'
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
  supported: 'text-success border-success/30 bg-panel',
  partial: 'text-warning border-warning/30 bg-panel',
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
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mb-1 text-[13px] font-semibold text-text">Project Settings</div>
      <div className="mb-3 font-mono text-[12px] text-text-3">{activeProject.path}</div>

      <div className="max-w-3xl"><button className="mb-4 h-8 rounded border border-border px-3 text-sm hover:bg-hover" onClick={() => useUiStore.getState().setSection('environment')}>Local application</button><AppearancePicker/>
        <div className="mb-3 flex items-center justify-between border-y border-border py-3">
          <div>
            <div className="text-[12px] font-medium text-text">Code access · Read only</div>
            <div className="mt-1 text-[12px] text-text-3">Application files remain unchanged until a staged change is explicitly applied.</div>
          </div>
          {activeIndex && (
            <span className={`shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-semibold ${SUPPORT_COLOR[activeIndex.supportLevel]}`}>
              {SUPPORT_LABEL[activeIndex.supportLevel]}
            </span>
          )}
        </div>

        {activeIndex && (
          <section className="mb-3"><div className="mb-2 text-[12px] font-semibold tracking-normal text-text-3">Development environment</div><div className="grid grid-cols-2 border-t border-border"><MetaRow label="Framework" value={frameworkLabel(activeIndex.framework, activeIndex.phpFramework)} /><MetaRow label="Language" value={activeIndex.language === 'php' ? 'PHP' : capitalize(activeIndex.language)} /><MetaRow label="Bundler" value={activeIndex.bundler === 'unknown' ? 'Unrecognized' : capitalize(activeIndex.bundler)} /><MetaRow label="Route style" value={routeStyleLabel(activeIndex.routerStyle)} /></div></section>
        )}

        {!!activeIndex?.technologies?.length && (
          <section className="mb-3">
            <div className="mb-2 text-[12px] font-semibold tracking-normal text-text-3">Detected technologies</div>
            <div className="flex flex-wrap gap-2">
              {activeIndex.technologies.map((technology) => (
                <span key={technology.id} title={technology.evidence.join('\n')} className="rounded border-t border-border px-2.5 py-1 text-[12px] text-text-2">
                  {technology.id}
                </span>
              ))}
            </div>
          </section>
        )}

        {activeIndex?.capabilities && <section className="mb-3"><div className="mb-2 text-[12px] font-semibold tracking-normal text-text-3">Project understanding · {capabilityLabel(activeIndex.capabilityLevel)}</div><div className="border-t border-border"><CapabilityRow label="Source structure" available={activeIndex.capabilities.sourceStructure} /><CapabilityRow label="Runtime preview" available={activeIndex.capabilities.runtimePreview} /><MetaRow label="Component source mapping" value={capitalize(activeIndex.capabilities.componentSourceMapping)} /><MetaRow label="Route mapping" value={capitalize(activeIndex.capabilities.routeMapping)} /><CapabilityRow label="Isolated component previews" available={activeIndex.capabilities.isolatedComponentPreviews} /></div></section>}

        {(activeIndex?.applications?.length ?? 0) > 1 && <section className="mb-3"><div className="mb-2 text-[12px] font-semibold tracking-normal text-text-3">Repository applications</div><div className="border-t border-border">{activeIndex!.applications!.map((application) => <div key={application.id} className="grid grid-cols-[1fr_110px_1fr] border-b border-border px-3 py-2.5 last:border-0"><span className="text-[12px] text-text">{application.name}</span><span className="text-[12px] text-text-3">{application.kind.replace('-', ' ')}</span><span className="truncate text-right font-mono text-[12px] text-text-3">{application.rootPath}</span></div>)}</div></section>}

        <div className="mb-3 flex items-center justify-between border-y border-border py-3">
          <div>
            <div className="text-[12px] font-medium text-text">Project analysis</div>
            <div className="mt-1 text-[12px] text-text-3">
              {activeIndex ? `${activeIndex.lastUpdate?.mode === 'cache-hit' ? 'Restored persistent index for' : 'Last processed'} ${activeIndex.scannedFileCount.toLocaleString()} files in ${(activeIndex.scanDurationMs / 1000).toFixed(2)}s.` : '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void reindex()}
            disabled={indexing}
            className="shrink-0 rounded-[5px] border border-border-2 px-3 py-1.5 text-[12px] font-semibold text-text-2 hover:text-text disabled:opacity-60"
          >
            {indexing ? 'Rebuilding…' : 'Rebuild Project Index'}
          </button>
        </div>
        <div className="-mt-4 mb-3 text-[12px] text-text-3">Recovery action only. Routine external edits update incrementally and do not require a rebuild.</div>

        <div className="mb-3">
          <LivePreviewPanel devCommand={activeIndex?.devCommand ?? null} />
        </div>

        <div className="flex items-center justify-between border-y border-border py-3">
          <div>
            <div className="text-[12px] font-medium text-text">Live application capture</div>
            <div className="mt-1 max-w-md text-[12px] text-text-3">
              Opens your running application inside FrameUI so you can sign in normally — FrameUI never sees or stores your
              password. The session stays local to this project.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setView('capture-session')}
            className="shrink-0 rounded-[5px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-on-accent"
          >
            Start Capture Session
          </button>
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b border-r border-border px-3 py-2.5"><span className="text-[12px] text-text-3">{label}</span><span className="text-[12px] font-medium text-text-2">{value}</span></div> }
function CapabilityRow({ label, available }: { label: string; available: boolean }) { return <div className="flex items-center justify-between border-b border-border px-3 py-2.5 last:border-0"><span className="text-[12px] text-text-3">{label}</span><span className={available ? 'text-[12px] text-success' : 'text-[12px] text-text-3'}>{available ? 'Available' : 'Unavailable'}</span></div> }
function capabilityLabel(value?: string): string { return value === 'full' ? 'Full Source + Runtime' : value === 'partial' ? 'Partial Source + Runtime' : value === 'runtime-only' ? 'Runtime Only' : value === 'source-only' ? 'Source Only' : 'Limited' }

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
  if (framework === 'dotnet') return 'ASP.NET / Blazor'
  return framework === 'unknown' ? 'Unrecognized' : capitalize(framework)
}

function routeStyleLabel(style: string): string {
  switch (style) {
    case 'angular': return 'Angular Router'
    case 'aspnet': return 'ASP.NET routes and views'
    case 'nuxt': return 'Nuxt pages'
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
