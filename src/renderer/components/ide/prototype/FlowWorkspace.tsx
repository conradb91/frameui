import { useMemo, useState, useEffect } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, useNodesState, useReactFlow, ReactFlowProvider, type NodeProps, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { VisualDocument, VisualPage } from '@shared/types/visualDesign';
import { createFlow, migrate, prototype, removeMembership, connections, validatePrototype } from '@core/prototype/model';
import { createArtboard, duplicateArtboard } from '@core/ai/canvas';
import { Thumbnail } from './Screen';
import { InteractionInspector } from './InteractionInspector';
import { PrototypeRunner } from './LazyWorkspaces';
const nodeTypes = { screen: ScreenNode };
type ScreenNodeData = {
    page: VisualPage;
    document: VisualDocument;
    entry: boolean;
    shared: number;
    onOpen: () => void;
};
function ScreenNode({ data, selected }: NodeProps<Node<ScreenNodeData>>) { return <div className={'flow-screen-node ' + (selected ? 'selected' : '')}><Handle type="target" position={Position.Left}/><div className="flow-node-title"><strong>{data.page.name}</strong>{data.entry && <small>Start</small>}</div><Thumbnail page={data.page} document={data.document}/><footer><span>{data.page.width} × {data.page.height}{data.shared > 1 ? ` · ${data.shared} flows` : ''}</span><button className="nodrag" onClick={data.onOpen}>Open ↗</button></footer><Handle type="source" position={Position.Right}/></div>; }
export function FlowWorkspace(props: {
    document: VisualDocument;
    flowId?: string;
    onSelect: (id: string) => void;
    onChange: (doc: VisualDocument) => void;
    onOpen: (id: string) => void;
    onClose: () => void;
    readOnly?: boolean;
}) { return <ReactFlowProvider><FlowEditor {...props}/></ReactFlowProvider>; }
function FlowEditor({ document: raw, flowId, onSelect, onChange, onOpen, onClose, readOnly = false }: Parameters<typeof FlowWorkspace>[0]) {
    const document = useMemo(() => raw.prototype?raw:migrate(raw), [raw]), data = prototype(document), flow = data.flows.find(f => f.id === flowId) ?? data.flows[0], graph = useReactFlow(), [selected, setSelected] = useState(''), [edge, setEdge] = useState(''), [play, setPlay] = useState(false), [adding, setAdding] = useState(false), [name, setName] = useState(''), [newFlow, setNewFlow] = useState(false), [scenarioOpen, setScenarioOpen] = useState(false), [scenarioName, setScenarioName] = useState(''), [scenarioText, setScenarioText] = useState(''), [error, setError] = useState('');
    useEffect(() => { if (flow && flow.id !== flowId)
        onSelect(flow.id); }, [flow, flowId,onSelect]);
    const initial = useMemo(() => flow?.artboardIds.flatMap((id, index) => { const page = document.pages.find(p => p.id === id); return page ? [{ id, type: 'screen', position: flow.positions[id] ?? { x: (index % 4) * 320, y: Math.floor(index / 4) * 300 }, data: { page, document, entry: flow.startArtboardId === id, shared: data.flows.filter(f => f.artboardIds.includes(id)).length, onOpen: () => onOpen(id) } }] : []; }) ?? [], [document,flow,data.flows,onOpen]);
    const [nodes, setNodes, onNodesChange] = useNodesState(initial);
    useEffect(() => setNodes(initial), [initial, setNodes]);
    useEffect(()=>{const frame=requestAnimationFrame(()=>void graph.fitView({padding:.18,maxZoom:1}));return()=>cancelAnimationFrame(frame)},[flow?.id,graph]);
    const edges = connections(document, flow).flatMap(i => [i.destinationId, i.elseDestinationId].filter((id): id is string => !!id && !!flow?.artboardIds.includes(id)).map((id, index) => ({ id: i.id + (index ? '_else' : ''), source: i.sourceArtboardId, target: id, label: i.label ?? `${i.trigger}${i.action === 'conditional' ? (index ? ' · otherwise' : ' · if') : ''}`, markerEnd: { type: MarkerType.ArrowClosed }, selected: edge === i.id })));
    const selectedInteraction = data.interactions.find(i => i.id === edge), validation = useMemo(()=>validatePrototype(document),[document]);
    function edit(fn: (doc: VisualDocument) => void) { const next = {...document,pages:[...document.pages],prototype:structuredClone(data)}; fn(next); onChange(next); }
    return <div className="flow-workspace" aria-label="Flow builder"><header><strong>Flows</strong><nav>{data.flows.map(f => <button aria-pressed={flow?.id === f.id} onClick={() => { onSelect(f.id); setSelected(''); setEdge(''); }} key={f.id}>{f.name}</button>)}</nav>{!readOnly && <button aria-label="New flow" onClick={() => setNewFlow(!newFlow)}>＋ New flow</button>}<button onClick={onClose}>Back to design</button></header>
 {newFlow && <form className="flow-inline-form" onSubmit={e => { e.preventDefault(); if (!name.trim())
        return; edit(d => onSelect(createFlow(d, name.trim()).id)); setName(''); setNewFlow(false); }}><input aria-label="Flow name" placeholder="e.g. User onboarding" value={name} onChange={e => setName(e.target.value)} autoFocus/><button type="submit">Create flow</button></form>}
 {flow ? <><div className="flow-toolbar">{readOnly ? <strong>{flow.name}</strong> : <input aria-label="Rename flow" value={flow.name} onChange={e => { if (e.target.value.trim())
            edit(d => { prototype(d).flows.find(f => f.id === flow.id)!.name = e.target.value; }); }}/>}<button onClick={() => void graph.fitView({ padding: .2 })}>Fit flow</button><button disabled={!selected} onClick={() => void graph.fitView({ nodes: [{ id: selected }], padding: .4, maxZoom: 1 })}>Fit selection</button><button aria-label="Play prototype" onClick={() => setPlay(true)} disabled={!flow.artboardIds.length}>▷ Play prototype</button>{!readOnly && <><button aria-label="Add screen" onClick={() => setAdding(!adding)}>＋ Add screen</button><button onClick={() => edit(d => { const copy = structuredClone(flow); copy.id = crypto.randomUUID(); copy.name += ' copy'; prototype(d).flows.push(copy); onSelect(copy.id); })}>Duplicate flow</button><button onClick={() => { edit(d => { prototype(d).flows = prototype(d).flows.filter(f => f.id !== flow.id); prototype(d).scenarios = prototype(d).scenarios.filter(s => s.flowId !== flow.id); }); onSelect(''); }}>Delete flow</button></>}</div>
 {adding && !readOnly && <div className="flow-add-screens">{document.pages.filter(p => !flow.artboardIds.includes(p.id)).map(p => <button key={p.id} onClick={() => edit(d => { prototype(d).flows.find(f => f.id === flow.id)!.artboardIds.push(p.id); const f = prototype(d).flows.find(f => f.id === flow.id)!; f.startArtboardId ??= p.id; })}>＋ {p.name}</button>)}<button onClick={() => edit(d => { const p = createArtboard(d, 'New screen', 390, 844), f = prototype(d).flows.find(f => f.id === flow.id)!; f.artboardIds.push(p.id); f.startArtboardId ??= p.id; })}>Create blank screen</button></div>}
 <div className="flow-content"><div className="flow-graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeClick={(_e, node) => { setSelected(node.id); setEdge(''); }} onEdgeClick={(_e, e) => { setEdge(e.id.replace(/_else$/, '')); setSelected(''); }} onNodeDragStop={(_e, node) => { if (!readOnly)
            edit(d => { prototype(d).flows.find(f => f.id === flow.id)!.positions[node.id] = node.position; }); }} onConnect={c => { if (!readOnly && c.source && c.target)
            edit(d => prototype(d).interactions.push({ id: crypto.randomUUID(), sourceArtboardId: c.source!, destinationId: c.target!, trigger: 'click', action: 'navigate', transition: 'instant' })); }} nodesDraggable={!readOnly} nodesConnectable={!readOnly} fitView minZoom={.08} maxZoom={2} deleteKeyCode={null}><Background /><Controls /></ReactFlow></div>
 <aside><h3>{selected ? document.pages.find(p => p.id === selected)?.name : 'Flow overview'}</h3>{selected && !readOnly && <><button onClick={() => edit(d => { prototype(d).flows.find(f => f.id === flow.id)!.startArtboardId = selected; })}>Set as starting screen</button><button onClick={() => edit(d => { const p = duplicateArtboard(d.pages.find(p => p.id === selected)!, 'Screen variation'); d.pages.push(p); prototype(d).flows.find(f => f.id === flow.id)!.artboardIds.push(p.id); })}>Duplicate artboard</button><button onClick={() => edit(d => removeMembership(d, prototype(d).flows.find(f => f.id === flow.id)!, selected))}>Remove from flow</button><button onClick={() => edit(d => { const f = prototype(d).flows.find(f => f.id === flow.id)!; f.artboardIds = [selected, ...f.artboardIds.filter(id => id !== selected)]; })}>Move first in order</button>{data.flows.filter(f => f.artboardIds.includes(selected)).length > 1 && <p>This screen is shared. Changes also appear in {data.flows.filter(f => f.id !== flow.id && f.artboardIds.includes(selected)).map(f => f.name).join(', ')}. Duplicate it for an independent variation.</p>}</>}
 {(selected || selectedInteraction) && !readOnly && <InteractionInspector document={document} pageId={selectedInteraction?.sourceArtboardId ?? selected} elementId={selectedInteraction?.sourceElementId} onChange={onChange}/>}
 {readOnly && selectedInteraction && <p>{selectedInteraction.trigger} → {selectedInteraction.action} → {document.pages.find(p => p.id === selectedInteraction.destinationId)?.name}</p>}
 <small>{flow.artboardIds.length} screens · {edges.length} connections</small>{validation.errors.map((v, i) => <p role="alert" key={i}>{v}</p>)}{!!validation.warnings.length&&<details><summary>{validation.warnings.length} navigation notices</summary>{validation.warnings.map((v,i)=><p className="ide-muted" key={i}>{v}</p>)}</details>}
 {!readOnly && <><button onClick={() => setScenarioOpen(!scenarioOpen)}>＋ Test scenario</button>{scenarioOpen && <form onSubmit={e => { e.preventDefault(); try {
            const steps = scenarioText.split('\n').filter(Boolean).map(line => { const [instruction, destination] = line.split(/→|->/); const page = document.pages.find(p => p.name.trim() === destination?.trim()); if (!page)
                throw new Error('Use an existing screen name after →.'); return { instruction: instruction.trim(), destinationId: page.id }; });
            if (!steps.length || !scenarioName.trim() || !flow.startArtboardId)
                throw new Error('Add a name, entry screen and at least one step.');
            edit(d => prototype(d).scenarios.push({ id: crypto.randomUUID(), flowId: flow.id, name: scenarioName, startArtboardId: flow.startArtboardId!, steps }));
            setScenarioOpen(false);
            setError('');
        }
        catch (e) {
            setError(String(e));
        } }}><label>Name<input value={scenarioName} onChange={e => setScenarioName(e.target.value)}/></label><label>One step per line<textarea placeholder="Select Sign In → Dashboard" value={scenarioText} onChange={e => setScenarioText(e.target.value)}/></label><button>Save scenario</button>{error && <p role="alert">{error}</p>}</form>}</>}
 </aside></div></> : <div className="prototype-empty"><h2>Map out your experience</h2><p>Create a flow, add your screens, then connect them.</p><button onClick={() => setNewFlow(true)}>Create a flow</button></div>}
 {play && <PrototypeRunner document={document} flowId={flow?.id} onClose={() => setPlay(false)}/>}</div>;
}
