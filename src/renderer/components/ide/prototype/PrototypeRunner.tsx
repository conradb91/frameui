import { createPortal } from 'react-dom';
import { ModalShell } from '../../ui/Modal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RotateCcw, X } from 'lucide-react';
import type { VisualDocument } from '@shared/types/visualDesign';
import type { Interaction } from '@shared/types/prototype';
import { initialState, executeInteraction } from '@core/prototype/runtime';
import { migrate } from '@core/prototype/model';
import { Screen } from './Screen';
export function PrototypeRunner({ document: raw, flowId, pageId, onClose, embedded=false, scale=1, initialInteraction,onNavigate }: {
    document: VisualDocument;
    flowId?: string;
    pageId?: string;
    onClose: () => void;
    embedded?:boolean;
    scale?:number;
    initialInteraction?:Interaction;
    onNavigate?:(id:string)=>void;
}) {
    const [document] = useState(() => migrate(raw)), flow = document.prototype?.flows.find(f => f.id === flowId), pages = flow ? document.pages.filter(p => flow.artboardIds.includes(p.id)) : document.pages.filter(p=>!p.flowIntroductionFor);
    const [start, setStart] = useState(pageId ?? flow?.startArtboardId ?? pages[0]?.id ?? ''), [state, setState] = useState(() => initialInteraction?executeInteraction(document,initialState(document,start),initialInteraction):initialState(document,start)), [hotspots, setHotspots] = useState(false), [scenario, setScenario] = useState(''), [step, setStep] = useState(0);
    const host = useRef<HTMLDivElement>(null), touch = useRef<{
        x: number;
        y: number;
    } | null>(null), latest = useRef(state);
    latest.current = state;
    useEffect(()=>{onNavigate?.(state.pageId)},[state.pageId,onNavigate]);
    const current = document.pages.find(p => p.id === state.pageId), test = document.prototype?.scenarios.find(s => s.id === scenario);
    const interactions = useMemo(()=>document.prototype?.interactions ?? [],[document]);
    const run = useCallback((items: Interaction[]) => setState(previous => items.reduce((s, i) => executeInteraction(document, s, i), previous)),[document]);
    const fire = (trigger: Interaction['trigger'], target: EventTarget | null, key?: string, requireElement = false) => { const el = target instanceof Element ? target : null, screen = el?.closest<HTMLElement>('[data-prototype-page]')?.dataset.prototypePage ?? state.pageId; const ids: string[] = []; let node = el; while (node) {
        const id = node.getAttribute('data-structured-id') ?? node.getAttribute('data-object-id');
        if (id)
            ids.push(id);
        node = node.parentElement;
    } if (ids.some(id => state.states[id] === 'disabled' || state.hidden[id]))
        return; const items = interactions.filter(i => (!requireElement || !!i.sourceElementId) && i.sourceArtboardId === screen && i.trigger === trigger && (!i.sourceElementId || ids.includes(i.sourceElementId)) && (trigger !== 'key' || !i.key || i.key === key || i.key==='ESC'&&key==='Escape'||i.key==='ENTER'&&key==='Enter') && (trigger!=='change'||i.inputValue===undefined||String((el as HTMLInputElement)?.value??'')===i.inputValue)); run(items); };
    useEffect(() => { const active = state.overlays.at(-1)?.pageId ?? state.pageId; const timers = interactions.filter(i => i.sourceArtboardId === active && i.trigger === 'timer').map(i => setTimeout(() => run([i]), i.delay ?? 1000)); return () => timers.forEach(clearTimeout); }, [state.pageId, state.overlays,interactions,run]);
    useEffect(() => { if (state.external) {
        void window.frameui.preview.openExternal(state.external);
        setState(s => ({ ...s, external: undefined }));
    } if (state.scroll)
        host.current?.querySelector(`[data-structured-id="${state.scroll}"],[data-object-id="${state.scroll}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [state.external, state.scroll]);
    useEffect(() => { if (test && test.steps[step]?.destinationId === state.pageId)
        setStep(n => n + 1); }, [state.pageId,test,step]);
    useEffect(() => { const root = host.current; if (!root)
        return; root.querySelectorAll<HTMLElement>('[data-structured-id],[data-object-id]').forEach(el => { const id = el.dataset.structuredId ?? el.dataset.objectId!; if (el.dataset.prototypeVisibility === undefined) {
        el.dataset.prototypeVisibility = el.style.visibility;
        el.dataset.prototypePointer = el.style.pointerEvents;
        el.dataset.prototypeOpacity = el.style.opacity;
    } const clickable=interactions.some(i=>i.sourceElementId===id&&['click','submit','doubleclick'].includes(i.trigger));if(clickable&&!el.querySelector('input')&&!el.matches('input')){el.setAttribute('role','button');el.tabIndex=state.states[id]==='disabled'?-1:0;el.setAttribute('aria-disabled',String(state.states[id]==='disabled'))} if (hotspots && interactions.some(i => i.sourceElementId === id))
        el.style.outline = '2px dashed #7465df';
    else if (state.states[id] !== 'selected')
        el.style.removeProperty('outline'); el.style.visibility = state.hidden[id] ? 'hidden' : el.dataset.prototypeVisibility ?? ''; el.style.pointerEvents = el.dataset.prototypePointer ?? ''; el.style.opacity = el.dataset.prototypeOpacity ?? ''; if (state.states[id]) {
        el.style.pointerEvents = state.states[id] === 'disabled' ? 'none' : '';
        el.style.opacity = state.states[id] === 'disabled' ? '.45' : '';
        if (state.states[id] === 'selected')
            el.style.outline = '2px solid #7465df';
    } }); }, [state.pageId,state.overlays,state.hidden,state.states,hotspots,interactions]);
    function render(id: string) { const page = document.pages.find(p => p.id === id); if (!page)
        return null; return <div data-prototype-page={id} className="prototype-device" style={{ width: page.width, maxHeight: embedded?'100%':'calc(100vh - 240px)',zoom:embedded?scale:undefined }}><Screen page={page} document={document} state={state} onInput={(id, value) => { setState(s => ({ ...s, inputs: { ...s.inputs, [id]: value }, variables: { ...s.variables, [document.prototype?.inputBindings?.[id] ?? id]: value } })); }}/></div>; }
    const controls=<> <header><div><strong>{current?.name ?? 'Prototype'}</strong><small>Local simulation · no backend requests</small></div><button onClick={() => run([{ id: 'back', sourceArtboardId: state.pageId, trigger: 'click', action: 'back', transition: 'instant' }])} disabled={!state.history.length}><ArrowLeft size={14}/>Back</button><button onClick={() => setState(s => ({ ...s, pageId: start, history: [], overlays: [] }))}><RotateCcw size={14}/>Restart</button><button onClick={() => { setState(initialState(document, start)); setStep(0); }}>Reset state</button><label>Start<select aria-label="Starting screen" value={start} onChange={e => { setStart(e.target.value); setState(initialState(document, e.target.value)); }}>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button aria-pressed={hotspots} onClick={() => setHotspots(!hotspots)}>Hotspots</button><button aria-label="Exit preview" onClick={onClose}><X size={18}/></button></header>
 {!!document.prototype?.scenarios.length && <div className="prototype-test"><select aria-label="Test scenario" value={scenario} onChange={e => { const s = document.prototype!.scenarios.find(s => s.id === e.target.value); setScenario(e.target.value); setStep(0); if (s)
        setState(initialState(document, s.startArtboardId)); }}><option value="">Choose a test scenario</option>{document.prototype.scenarios.filter(s => !flowId || s.flowId === flowId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{test && <span>{step >= test.steps.length ? 'Scenario complete' : `${step + 1}. ${test.steps[step].instruction} → ${document.pages.find(p => p.id === test.steps[step].destinationId)?.name ?? 'Missing destination'}`}</span>}</div>}
</>;
    const content=<>{embedded?<details className="prototype-player-options"><summary aria-label="Playback controls" title="Back, restart, input state and test scenarios">Playback options</summary>{controls}</details>:controls}
 {state.error && <p role="alert">{state.error}</p>}
 <div className="prototype-stage" ref={host} onClick={e => { fire('click', e.target); fire('submit', e.target, undefined, true); }} onDoubleClick={e => fire('doubleclick', e.target)} onMouseOver={e => { if (!(e.relatedTarget instanceof Node) || !(e.target as Element).contains(e.relatedTarget))
        fire('hover', e.target); }} onChange={e => fire('change', e.target)} onKeyDown={e => { if(e.key==='Escape'&&interactions.some(i=>i.sourceArtboardId===state.pageId&&i.trigger==='key'&&(i.key==='ESC'||i.key==='Escape'))){fire('key',e.target,e.key);return} if (e.key === 'Escape') {
        if(state.overlays.length){setState(s=>({...s,overlays:s.overlays.slice(0,-1)}))}else onClose();
        return;
    } fire('key', e.target, e.key);if((e.key==='Enter'||e.key===' ')&&(e.target as HTMLElement).getAttribute('role')==='button'){e.preventDefault();fire('click',e.target);fire('submit',e.target,undefined,true);return;} if (e.key === 'Enter')
        fire('submit', e.target); }} onPointerDown={e => { touch.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={e => { if (touch.current && Math.hypot(e.clientX - touch.current.x, e.clientY - touch.current.y) > 60)
        fire('swipe', e.target); touch.current = null; }}>
 <div key={state.pageId} className={'prototype-transition-' + state.transition}>{render(state.pageId)}</div>
 {state.overlays.map((overlay, i) => <div key={i} className={'prototype-overlay ' + overlay.kind}>{render(overlay.pageId)}</div>)}
 </div></>;
    if(embedded)return <section className="prototype-player" aria-label="Prototype preview">{content}</section>;
    return createPortal(<ModalShell className="prototype-modal prototype-runner" ariaLabel="Prototype preview" onClose={onClose}>{content}</ModalShell>, window.document.querySelector('.ide') ?? window.document.body);
}
