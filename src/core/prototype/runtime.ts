import type { VisualDocument } from '../../shared/types/visualDesign';
import type { Interaction } from '../../shared/types/prototype';
export interface RuntimeState {
    pageId: string;
    history: string[];
    variables: Record<string, string | number | boolean>;
    inputs: Record<string, string | boolean>;
    hidden: Record<string, boolean>;
    states: Record<string, string>;
    overlays: {
        pageId: string;
        kind: string;
    }[];
    transition: string;
    error: string;
    external?: string;
    scroll?: string;
}
export function initialState(doc: VisualDocument, pageId: string): RuntimeState { return { pageId, history: [], variables: { ...doc.prototype?.variables }, inputs: {}, hidden: {}, states: {}, overlays: [], transition: 'instant', error: '' }; }
export function executeInteraction(doc: VisualDocument, previous: RuntimeState, i: Interaction): RuntimeState {
    const s = structuredClone(previous);
    s.error = '';
    delete s.external;
    delete s.scroll;
    s.transition = i.transition;
    const go = (id?: string, overlay = false) => { if (!doc.pages.some(p => p.id === id)) {
        s.error = 'The destination screen is missing. Edit this interaction before continuing.';
        return;
    } if (overlay)
        s.overlays.push({ pageId: id!, kind: i.action });
    else {
        s.history.push(s.pageId);
        s.pageId = id!;
        s.overlays = [];
    } };
    switch (i.action) {
        case 'navigate':
            go(i.destinationId);
            break;
        case 'conditional': {
            const c = i.condition;
            if (!c) {
                s.error = 'This interaction needs a condition.';
                break;
            }
            const value = s.variables[c.variable], match = c.operator === 'truthy' ? !!value : c.operator === 'equals' ? String(value) === String(c.value) : String(value) !== String(c.value);
            go(match ? i.destinationId : i.elseDestinationId);
            break;
        }
        case 'back':
            s.pageId = s.history.pop() ?? s.pageId;
            s.overlays = [];
            break;
        case 'open-overlay':
        case 'open-modal':
        case 'open-drawer':
            go(i.destinationId, true);
            break;
        case 'close-overlay':
        case 'close-modal':
        case 'close-drawer':
            s.overlays.pop();
            break;
        case 'set-variable':
            if (i.variable)
                s.variables[i.variable] = i.value ?? '';
            break;
        case 'show':
        case 'hide':
            if (i.targetElementId)
                s.hidden[i.targetElementId] = i.action === 'hide';
            break;
        case 'state':
            if (i.targetElementId)
                s.states[i.targetElementId] = String(i.value ?? 'selected');
            break;
        case 'reset': return initialState(doc, s.pageId);
        case 'external':
            if (i.url && /^https?:\/\//.test(i.url))
                s.external = i.url;
            break;
        case 'scroll':
            s.scroll = i.targetElementId;
            break;
    }
    return s;
}
