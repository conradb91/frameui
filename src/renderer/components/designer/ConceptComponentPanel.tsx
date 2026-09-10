import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, X, Layers, SlidersHorizontal } from 'lucide-react'
import type {
  ConceptComponent,
  ConceptComponentProperty,
  ConceptComponentPropertyType,
  ConceptComponentVariant,
} from '@shared/types/model/featureModel'
import type { DesignNode } from '@shared/types/designNode'
import { useConceptComponentStore } from '../../state/conceptComponentStore'
import { useDesignStore } from '../../state/designStore'

/** Best-effort usage count in the currently-open design tree only — a full
 * cross-draft scan (every state/page this component might be used in,
 * loaded or not) is deliberately out of scope, but warning about the one
 * tree actually in memory costs nothing and catches the common case: a
 * designer deleting a component while looking at the very page using it. */
function countUsagesInTree(node: DesignNode | null, componentId: string): number {
  if (!node) return 0
  const here = node.kind === 'concept' && node.conceptComponentId === componentId ? 1 : 0
  return here + node.children.reduce((sum, child) => sum + countUsagesInTree(child, componentId), 0)
}

/**
 * Concept Component authoring + library UI (spec Phase 14) — designer
 * invents a component that doesn't exist in the codebase yet (e.g.
 * "PaymentProgress"), gives it variants/properties, then drops instances of
 * it onto the canvas as `ConceptNode`s. Embedded inside the Feature
 * Workspace's Components activity by another agent; this component owns
 * only the library/editor UI and never touches the design tree itself —
 * `onInsert` hands the host a ready-to-insert node.
 */
