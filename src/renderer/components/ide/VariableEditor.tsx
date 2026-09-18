import { useState } from 'react'
import { Variable } from 'lucide-react'
import type { DesignVariable } from '@shared/types/visualDesign'
import { ModalBody, ModalField, ModalFooter, ModalHeader, ModalNotice, ModalSection, ModalShell } from '../ui/Modal'
export function VariableEditor({
  variable,
  collections,
  existing,
  onSave,
  onClose,
}: {
  variable: DesignVariable
  collections: string[]
  existing: boolean
  onSave: (v: DesignVariable) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState({ ...variable })
  const [submitted, setSubmitted] = useState(false)
  const nameError = submitted && !draft.name.trim() ? 'Enter a variable name.' : ''
  const collectionError = submitted && !draft.collection.trim() ? 'Choose or enter a collection.' : ''
  const valueError = submitted && draft.type === 'Number' && (!draft.value.trim() || !Number.isFinite(Number(draft.value)))
    ? 'Enter a valid number.'
    : submitted && draft.type === 'Colour' && !CSS.supports('color', draft.value)
      ? 'Enter a valid colour, such as #246BFE.'
      : ''
  function submit() {
    setSubmitted(true)
    if (!draft.name.trim() || !draft.collection.trim()) return
    if (draft.type === 'Number' && (!draft.value.trim() || !Number.isFinite(Number(draft.value)))) return
    if (draft.type === 'Colour' && !CSS.supports('color', draft.value)) return
    onSave({
      ...draft,
      name: draft.name.trim(),
      collection: draft.collection.trim(),
    })
  }
  return (
    <ModalShell
      as="form"
      size="standard"
      variant="form"
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <ModalHeader
        eyebrow="Design system"
        title={existing ? `Edit “${variable.name}”` : 'Create variable'}
        description="Save a reusable value for colours, spacing, text, or visibility."
        icon={<Variable size={17} />}
        onClose={onClose}
      />
      <ModalBody>
        <ModalSection title="Variable details">
          <ModalField label="Name" error={nameError}>
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setSubmitted(false) }}
          />
          </ModalField>
          <ModalField label="Collection" error={collectionError} hint="Collections keep related variables together in the inspector.">
          <input
            list="variable-collections"
            value={draft.collection}
            onChange={(e) => { setDraft({ ...draft, collection: e.target.value }); setSubmitted(false) }}
          />
          </ModalField>
        <datalist id="variable-collections">
          {collections.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        </ModalSection>
        <ModalSection title="Value">
          <div className="ide-modal-field-grid">
          <ModalField label="Type">
          <select
            value={draft.type}
            onChange={(e) => {
              const type = e.target.value as DesignVariable['type']
              setDraft({
                ...draft,
                type,
                value:
                  type === 'Boolean'
                    ? 'false'
                    : type === 'Number'
                      ? '0'
                      : type === 'Colour'
                        ? '#246BFE'
                      : draft.value,
              })
              setSubmitted(false)
            }}
          >
            {['Colour', 'Number', 'String', 'Boolean'].map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          </ModalField>
          <ModalField label="Value" error={valueError}>
          {draft.type === 'Boolean' ? (
            <select
              value={draft.value}
              onChange={(e) => { setDraft({ ...draft, value: e.target.value }); setSubmitted(false) }}
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          ) : (
            <input
              aria-label="Variable value"
              type={draft.type === 'Number' ? 'number' : 'text'}
              step="any"
              value={draft.value}
              onChange={(e) => { setDraft({ ...draft, value: e.target.value }); setSubmitted(false) }}
            />
          )}
          </ModalField>
          </div>
        {draft.type === 'Colour' && (
          <ModalField label="Colour preview" hint="Use the picker or enter a CSS colour value above.">
            <input
              aria-label="Variable colour picker"
              type="color"
              value={
                /^#[\da-f]{6}$/i.test(draft.value) ? draft.value : '#246bfe'
              }
              onChange={(e) => { setDraft({ ...draft, value: e.target.value }); setSubmitted(false) }}
            />
          </ModalField>
        )}
        </ModalSection>
        <ModalNotice tone="info">Variables are stored in this FrameUI design. They do not overwrite project tokens until you explicitly export or apply changes.</ModalNotice>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose}>Cancel</button>
        <button className="primary" type="submit">{existing ? 'Save changes' : 'Save variable'}</button>
      </ModalFooter>
    </ModalShell>
  )
}
