import { useState } from 'react'
import { FilePlus2, LayoutTemplate, MonitorDown, Sparkles } from 'lucide-react'
import type { VisualPage } from '@shared/types/visualDesign'
import type { LibraryAsset } from './AssetBrowser'
import { PageBrowser } from './PageBrowser'
import { ModalBody, ModalField, ModalFooter, ModalHeader, ModalNotice, ModalSection, ModalShell, ModalSummary } from '../ui/Modal'

function assetName(asset: LibraryAsset): string {
  return asset.kind === 'screen' ? asset.page.name : asset.component.name
}

const START_OPTIONS = [
  { id: 'blank', title: 'Blank canvas', description: "Start with an empty frame and build using your project's components, styles and assets.", icon: Sparkles },
  { id: 'capture', title: 'Capture application', description: 'Open your saved local app, navigate to any state, and turn it into an editable design.', icon: MonitorDown },
  { id: 'existing', title: 'Existing page', description: 'Start from a page FrameUI already discovered in this repository.', icon: LayoutTemplate },
] satisfies { id: 'blank' | 'capture' | 'existing'; title: string; description: string; icon: typeof Sparkles }[]

/**
 * The one place a Design gets created, from wherever it's triggered — the
 * Designs section's "+ New Design" button, a page's "Add" action, or an
 * asset's "Add" action. Project creation (Open Codebase) and Design
 * creation are deliberately separate flows; this modal is only ever the
 * latter.
 */
export function NewDesignModal({
  projectId,
  appUrl,
  pages,
  existingDesigns,
  initialAsset,
  onCancel,
  onCreate,
}: {
  projectId: string
  appUrl?: string
  pages: VisualPage[]
  existingDesigns: { id: string; name: string }[]
  /** Pre-selected when opened from a page's or asset's own "Add" action —
   * skips the inline page picker since the source is already known. */
  initialAsset?: LibraryAsset
  onCancel: () => void
  onCreate: (name: string, asset?: LibraryAsset, fileId?: string, viaCapture?: boolean, autoNamed?: boolean, captureUrl?: string) => void
}) {
  const [startWith, setStartWith] = useState<'blank' | 'existing' | 'capture'>(initialAsset ? 'existing' : 'blank')
  const [selectedPage, setSelectedPage] = useState<VisualPage | null>(initialAsset?.kind === 'screen' ? initialAsset.page : null)
  const [name, setName] = useState(initialAsset ? assetName(initialAsset) : '')
  const [addToExisting, setAddToExisting] = useState(false)
  const [destination, setDestination] = useState('new')
  const trimmedName = name.trim()
  const duplicateName = !addToExisting && !!trimmedName && existingDesigns.some((design) => design.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())
  const missingSource = startWith === 'existing' && !initialAsset && !selectedPage

  function submit() {
    if (missingSource || duplicateName) return
    const finalName = name.trim() || 'Untitled design'
    const asset: LibraryAsset | undefined = initialAsset ?? (selectedPage ? { kind: 'screen', page: selectedPage } : undefined)
    onCreate(finalName, asset, addToExisting && destination !== 'new' ? destination : undefined, startWith === 'capture', !trimmedName, appUrl)
  }

  return (
    <ModalShell
      as="form"
      size={startWith === 'existing' && !initialAsset ? 'wide' : 'large'}
      variant="form"
      onClose={onCancel}
      onSubmit={(e) => { e.preventDefault(); submit() }}
      className="ide-new-design-dialog"
    >
      <ModalHeader
        eyebrow="Design workspace"
        title="Create editable design"
        description="Start with a blank canvas, a discovered page, or the current state of your running application."
        icon={<FilePlus2 size={17} />}
        onClose={onCancel}
        meta={initialAsset ? <><span>Source <strong>{assetName(initialAsset)}</strong></span><span>Project styles <strong>Available</strong></span></> : undefined}
      />
      <ModalBody>
        <ModalSection title="Design">
          <ModalField className="ide-design-name-field" label="Design name" error={duplicateName ? 'A design with this name already exists in the project.' : undefined} hint="Give the design a clear workspace name. You can change it later.">
            <input autoFocus aria-label="Design name" placeholder="Untitled design" value={name} onChange={(e) => setName(e.target.value)} />
          </ModalField>
        </ModalSection>
        <ModalSection title="Starting point" description="Choose the content FrameUI should place on the first canvas.">
          <div className="ide-start-cards" role="radiogroup" aria-label="Start with">
          {START_OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
            <button
              type="button"
              key={opt.id}
              role="radio"
              aria-checked={startWith === opt.id}
              className={`ide-start-card ${startWith === opt.id ? 'selected' : ''}`}
              disabled={!!initialAsset}
              onClick={() => { setStartWith(opt.id); if (opt.id !== 'existing') setSelectedPage(null) }}
            >
              <span className="ide-start-card-icon"><Icon size={18} /></span>
              <span className="ide-start-card-copy"><strong>{opt.title}</strong><small>{opt.description}</small></span>
              <span className="ide-start-card-radio" aria-hidden="true" />
            </button>
          )})}
          </div>
        </ModalSection>
        {startWith === 'existing' && (
          initialAsset ? (
            <ModalSection title="Selected source"><ModalSummary items={[{ label: 'Page or component', value: assetName(initialAsset) }, { label: 'Destination', value: addToExisting && destination !== 'new' ? existingDesigns.find((design) => design.id === destination)?.name ?? 'Existing design' : 'New design' }]} /></ModalSection>
          ) : (
            <ModalSection title="Source page" description="Search the pages FrameUI discovered in this project."><div className="ide-new-design-picker">
              <PageBrowser projectId={projectId} appUrl={appUrl} pages={pages} compact onAdd={setSelectedPage} />
              {selectedPage && <ModalNotice tone="success" title="Page selected">{selectedPage.name}{selectedPage.route ? ` · ${selectedPage.route}` : ''}</ModalNotice>}
            </div></ModalSection>
          )
        )}
        {startWith !== 'capture' && existingDesigns.length > 0 && <ModalSection title="Destination">
          <label className="ide-check">
            <input type="checkbox" checked={addToExisting} onChange={(e) => setAddToExisting(e.target.checked)} />
            Add to an existing design instead of creating a new one
          </label>
        
        {addToExisting && (
          <ModalField label="Existing design">
            <select aria-label="Destination design" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="new">Create a new design</option>
              {existingDesigns.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </ModalField>
        )}</ModalSection>}
        <ModalNotice tone="info">Editing the FrameUI design does not immediately change your application source files.</ModalNotice>
      </ModalBody>
      <ModalFooter note={startWith === 'capture' ? 'The capture workspace will open next.' : 'Project styles and reusable assets remain available.'}>
        <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit" disabled={missingSource || duplicateName}>
            {startWith === 'capture' ? 'Open capture' : 'Create design'}
          </button>
      </ModalFooter>
    </ModalShell>
  )
}
