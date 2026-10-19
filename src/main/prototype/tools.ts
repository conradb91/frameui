import { z } from 'zod';
import { flowSchema, interactionSchema, scenarioSchema, stateSchema,requirementSchema } from '@core/prototype/schema';
import { prototype, validatePrototype } from '@core/prototype/model';
import type { VisualDocument } from '@shared/types/visualDesign';
const descriptions = { configure_state:'Track a meaningful UI state or overlay. data JSON: {id?,parentArtboardId,artboardId?,interactionId?,name,kind:default|loading|error|empty|success|validation|modal|drawer|overlay|other,notes?}. Keep native artboards and working trigger interactions; this is metadata, not automatic behaviour.',configure_requirement:'Record an evidence-backed screen completeness item. data JSON: {id?,artboardId,label,kind:content|control|interaction|state,elementIds:[],interactionIds:[],status:implemented|simulated|unresolved,notes?}. Implemented content/controls need native element IDs; implemented interactions need working interaction IDs. Describe unresolved requirements honestly.', bind_prototype_input: 'Bind a form input to a named local variable. data JSON: {elementId,variable}. This creates an empty initial variable if needed.', inspect_prototype: 'Inspect all flows, interactions, variables, scenarios and validation.', configure_flow: 'Create or replace a flow. data is JSON: {id,name,description,startArtboardId,artboardIds,positions,createdAt,updatedAt}. IDs and timestamps may be omitted for a new flow. Reuse existing ID for revisions.', configure_interaction: 'Create or replace an interaction. data is JSON: {id?,sourceArtboardId,sourceElementId?,trigger:click|doubleclick|hover|submit|change|key|timer|swipe,action:navigate|back|open-overlay|close-overlay|open-modal|close-modal|open-drawer|close-drawer|show|hide|state|set-variable|conditional|external|scroll|reset|none,destinationId?,elseDestinationId?,targetElementId?,variable?,value?,condition?:{variable,operator:equals|not-equals|truthy,value?},transition:instant|fade|slide,key?,delay?,url?,label?}.', set_prototype_variables: 'Merge initial local simulated variables. data is JSON object of name to string, number or boolean.', configure_scenario: 'Create or update a manual test scenario. data is JSON: {id?,flowId,name,startArtboardId,steps:[{instruction,destinationId}]}', remove_prototype_item: 'Remove a proposed item. data is JSON: {kind:flow|interaction|scenario|artboard,id}. Removing an artboard does not repair references; fix them before approval.' };
export const prototypeTools = Object.entries(descriptions).map(([name, description]) => ({ name, description, input_schema: { type: 'object', properties: { data: { type: 'string' } }, additionalProperties: false } }));
export function executePrototypeTool(doc: VisualDocument, name: string, raw: unknown) { const input = z.object({ data: z.string().max(100000).optional() }).strict().parse(raw), p = prototype(doc); if (name === 'inspect_prototype')
    return { ...p, validation: validatePrototype(doc) }; const data = JSON.parse(input.data ?? '{}'), now = new Date().toISOString(); if (name === 'bind_prototype_input') {
    const b = z.object({ elementId: z.string().max(100), variable: z.string().min(1).max(100) }).parse(data);
    p.inputBindings ??= {};
    p.inputBindings[b.elementId] = b.variable;
    p.variables[b.variable] ??= '';
    return b;
} if(name==='configure_state'||name==='configure_requirement'){const item=(name==='configure_state'?stateSchema:requirementSchema).parse({id:crypto.randomUUID(),...data}),key=name==='configure_state'?'states':'requirements';const list=p[key]??=[];const at=list.findIndex(i=>i.id===item.id);if(at<0)(list as unknown[]).push(item);else (list as unknown[])[at]=item;return item}
 if (name === 'configure_flow') {
    const item = flowSchema.parse({ id: crypto.randomUUID(), description: '', positions: {}, createdAt: now, updatedAt: now, ...data });
    const at = p.flows.findIndex(x => x.id === item.id);
    if (at < 0)
        p.flows.push(item);
    else
        p.flows[at] = item;
    return item;
} if (name === 'configure_interaction') {
    const item = interactionSchema.parse({ id: crypto.randomUUID(), ...data });
    const at = p.interactions.findIndex(x => x.id === item.id);
    if (at < 0)
        p.interactions.push(item);
    else
        p.interactions[at] = item;
    return item;
} if (name === 'configure_scenario') {
    const item = scenarioSchema.parse({ id: crypto.randomUUID(), ...data });
    const at = p.scenarios.findIndex(x => x.id === item.id);
    if (at < 0)
        p.scenarios.push(item);
    else
        p.scenarios[at] = item;
    return item;
} if (name === 'set_prototype_variables') {
    Object.assign(p.variables, z.record(z.union([z.string().max(2000), z.number().finite(), z.boolean()])).parse(data));
    return p.variables;
} const item = z.object({ kind: z.enum(['flow', 'interaction', 'scenario', 'artboard']), id: z.string() }).parse(data); if (item.kind === 'artboard')
    doc.pages = doc.pages.filter(x => x.id !== item.id);
else if (item.kind === 'flow')
    p.flows = p.flows.filter(x => x.id !== item.id);
else if (item.kind === 'interaction')
    p.interactions = p.interactions.filter(x => x.id !== item.id);
else
    p.scenarios = p.scenarios.filter(x => x.id !== item.id); return { removed: item.id }; }
