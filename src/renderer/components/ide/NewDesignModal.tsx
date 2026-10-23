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
  { id: 'blank', title: 'Blank canvas', description: 'Build an idea with your project’s components.', icon: Sparkles },
  { id: 'capture', title: 'Capture application', description: 'Capture a page or state from your running app.', icon: MonitorDown },
  { id: 'existing', title: 'Existing page', description: 'Reuse a page already captured or discovered.', icon: LayoutTemplate },
] satisfies { id: 'blank' | 'capture' | 'existing'; title: string; description: string; icon: typeof Sparkles }[]

/**
 * The one place a Design gets created, from wherever it's triggered — the
 * Designs section's "+ New Design" button, a page's "Add" action, or an
 * asset's "Add" action. Project creation and Design
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
  const resolvedDestination = startWith !== 'capture' && addToExisting && destination !== 'new' ? destination : undefined
  const duplicateName = !resolvedDestination && existingDesigns.some((design) => design.name.toLocaleLowerCase() === (trimmedName || 'Untitled design').toLocaleLowerCase())
  const missingSource = startWith === 'existing' && !initialAsset && !selectedPage

  function submit() {
    if (missingSource || duplicateName) return
    const finalName = name.trim() || 'Untitled design'
    const asset: LibraryAsset | undefined = initialAsset ?? (selectedPage ? { kind: 'screen', page: selectedPage } : undefined)
    onCreate(finalName, asset, resolvedDestination, startWith === 'capture', !trimmedName, appUrl)
  }

  return (
    <ModalShell
      as="form"
      size={startWith === 'existing' && !initialAsset ? 'large' : 'standard'}
      variant="form"
      onClose={onCancel}
      onSubmit={(e) => { e.preventDefault(); submit() }}
      className="ide-new-design-dialog"
    >
      <ModalHeader
        title="Create editable design"
        description={initialAsset?`Create an independent, editable design from ${assetName(initialAsset)}.`:'Choose a starting point. Your project’s components and styles stay available.'}
        icon={<FilePlus2 size={17} />}
        onClose={onCancel}
      />
      <ModalBody>
        <ModalSection title="Design">
          <ModalField className="ide-design-name-field" label="Design name" error={duplicateName ? 'A design with this name already exists in the project.' : undefined} hint="You can rename it later.">
            <input autoFocus aria-label="Design name" placeholder="Untitled design" value={name} onChange={(e) => setName(e.target.value)} />
          </ModalField>
        </ModalSection>
        {!initialAsset&&<ModalSection title="Starting point">
          <div className="ide-start-cards" role="radiogroup" aria-label="Start with" onKeyDown={e=>{if(initialAsset||!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const current=START_OPTIONS.findIndex(o=>o.id===startWith),next=e.key==='Home'?0:e.key==='End'?2:(current+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)+3)%3;setStartWith(START_OPTIONS[next].id);setAddToExisting(false);setDestination('new');if(START_OPTIONS[next].id!=='existing')setSelectedPage(null);e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()}}>
          {START_OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
            <button
              type="button"
              key={opt.id}
              role="radio"
              tabIndex={startWith===opt.id?0:-1}
              aria-checked={startWith === opt.id}
              className={`ide-start-card ${startWith === opt.id ? 'selected' : ''}`}
              disabled={!!initialAsset}
              onClick={() => { setStartWith(opt.id); setAddToExisting(false); setDestination('new'); if (opt.id !== 'existing') setSelectedPage(null) }}
            >
              <span className="ide-start-card-icon"><Icon size={18} /></span>
              <span className="ide-start-card-copy"><strong>{opt.title}</strong><small>{opt.description}</small></span>
              <span className="ide-start-card-radio" aria-hidden="true" />
            </button>
          )})}
          </div>
        </ModalSection>}
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
            Add to an existing design
          </label>
        
        {addToExisting && (
          <ModalField label="Existing design">
            <select aria-label="Destination design" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="new">Create a new design</option>
              {existingDesigns.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </ModalField>
        )}</ModalSection>}
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
