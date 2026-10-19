import { RuntimeSettings } from './RuntimeSettings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Circle, Component, FileText, FolderCog, FolderOpen, Loader2, Palette, ShieldCheck } from 'lucide-react'
import type { RecentProject } from '@shared/types/project'
import type { IndexProgressStep, ProjectIndex } from '@shared/types/projectIndex'
import { ModalBody, ModalField, ModalFooter, ModalHeader, ModalNotice, ModalProgress, ModalShell } from '../ui/Modal'

type SetupPhase = 'confirm' | 'preparing' | 'ready' | 'error'
type Destination = 'review' | 'editor'

const progressStage: Record<IndexProgressStep, number> = {
  'validating-cache': 1, detecting: 1, pages: 1, components: 2, tokens: 2,
  dependencies: 2, model: 3, persisting: 3, done: 4,
}

const activityText: Record<IndexProgressStep, string> = {
  'validating-cache': 'Checking the local project index…',
  detecting: 'Detecting the application structure…',
  pages: 'Reading pages and routes…',
  components: 'Scanning reusable components…',
  tokens: 'Reading styles and design tokens…',
  dependencies: 'Connecting project relationships…',
  model: 'Building the local design index…',
  persisting: 'Saving the project index locally…',
  done: 'Project index complete.',
}

