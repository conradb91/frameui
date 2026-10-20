import {arrangeImportedScreens} from './importLayout'
import type { VisualDocument, VisualPage } from '../../shared/types/visualDesign';
import type { PrototypeData, PrototypeFlow, PrototypeTarget } from '../../shared/types/prototype';
export const emptyPrototype = (): PrototypeData => ({ version: 1, flows: [], interactions: [], variables: {}, scenarios: [], imports: [] });
export function prototype(doc: VisualDocument) { return doc.prototype ?? (doc.prototype = emptyPrototype()); }
export function elements(page: VisualPage) { const result: {
    id: string;
    name: string;
}[] = []; const walk = (nodes: {
    id: string;
    name: string;
    children: any[];
}[]) => { for (const n of nodes) {
    result.push(n);
    walk(n.children);
} }; walk(page.structured?.children ?? page.objects); return result; }
export function migrate(doc: VisualDocument): VisualDocument {
    const next = structuredClone(doc), p = prototype(next);
    for (const page of next.pages) {
        const walk = (nodes: typeof page.objects) => { for (const n of nodes) {
            if (n.interaction) {
                const old = n.interaction;
                if (!p.interactions.some(i => i.id === 'legacy_' + n.id))
                    p.interactions.push({ id: 'legacy_' + n.id, sourceArtboardId: page.id, sourceElementId: n.id, trigger: old.trigger === 'Hover' ? 'hover' : 'click', action: 'navigate', destinationId: old.targetPageId, transition: old.transition === 'Slide' ? 'slide' : old.transition === 'Dissolve' ? 'fade' : 'instant' });
                delete n.interaction;
            }
            walk(n.children);
        } };
        walk(page.objects);
    }
    return next;
}
export function createFlow(doc: VisualDocument, name: string, artboardIds: string[] = []): PrototypeFlow { const now = new Date().toISOString(), flow: PrototypeFlow = { id: crypto.randomUUID(), name, description: '', artboardIds: [...new Set(artboardIds)], startArtboardId: artboardIds[0], positions: Object.fromEntries(artboardIds.map((id, i) => [id, { x: i * 310, y: 0 }])), createdAt: now, updatedAt: now }; prototype(doc).flows.push(flow); return flow; }
export function removeMembership(_doc: VisualDocument, flow: PrototypeFlow, id: string) { flow.artboardIds = flow.artboardIds.filter(x => x !== id); delete flow.positions[id]; if (flow.startArtboardId === id)
    flow.startArtboardId = flow.artboardIds[0]; flow.updatedAt = new Date().toISOString(); }
