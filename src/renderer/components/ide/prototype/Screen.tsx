import { memo, useMemo } from 'react';
import type { VisualPage, VisualDocument, VisualObject } from '@shared/types/visualDesign';
import type { RuntimeState } from '@core/prototype/runtime';
import { StructuredFrameView } from '../StructuredFrameView';
import { VisualSvg, FontDefinitions } from '../VisualSvg';
export const Screen = memo(function Screen({ page, document, state, onInput }: {
    page: VisualPage;
    document: VisualDocument;
    state?: RuntimeState;
    onInput?: (id: string, value: string | boolean) => void;
}) {
    const objects = useMemo(() => { const map = (nodes: VisualObject[]): VisualObject[] => nodes.map(n => ({ ...n, hidden: state?.hidden[n.id] ?? n.hidden, children: map(n.children) })); return state ? map(page.objects) : page.objects; }, [page.objects, state]);
    const controls: {
        node: VisualObject;
        x: number;
        y: number;
    }[] = [];
    const collect = (nodes: VisualObject[], x = 0, y = 0) => { for (const n of nodes) {
        if (n.hidden)
            continue;
        if (['Input', 'Checkbox', 'Radio', 'Toggle'].includes(n.kind))
            controls.push({ node: n, x: x + n.x, y: y + n.y });
        collect(n.children, x + n.x, y + n.y);
    } };
    if (state)
        collect(objects);
    return <div className="prototype-screen" style={{ position: 'relative', width: page.width, height: page.height, background: '#fff' }}>{page.structured ? <StructuredFrameView frame={page.structured} prototype={state ? { state, onInput: onInput! } : undefined}/> : <><FontDefinitions fonts={page.fonts}/><svg width={page.width} height={page.height}><VisualSvg objects={objects} variables={document.variables}/></svg>{state && controls.map(({ node: n, x, y }) => <input key={n.id} data-object-id={n.id} aria-label={n.name} type={['Checkbox', 'Toggle'].includes(n.kind) ? 'checkbox' : n.kind === 'Radio' ? 'radio' : 'text'} value={String(state.inputs[n.id] ?? '')} checked={!!state.inputs[n.id]} onChange={e => onInput?.(n.id, e.target.type === 'checkbox' || e.target.type === 'radio' ? e.target.checked : e.target.value)} style={{ position: 'absolute', left: x, top: y, width: n.width, height: n.height }}/>)}</>}</div>;
});
export const Thumbnail=memo(function Thumbnail({ page, document, width = 240 }: {
    page: VisualPage;
    document: VisualDocument;
    width?: number;
}) { const scale = width / page.width; return <div className="prototype-thumbnail" style={{ width, height: Math.min(page.height * scale, 180), overflow: 'hidden', pointerEvents: 'none' }}>{page.thumbnail && !page.edited ? <img alt="" src={page.thumbnail} style={{ width }}/> : <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}><Screen page={page} document={document}/></div>}</div>; },(before,after)=>before.page===after.page&&before.width===after.width&&before.document.variables===after.document.variables)