export function ProjectSetupModal({ project, index, onCancel, onOpen }: {
  project: RecentProject
  index: ProjectIndex | null
  onCancel: () => void
  onOpen: (name: string, appUrl: string, index: ProjectIndex | null, destination: Destination) => void
}) {
  const [appUrl, setAppUrl] = useState(index?.applications?.[0]?.url ?? '')
  const [phase, setPhase] = useState<SetupPhase>('confirm')
  const [step, setStep] = useState<IndexProgressStep>('detecting')
  const [preparedIndex, setPreparedIndex] = useState<ProjectIndex | null>(index)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const invalidUrl = !!appUrl.trim() && !/^https?:\/\/.+/i.test(appUrl.trim())
  const model = preparedIndex?.projectModel
  const stats = useMemo(() => ({
    pages: (model?.pages ?? []).filter((page) => page.route).length,
    components: model?.components.length ?? 0,
    tokens: (model?.tokens ?? []).filter((token) => token.confidence === 'full').length,
  }), [model])
  const stage = progressStage[step]

  async function prepare() {
    if (invalidUrl || phase === 'preparing') return
    setPhase('preparing')
    setError('')
    setStep('detecting')
    const unsubscribe = window.frameui.project.onIndexProgress((update) => {
      if (mounted.current) setStep(update.step)
    })
    try {
      const next = await window.frameui.project.getIndex()
      if (!next) throw new Error('FrameUI could not read this project.')
      if (!mounted.current) return
      setPreparedIndex(next)
      if (!appUrl.trim() && next.applications?.[0]?.url) setAppUrl(next.applications[0].url)
      setStep('done')
      setPhase('ready')
    } catch (reason) {
      if (!mounted.current) return
      setError(reason instanceof Error ? reason.message : String(reason))
      setPhase('error')
    } finally {
      unsubscribe()
    }
  }

  function finish(destination: Destination) {
    onOpen(project.name, appUrl.trim(), preparedIndex, destination)
  }

  const title = phase === 'confirm'
    ? `Open ${project.name}`
    : phase === 'ready' ? `${project.name} is ready` : `Preparing ${project.name}`
  const description = phase === 'confirm'
    ? 'Bring your existing product into your design workspace.'
    : phase === 'ready'
      ? 'Your repository is indexed. Connect your app to capture its pages.'
      : 'Reading your project and building the design index.'

  return (
    <ModalShell
      as="form"
      size="standard"
      variant={phase === 'ready' ? 'completion' : phase === 'preparing' ? 'progress' : 'setup'}
      onClose={onCancel}
      onSubmit={(event) => {
        event.preventDefault()
        if (phase === 'ready') finish('editor')
        else if (phase !== 'preparing') void prepare()
      }}
      className={`ide-project-setup-dialog is-${phase}`}
    >
      <div className="setup-workflow">
        <div className="setup-workflow-main">
      <ModalHeader
        title={title}
        description={description}
        icon={phase === 'ready' ? <Check size={17} /> : <FolderCog size={17} />}
        onClose={onCancel}
        closeLabel="Close project setup"
      />

      {phase === 'confirm' && <>
        <ModalBody className="ide-project-setup-body">
          <section className="ide-project-confirmation" aria-label="Detected project">
            <FolderOpen size={19} />
            <div>
              <strong>{project.name}</strong>
              <span><i /> Repository selected</span>
            </div>
            <span className="ide-local-only"><ShieldCheck size={12} /> Local only</span>
            <details>
              <summary>Project location</summary>
              <code>{project.path}</code>
            </details>
          </section>

          <ModalField
            label={<span className="ide-project-field-title">App address <small>Optional</small></span>}
            hint="Add the address of your running app. You can connect it later, too."
            error={invalidUrl ? 'Use a full address beginning with http:// or https://.' : undefined}
            className="ide-project-preview-field"
          >
            <input aria-label="App address" placeholder="http://localhost:3000" value={appUrl} onChange={(event) => setAppUrl(event.target.value)} />
          </ModalField>

          {appUrl.trim()&&<RuntimeSettings showUrl={false} url={appUrl} onChange={setAppUrl} />}
          <p className="studio-setup-note"><Component size={14}/> Components, styles and assets are indexed locally.</p>
        </ModalBody>
        <ModalFooter note="Your repository stays unchanged.">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit" disabled={invalidUrl} data-modal-initial-focus>Prepare project</button>
        </ModalFooter>
      </>}

      {(phase === 'preparing' || phase === 'error') && <>
        <ModalBody className="ide-project-progress-body">
          {phase === 'preparing' && <ModalProgress label="Preparing workspace" detail={`${Math.min(stage, 3)} of 4 stages complete`} />}

          <div className="ide-project-progress-steps" role="list" aria-label="Project preparation progress">
            {['Project detected', 'Pages and routes', 'Components and styles', 'Preparing editor'].map((label, index) => {
              const state = index < stage ? 'complete' : index === stage ? (phase === 'error' ? 'failed' : 'active') : 'pending'
              return <div className={`ide-project-progress-step is-${state}`} role="listitem" key={label}>
                {state === 'complete' ? <Check size={14} /> : state === 'active' ? <Loader2 className="frame-modal-spinner" size={14} /> : <Circle size={12} />}
                <span>{label}</span><small>{state === 'complete' ? 'Done' : state === 'active' ? 'In progress' : state === 'failed' ? 'Stopped' : 'Waiting'}</small>
              </div>
            })}
          </div>
          {phase === 'preparing' && <div className="ide-project-activity" role="status"><Loader2 className="frame-modal-spinner" size={15} /><span>{activityText[step]}</span></div>}
          {phase === 'error' && <ModalNotice tone="danger" title="Project preparation stopped">{error}</ModalNotice>}
        </ModalBody>
        <ModalFooter note={phase === 'preparing' ? 'Your source files remain unchanged.' : 'Review the project folder and try again.'}>
          <button type="button" onClick={onCancel}>Cancel</button>
          {phase === 'error' && <button className="primary" type="submit">Try again</button>}
        </ModalFooter>
      </>}

      {phase === 'ready' && <>
        <ModalBody className="ide-project-ready-body">
          <ModalProgress value={100} label="Workspace prepared" detail="4 of 4 stages complete" />
          <div className="ide-project-ready-stats" aria-label="Indexed project summary">
            <div><FileText size={17}/><span>Pages &amp; routes</span><strong>{stats.pages}</strong><Check size={13}/></div>
            <div><Component size={17}/><span>Components</span><strong>{stats.components}</strong><Check size={13}/></div>
            <div><Palette size={17}/><span>Design tokens</span><strong>{stats.tokens}</strong><Check size={13}/></div>
          </div>
          <p><ShieldCheck size={14} /> Next: capture a page or start a design.</p>
        </ModalBody>
        <ModalFooter note={preparedIndex?.scannedFileCount ? `${preparedIndex.scannedFileCount} files checked.` : 'Local design index ready.'}>
          <button type="button" onClick={() => finish('review')}>Review project</button>
          <button className="primary" type="submit" data-modal-initial-focus>Open editor</button>
        </ModalFooter>
      </>}
        </div>
      </div>
    </ModalShell>
  )
}