export function ConceptComponentPanel({
  projectId,
  featureId,
  onInsert,
}: {
  projectId: string
  featureId: string
  onInsert: (node: DesignNode) => void
}) {
  const components = useConceptComponentStore((s) => s.components)
  const loading = useConceptComponentStore((s) => s.loading)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    void useConceptComponentStore.getState().loadForFeature(projectId, featureId)
  }, [projectId, featureId])

  const editing = components.find((c) => c.id === editingId) ?? null

  function handleInsert(component: ConceptComponent) {
    const node: DesignNode = {
      kind: 'concept',
      id: crypto.randomUUID(),
      editability: 'editable',
      provenance: 'new',
      children: [],
      conceptComponentId: component.id,
      variantId: component.variants[0]?.id ?? null,
      propertyValues: Object.fromEntries(component.properties.map((p) => [p.id, p.defaultValue])),
    }
    onInsert(node)
  }

  async function handleDelete(componentId: string) {
    await useConceptComponentStore.getState().remove(projectId, componentId)
    setPendingDeleteId(null)
    if (editingId === componentId) setEditingId(null)
  }

  if (editing) {
    return (
      <>
      <ConceptComponentEditor
        projectId={projectId}
        component={editing}
        onClose={() => setEditingId(null)}
        onDelete={() => setPendingDeleteId(editing.id)}
      />
      {pendingDeleteId && <ConfirmDeleteDialog name={editing.name} usagesInOpenTree={countUsagesInTree(useDesignStore.getState().tree, editing.id)} onCancel={() => setPendingDeleteId(null)} onConfirm={() => void handleDelete(editing.id)} />}
      </>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div>
          <div className="text-[11px] font-semibold tracking-wide text-text-3">Concept Components</div>
          <div className="mt-0.5 text-[11px] text-text-3">Invented for this feature — no source in the codebase yet.</div>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[11px] font-semibold text-text-2 hover:text-text"
          >
            <Plus size={12} /> New
          </button>
        )}
      </div>

      {creating && (
        <CreateConceptComponentForm
          projectId={projectId}
          featureId={featureId}
          onCreated={(component) => {
            setCreating(false)
            setEditingId(component.id)
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && components.length === 0 ? (
          <div className="p-3 text-[11px] text-text-3">Loading…</div>
        ) : components.length === 0 && !creating ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-[11px] leading-relaxed text-text-3">
            No concept components yet. Use "New" to invent one — e.g. a "PaymentProgress" component with Default/Warning/Complete
            variants.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {components.map((component) => (
              <div key={component.id} className="rounded-md border border-border bg-panel-2 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-text">{component.name}</div>
                    {component.description && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-3">{component.description}</div>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-3">
                  <span className="flex items-center gap-1">
                    <Layers size={10} /> {component.variants.length} variant{component.variants.length === 1 ? '' : 's'}
                  </span>
                  <span className="flex items-center gap-1">
                    <SlidersHorizontal size={10} /> {component.properties.length} propert{component.properties.length === 1 ? 'y' : 'ies'}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleInsert(component)}
                    className="flex-1 rounded-md border border-accent-2/30 bg-selected px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-selected"
                  >
                    Insert
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(component.id)}
                    title="Edit"
                    className="flex items-center justify-center rounded-md border border-border px-2 py-1 text-text-2 hover:text-text"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(component.id)}
                    title="Delete"
                    className="flex items-center justify-center rounded-md border border-border px-2 py-1 text-text-2 hover:text-danger"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDeleteId && (
        <ConfirmDeleteDialog
          name={components.find((c) => c.id === pendingDeleteId)?.name ?? ''}
          usagesInOpenTree={countUsagesInTree(useDesignStore.getState().tree, pendingDeleteId)}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => void handleDelete(pendingDeleteId)}
        />
      )}
    </div>
  )
}

function CreateConceptComponentForm({
  projectId,
  featureId,
  onCreated,
  onCancel,
}: {
  projectId: string
  featureId: string
  onCreated: (component: ConceptComponent) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const component = await useConceptComponentStore.getState().create(projectId, featureId, name.trim(), description.trim())
      onCreated(component)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-border bg-panel p-3">
      <label className="mb-2 block">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-text-3">Name</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. PaymentProgress"
          className="w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2"
        />
      </label>
      <label className="mb-2 block">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-text-3">Description</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this component represents"
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-panel px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2"
        />
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!name.trim() || saving}
          onClick={() => void handleCreate()}
          className="flex-1 rounded-md border border-accent-2/30 bg-selected px-2 py-1.5 text-[11px] font-semibold text-accent-2 disabled:opacity-40"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-2 hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ConceptComponentEditor({
  projectId,
  component,
  onClose,
  onDelete,
}: {
  projectId: string
  component: ConceptComponent
  onClose: () => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState<ConceptComponent>(component)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(component)

  // Re-sync if the store's copy changes underneath us (e.g. after a save
  // elsewhere) and we have no unsaved local edits.
  useEffect(() => {
    setDraft(component)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [component.id, component.updatedAt])

  async function handleSave() {
    setSaving(true)
    try {
      await useConceptComponentStore.getState().save(projectId, draft)
    } finally {
      setSaving(false)
    }
  }

  function addVariant() {
    const variant: ConceptComponentVariant = { id: crypto.randomUUID(), name: `Variant ${draft.variants.length + 1}` }
    setDraft({ ...draft, variants: [...draft.variants, variant] })
  }

  function updateVariant(id: string, name: string) {
    setDraft({ ...draft, variants: draft.variants.map((v) => (v.id === id ? { ...v, name } : v)) })
  }

  function removeVariant(id: string) {
    setDraft({ ...draft, variants: draft.variants.filter((v) => v.id !== id) })
  }

  function addProperty() {
    const property: ConceptComponentProperty = {
      id: crypto.randomUUID(),
      name: `property${draft.properties.length + 1}`,
      type: 'text',
      defaultValue: '',
    }
    setDraft({ ...draft, properties: [...draft.properties, property] })
  }

  function updateProperty(id: string, patch: Partial<ConceptComponentProperty>) {
    setDraft({ ...draft, properties: draft.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  }

  function removeProperty(id: string) {
    setDraft({ ...draft, properties: draft.properties.filter((p) => p.id !== id) })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <button type="button" onClick={onClose} className="flex items-center gap-1 text-[11px] font-semibold text-text-2 hover:text-text">
          <X size={13} /> Back
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center justify-center rounded-md border border-border px-2 py-1 text-text-2 hover:text-danger"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
            className="rounded-md border border-accent-2/30 bg-selected px-2.5 py-1 text-[11px] font-semibold text-accent-2 disabled:opacity-40"
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <label className="mb-2 block">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-text-3">Name</div>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2"
          />
        </label>
        <label className="mb-4 block">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-text-3">Description</div>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2"
          />
        </label>

        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-text-3">Variants</div>
            <button type="button" onClick={addVariant} className="flex items-center gap-1 text-[11px] font-semibold text-accent-2">
              <Plus size={11} /> Add
            </button>
          </div>
          {draft.variants.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-text-3">
              No variants — e.g. "Default", "Warning", "Complete".
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {draft.variants.map((variant) => (
                <div key={variant.id} className="flex items-center gap-1.5">
                  <input
                    value={variant.name}
                    onChange={(e) => updateVariant(variant.id, e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[12px] text-text outline-none focus:border-accent-2"
                  />
                  <button
                    type="button"
                    onClick={() => removeVariant(variant.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-3 hover:text-danger"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-text-3">Properties</div>
            <button type="button" onClick={addProperty} className="flex items-center gap-1 text-[11px] font-semibold text-accent-2">
              <Plus size={11} /> Add
            </button>
          </div>
          {draft.properties.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-text-3">No properties yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {draft.properties.map((property) => (
                <PropertyRow key={property.id} property={property} onChange={(patch) => updateProperty(property.id, patch)} onRemove={() => removeProperty(property.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PropertyRow({
  property,
  onChange,
  onRemove,
}: {
  property: ConceptComponentProperty
  onChange: (patch: Partial<ConceptComponentProperty>) => void
  onRemove: () => void
}) {
  const [optionsText, setOptionsText] = useState((property.options ?? []).join(', '))

  function handleTypeChange(type: ConceptComponentPropertyType) {
    const patch: Partial<ConceptComponentProperty> = { type }
    if (type === 'boolean' && !['true', 'false'].includes(property.defaultValue)) patch.defaultValue = 'false'
    if (type === 'number' && Number.isNaN(Number(property.defaultValue))) patch.defaultValue = '0'
    if (type !== 'select') patch.options = undefined
    onChange(patch)
  }

  function handleOptionsChange(text: string) {
    setOptionsText(text)
    const options = text
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
    onChange({ options })
  }

  return (
    <div className="rounded-md border border-border bg-panel-2 p-2">
      <div className="flex items-center gap-1.5">
        <input
          value={property.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Property name"
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2 py-1 text-[12px] text-text outline-none focus:border-accent-2"
        />
        <select
          value={property.type}
          onChange={(e) => handleTypeChange(e.target.value as ConceptComponentPropertyType)}
          className="rounded-md border border-border bg-panel px-1.5 py-1 text-[12px] text-text outline-none focus:border-accent-2"
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="select">Select</option>
        </select>
        <button type="button" onClick={onRemove} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-3 hover:text-danger">
          <X size={12} />
        </button>
      </div>

      <div className="mt-1.5">
        <div className="mb-1 text-[11px] text-text-3">Default value</div>
        {property.type === 'boolean' ? (
          <select
            value={property.defaultValue}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
            className="w-full rounded-md border border-border bg-panel px-2 py-1 text-[12px] text-text outline-none focus:border-accent-2"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : property.type === 'select' ? (
          <select
            value={property.defaultValue}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
            className="w-full rounded-md border border-border bg-panel px-2 py-1 text-[12px] text-text outline-none focus:border-accent-2"
          >
            <option value="">—</option>
            {(property.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={property.type === 'number' ? 'number' : 'text'}
            value={property.defaultValue}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
            className="w-full rounded-md border border-border bg-panel px-2 py-1 text-[12px] text-text outline-none focus:border-accent-2"
          />
        )}
      </div>

      {property.type === 'select' && (
        <div className="mt-1.5">
          <div className="mb-1 text-[11px] text-text-3">Options (comma-separated)</div>
          <input
            value={optionsText}
            onChange={(e) => handleOptionsChange(e.target.value)}
            placeholder="e.g. Small, Medium, Large"
            className="w-full rounded-md border border-border bg-panel px-2 py-1 text-[12px] text-text outline-none focus:border-accent-2"
          />
        </div>
      )}
    </div>
  )
}

function ConfirmDeleteDialog({
  name,
  usagesInOpenTree,
  onCancel,
  onConfirm,
}: {
  name: string
  usagesInOpenTree: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`Delete ${name}`} className="absolute inset-0 z-50 flex items-center justify-center bg-bg/70 p-4">
      <div className="w-full max-w-[280px] rounded-md border border-border bg-panel-2 p-3">
        <div className="text-[12px] font-semibold text-text">Delete "{name}"?</div>
        {usagesInOpenTree > 0 && (
          <div className="mt-1.5 rounded-md border border-warning/30 bg-panel px-2 py-1.5 text-[11px] font-medium text-warning">
            Used {usagesInOpenTree} time{usagesInOpenTree === 1 ? '' : 's'} on the page currently open.
          </div>
        )}
        <div className="mt-1 text-[11px] leading-relaxed text-text-3">
          Any instances already placed on a canvas keep working but will no longer resolve to a saved concept component.
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <button type="button" onClick={onConfirm} className="flex-1 rounded-md border border-danger/30 bg-panel px-2 py-1.5 text-[11px] font-semibold text-danger">
            Delete
          </button>
          <button type="button" onClick={onCancel} className="flex-1 rounded-md border border-border px-2 py-1.5 text-[11px] font-semibold text-text-2 hover:text-text">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