export function connections(doc: VisualDocument, flow?: PrototypeFlow) { return (doc.prototype?.interactions ?? []).filter(i => (!flow || flow.artboardIds.includes(i.sourceArtboardId)) && ['navigate', 'conditional', 'open-overlay', 'open-modal', 'open-drawer'].includes(i.action)); }
export function validatePrototype(doc: VisualDocument): {
    errors: string[];
    warnings: string[];
} {
    const errors: string[] = [], warnings: string[] = [], pages = new Map(doc.pages.map(p => [p.id, p])), p = doc.prototype ?? emptyPrototype();
    const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length)
        errors.push(`Duplicate ${label} identifiers.`); };
    unique(doc.pages.map(p => p.id), 'artboard');
    unique(doc.pages.flatMap(page => elements(page).map(n => n.id)), 'element');
    unique(p.flows.map(f => f.id), 'flow');
    unique(p.interactions.map(i => i.id), 'interaction');
    unique(p.scenarios.map(s => s.id), 'scenario');
    for (const page of doc.pages) {
        unique(elements(page).map(n => n.id), `${page.name} element`);
        const check = (nodes: typeof page.objects) => { for (const n of nodes) {
            if (n.componentId && !doc.components.some(c => c.id === n.componentId) && !doc.sourceComponents?.some(c => c.id === n.componentId))
                errors.push(`${page.name}: component ${n.name} is missing.`);
            if (n.kind === 'Image' && !n.src)
                errors.push(`${page.name}: image ${n.name} has no local asset.`);
            check(n.children);
        } };
        check(page.objects);
    }
    for (const f of p.flows) {
        unique(f.artboardIds, `${f.name} member`);
        if (f.artboardIds.length && !f.artboardIds.includes(f.startArtboardId ?? ''))
            errors.push(`${f.name}: choose a valid starting screen.`);
        for (const id of f.artboardIds)
            if (!pages.has(id))
                errors.push(`${f.name}: missing screen ${id}.`);
        const visited = new Set<string>(), queue = [f.startArtboardId];
        while (queue.length) {
            const id = queue.shift();
            if (!id || visited.has(id))
                continue;
            visited.add(id);
            for (const i of connections(doc, f).filter(i => i.sourceArtboardId === id))
                queue.push(i.destinationId, i.elseDestinationId);
        }
        for (const id of f.artboardIds)
            if (!visited.has(id))
                warnings.push(`${f.name}: ${pages.get(id)?.name ?? id} is disconnected from the entry screen.`);
    }
    for (const i of p.interactions) {
        const page = pages.get(i.sourceArtboardId), prefix = i.label ?? page?.name ?? i.id;
        if (!page)
            errors.push(`${prefix}: source screen is missing.`);
        if (page && i.sourceElementId && !elements(page).some(n => n.id === i.sourceElementId))
            errors.push(`${prefix}: source element is missing.`);
        if (['navigate', 'conditional', 'open-overlay', 'open-modal', 'open-drawer'].includes(i.action) && !pages.has(i.destinationId ?? ''))
            errors.push(`${prefix}: destination is missing.`);
        if (i.action === 'conditional' && (!i.condition || !pages.has(i.elseDestinationId ?? '')))
            errors.push(`${prefix}: condition or alternate destination is missing.`);
        if (i.action === 'set-variable' && (!i.variable || !(i.variable in p.variables)))
            errors.push(`${prefix}: define the variable first.`);
        if (i.condition && !(i.condition.variable in p.variables))
            errors.push(`${prefix}: condition variable is missing.`);
        if (i.action === 'external' && !i.url)
            errors.push(`${prefix}: URL is missing.`);
        if (['show', 'hide', 'state', 'scroll'].includes(i.action) && !page?.id)
            errors.push(`${prefix}: source screen is missing.`);
        if (['show', 'hide', 'state', 'scroll'].includes(i.action) && !(page && elements(page).some(n => n.id === i.targetElementId)))
            errors.push(`${prefix}: target element is missing.`);
    }
    for (const [id, name] of Object.entries(p.inputBindings ?? {})) {
        if (!doc.pages.some(page => elements(page).some(n => n.id === id)))
            errors.push('An input binding refers to a missing element.');
        if (!(name in p.variables))
            errors.push('An input binding refers to a missing variable.');
    }
    unique((p.states??[]).map(s=>s.id),'state');unique((p.requirements??[]).map(s=>s.id),'requirement');
    for(const state of p.states??[]){if(!pages.has(state.parentArtboardId)||state.artboardId&&!pages.has(state.artboardId))errors.push(state.name+': state screen or parent is missing.');if(state.interactionId&&!p.interactions.some(i=>i.id===state.interactionId))errors.push(state.name+': state trigger is missing.');if(!state.interactionId&&state.kind!=='default')warnings.push(state.name+': no state trigger has been specified.')}
    for(const item of p.requirements??[]){const page=pages.get(item.artboardId),ids=new Set(page?elements(page).map(n=>n.id):[]);if(!page||item.elementIds.some(id=>!ids.has(id))||item.interactionIds.some(id=>!p.interactions.some(i=>i.id===id&&i.sourceArtboardId===item.artboardId)))errors.push(item.label+': requirement evidence refers to a missing screen, element or interaction.');if(item.status==='unresolved')warnings.push(item.label+': unresolved. '+item.notes);else if((item.kind==='control'||item.kind==='content')&&!item.elementIds.length)errors.push(item.label+': add native element evidence before marking this implemented.');else if(item.kind==='interaction'&&!item.interactionIds.some(id=>p.interactions.some(i=>i.id===id&&i.action!=='none')))errors.push(item.label+': add a working interaction before marking this implemented.')}
    for (const s of p.scenarios) {
        if (!p.flows.some(f => f.id === s.flowId) || !pages.has(s.startArtboardId) || s.steps.some(step => !pages.has(step.destinationId)))
            errors.push(`${s.name}: scenario has a missing flow or screen.`);
    }
    return { errors, warnings };
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function changes(base: VisualDocument, proposal: VisualDocument) { return [...new Set([...base.pages, ...proposal.pages].map(p => p.id))].map(id => { const before = base.pages.find(p => p.id === id), after = proposal.pages.find(p => p.id === id); return { id, name: after?.name ?? before!.name, status: !before ? 'New' : !after ? 'Proposed Removal' : equal(before, after) ? 'Unchanged' : 'Modified' }; }); }
function mergeEntries<T extends {
    id: string;
}>(current: T[], base: T[], proposal: T[], label: string): T[] { const out = structuredClone(current); for (const id of new Set([...base, ...proposal].map(x => x.id))) {
    const b = base.find(x => x.id === id), n = proposal.find(x => x.id === id);
    if (equal(b, n))
        continue;
    const at = out.findIndex(x => x.id === id), c = out[at];
    if (!equal(b, c))
        throw new Error(`${label} changed after this draft started. Start a new proposal or cancel; your newer edits are preserved.`);
    if (!n) {
        if (at >= 0)
            out.splice(at, 1);
    }
    else if (at >= 0)
        out[at] = structuredClone(n);
    else
        out.push(structuredClone(n));
} return out; }
/** Import scope accumulates authorised changes; a later narrow revision must not invalidate earlier work. */
export function extendPrototypeTarget(base:VisualDocument,previous:PrototypeTarget,next:PrototypeTarget,current?:VisualDocument):PrototypeTarget{
 if(previous.kind==='project'||next.kind==='project')return {kind:'project'}
 const ids=(target:PrototypeTarget)=>target.kind==='artboards'?target.ids??[]:target.kind==='artboard'&&target.id?[target.id]:target.kind==='flow'?[...new Set([...(base.prototype?.flows.find(f=>f.id===target.id)?.artboardIds??[]),...(current?.prototype?.flows.find(f=>f.id===target.id)?.artboardIds??[])])]:[]
 const combined=[...new Set([...ids(previous),...ids(next)])]
 return combined.length?{kind:'artboards',ids:combined}:next
}
export function mergeDraft(currentRaw: VisualDocument, baseRaw: VisualDocument, proposalRaw: VisualDocument, target?: PrototypeTarget): VisualDocument {
    if (currentRaw.id !== baseRaw.id || proposalRaw.id !== baseRaw.id || currentRaw.projectId !== baseRaw.projectId || proposalRaw.projectId !== baseRaw.projectId)
        throw new Error('Draft belongs to another document.');
    const current = migrate(currentRaw), base = migrate(baseRaw), proposal = migrate(proposalRaw);
    if (target && target.kind !== 'project') {
        const allowed = target.kind === 'artboards' ? target.ids??[] : target.kind === 'artboard' ? [target.id] : target.kind === 'flow' ? base.prototype!.flows.find(f => f.id === target.id)?.artboardIds ?? [] : [];
        for (const c of changes(base, proposal))
            if (c.status !== 'New' && c.status !== 'Unchanged' && !allowed.includes(c.id))
                throw new Error(`The proposal changes ${c.name} outside its target. Request a correction before importing.`);
        for (const i of proposal.prototype!.interactions) {
            const before = base.prototype!.interactions.find(old => old.id === i.id);
            if (!equal(before, i) && base.pages.some(p => p.id === i.sourceArtboardId) && !allowed.includes(i.sourceArtboardId))
                throw new Error('The proposal changes an interaction outside its target. Request a correction before importing.');
        }
        for (const i of base.prototype!.interactions)
            if (!proposal.prototype!.interactions.some(n => n.id === i.id) && !allowed.includes(i.sourceArtboardId))
                throw new Error('The proposal removes an interaction outside its target.');
    }
    const next = structuredClone(current);
    next.pages = mergeEntries(current.pages, base.pages, proposal.pages, 'An artboard');
    next.components = mergeEntries(current.components, base.components, proposal.components, 'A component');
    next.variables = mergeEntries(current.variables, base.variables, proposal.variables, 'A design token');
    for (const key of ['flows', 'interactions', 'scenarios','states','requirements'] as const)
        (next.prototype![key] as {
            id: string;
        }[]) = mergeEntries((current.prototype![key]??[]) as {
            id: string;
        }[], (base.prototype![key]??[]) as {
            id: string;
        }[], (proposal.prototype![key]??[]) as {
            id: string;
        }[], key);
    const vars = (v: PrototypeData) => Object.entries(v.variables).map(([id, value]) => ({ id, value }));
    next.prototype!.variables = Object.fromEntries(mergeEntries(vars(current.prototype!), vars(base.prototype!), vars(proposal.prototype!), 'A prototype variable').map(v => [v.id, v.value]));
    const bindings = (p: PrototypeData) => Object.entries(p.inputBindings ?? {}).map(([id, value]) => ({ id, value }));
    next.prototype!.inputBindings = Object.fromEntries(mergeEntries(bindings(current.prototype!), bindings(base.prototype!), bindings(proposal.prototype!), 'An input binding').map(v => [v.id, v.value]));
    arrangeImportedScreens(current,next);
    const validation = validatePrototype(next);
    if (validation.errors.length)
        throw new Error(validation.errors.join('\n'));
    next.updatedAt = new Date().toISOString();
    return next;
}
