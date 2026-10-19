import { useState } from 'react';
import type { VisualDocument } from '@shared/types/visualDesign';
import type { Interaction } from '@shared/types/prototype';
import { prototype, migrate, elements } from '@core/prototype/model';
import { actions, triggers } from '@core/prototype/schema';
const triggerLabels:Record<Interaction['trigger'],string>={click:'Click or tap',doubleclick:'Double-click',hover:'Hover',submit:'Submit form',change:'Value changes',key:'Key press',timer:'After a delay',swipe:'Swipe'}
const actionLabels:Record<Interaction['action'],string>={navigate:'Go to screen',back:'Go back','open-overlay':'Open overlay','close-overlay':'Close overlay','open-modal':'Open modal','close-modal':'Close modal','open-drawer':'Open drawer','close-drawer':'Close drawer',show:'Show element',hide:'Hide element',state:'Change element state','set-variable':'Set variable',conditional:'Navigate with a condition',external:'Open a web link',scroll:'Scroll to element',reset:'Reset prototype state',none:'No action'}
export function InteractionInspector({ document, pageId, elementId, onChange }: {
    document: VisualDocument;
    pageId: string;
    elementId?: string;
    onChange: (doc: VisualDocument) => void;
}) {
    const doc = migrate(document), page = doc.pages.find(p => p.id === pageId), items = doc.prototype!.interactions.filter(i => i.sourceArtboardId === pageId && i.sourceElementId === elementId), [error, setError] = useState('');
    function update(id: string, patch: Partial<Interaction>) { const next = migrate(document), item = prototype(next).interactions.find(i => i.id === id)!; Object.assign(item, patch); onChange(next); }
    const destination = (item: Interaction, key: 'destinationId' | 'elseDestinationId') => <select aria-label={key === 'destinationId' ? 'Destination' : 'Otherwise go to'} value={item[key] ?? ''} onChange={e => update(item.id, { [key]: e.target.value || undefined })}><option value="">Choose screen</option>{doc.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>;
    return <div className="prototype-inspector"><h3>{elementId&&page ? elements(page).find(n => n.id === elementId)?.name : 'Screen interactions'}</h3>{elementId && <details><summary>Form value binding</summary><label>Variable name<input aria-label="Input variable name" defaultValue={doc.prototype?.inputBindings?.[elementId] ?? ''} placeholder="e.g. reminderTitle" onBlur={e => { const next = migrate(document), p = prototype(next); p.inputBindings ??= {}; if (e.target.value.trim()) {
        p.inputBindings[elementId] = e.target.value.trim();
        p.variables[e.target.value.trim()] ??= '';
    }
    else
        delete p.inputBindings[elementId]; onChange(next); }}/></label><small>For input elements, the entered value updates this local variable.</small></details>}<p className="ide-muted">{elementId ? 'Define what happens when someone uses this element.' : 'Screen-level actions apply anywhere on this screen.'}</p>{items.map(i => <section className="prototype-interaction" key={i.id}>
 <label>Source<select aria-label="Interaction source element" value={i.sourceElementId ?? ''} onChange={e => update(i.id, { sourceElementId: e.target.value || undefined })}><option value="">Anywhere on this screen</option>{page && elements(page).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label>When<select aria-label="Interaction trigger" value={i.trigger} onChange={e => update(i.id, { trigger: e.target.value as Interaction['trigger'] })}>{triggers.map(t => <option value={t} key={t}>{triggerLabels[t]}</option>)}</select></label>
 <label>Do<select aria-label="Interaction action" value={i.action} onChange={e => update(i.id, { action: e.target.value as Interaction['action'] })}>{actions.map(a => <option value={a} key={a}>{actionLabels[a]}</option>)}</select></label>
 {['navigate', 'conditional', 'open-overlay', 'open-modal', 'open-drawer'].includes(i.action) && <label>Destination{destination(i, 'destinationId')}</label>}
 {i.action === 'conditional' && <><label>Variable<input value={i.condition?.variable ?? ''} onChange={e => { const next = migrate(document), p = prototype(next); p.variables[e.target.value] ??= ''; p.interactions.find(n => n.id === i.id)!.condition = { variable: e.target.value, operator: i.condition?.operator ?? 'equals', value: i.condition?.value ?? '' }; onChange(next); }}/></label><label>Condition<select value={i.condition?.operator ?? 'equals'} onChange={e => update(i.id, { condition: { variable: i.condition?.variable ?? '', operator: e.target.value as 'equals', value: i.condition?.value ?? '' } })}>{['equals', 'not-equals', 'truthy'].map(x => <option key={x}>{x}</option>)}</select></label><label>Compare with<input value={String(i.condition?.value ?? '')} onChange={e => update(i.id, { condition: { variable: i.condition?.variable ?? '', operator: i.condition?.operator ?? 'equals', value: e.target.value } })}/></label><label>Otherwise{destination(i, 'elseDestinationId')}</label></>}
 {['show', 'hide', 'state', 'scroll'].includes(i.action) && <label>Element<select value={i.targetElementId ?? ''} onChange={e => update(i.id, { targetElementId: e.target.value })}><option value="">Choose element</option>{page && elements(page).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>}
 {i.action === 'set-variable' && <label>Variable<input value={i.variable ?? ''} onChange={e => { const next = migrate(document); next.prototype!.variables[e.target.value] = ''; Object.assign(next.prototype!.interactions.find(n => n.id === i.id)!, { variable: e.target.value }); onChange(next); }}/></label>}
 {['set-variable', 'state'].includes(i.action) && <label>{i.action === 'state' ? 'State (selected / disabled / default)' : 'Value'}<input value={String(i.value ?? '')} onChange={e => update(i.id, { value: e.target.value })}/></label>}
 {i.action === 'external' && <label>URL<input type="url" defaultValue={i.url ?? ''} onBlur={e => { if (/^https?:\/\//.test(e.target.value)) {
            update(i.id, { url: e.target.value });
            setError('');
        }
        else
            setError('Use an http or https URL.'); }}/></label>}
 {i.trigger === 'key' && <label>Key<input value={i.key ?? 'Enter'} onChange={e => update(i.id, { key: e.target.value })}/></label>}
 {i.trigger === 'timer' && <label>Delay (ms)<input type="number" min={100} max={600000} value={i.delay ?? 1000} onChange={e => update(i.id, { delay: Math.max(100, Math.min(600000, Number(e.target.value))) })}/></label>}
 <label>Transition<select value={i.transition} onChange={e => update(i.id, { transition: e.target.value as Interaction['transition'] })}>{['instant', 'fade', 'slide'].map(t => <option value={t} key={t}>{t[0].toUpperCase()+t.slice(1)}</option>)}</select></label>
 <button onClick={() => { const next = migrate(document); next.prototype!.interactions = next.prototype!.interactions.filter(n => n.id !== i.id); onChange(next); }}>Remove interaction</button></section>)}
 <button onClick={() => { const next = migrate(document); prototype(next).interactions.push({ id: crypto.randomUUID(), sourceArtboardId: pageId, sourceElementId: elementId, trigger: 'click', action: 'none', transition: 'instant' }); onChange(next); }}>＋ Add interaction</button>{error && <p role="alert">{error}</p>}</div>;
}
