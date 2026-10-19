import { describe, test, expect } from 'bun:test';
import { createFlow, prototype, migrate, removeMembership, mergeDraft, validatePrototype, changes } from '../../src/core/prototype/model';
import { initialState, executeInteraction } from '../../src/core/prototype/runtime';
import { visualDocumentSchema } from '../../src/core/visual/schema';
import { object } from '../../src/core/visual/model';
import type { VisualDocument } from '../../src/shared/types/visualDesign';
import type { Interaction } from '../../src/shared/types/prototype';
const document = (): VisualDocument => ({ version: 1, id: 'doc', name: 'Test', updatedAt: '1', pages: ['a', 'b', 'c'].map(id => ({ id, name: id, folder: '', pinned: false, state: 'Default', width: 390, height: 844, objects: [object('Button', { id: id + 'button' })] })), components: [], variables: [] });
const interaction = (patch: Partial<Interaction> = {}): Interaction => ({ id: 'i', sourceArtboardId: 'a', sourceElementId: 'abutton', trigger: 'click', action: 'navigate', destinationId: 'b', transition: 'instant', ...patch });
describe('Shared prototype document', () => {
    test('flow membership, shared screens and deletion preserve artboards', () => { const d = document(), a = createFlow(d, 'One', ['a', 'b']), b = createFlow(d, 'Two', ['a']); removeMembership(d, a, 'a'); expect(a.startArtboardId).toBe('b'); expect(b.artboardIds).toEqual(['a']); prototype(d).flows = []; expect(d.pages).toHaveLength(3); });
    test('schema persists real interactions and graph positions', () => { const d = document(); createFlow(d, 'Journey', ['a', 'b']); prototype(d).interactions.push(interaction()); const parsed = visualDocumentSchema.parse(JSON.parse(JSON.stringify(d))); expect(parsed.prototype?.interactions[0].destinationId).toBe('b'); expect(validatePrototype(parsed).errors).toEqual([]); });
    test('cycles and branches are valid, dangling IDs and duplicate IDs fail', () => { const d = document(); createFlow(d, 'Journey', ['a', 'b']); prototype(d).interactions.push(interaction(), interaction({ id: 'j', sourceArtboardId: 'b', sourceElementId: 'bbutton', destinationId: 'a' })); expect(validatePrototype(d).errors).toEqual([]); prototype(d).interactions.push(interaction({ destinationId: 'missing' })); expect(validatePrototype(d).errors.length).toBeGreaterThan(1); });
    test('legacy interaction migration is idempotent and preserves elements', () => { const d = document(); d.pages[0].objects[0].interaction = { targetPageId: 'b', trigger: 'Click', transition: 'Dissolve' }; const m = migrate(d); expect(m.pages[0].objects[0].id).toBe('abutton'); expect(m.prototype?.interactions[0].transition).toBe('fade'); expect(m.pages[0].objects[0].interaction).toBeUndefined(); expect(migrate(m)).toEqual(m); });
    test('20 screens need no individually opened renderer to validate', () => { const d = document(); for (let i = 0; i < 20; i++)
        d.pages.push({ ...structuredClone(d.pages[0]), id: 'screen' + i, objects: [] }); createFlow(d, 'Large', d.pages.map(p => p.id)); expect(validatePrototype(d).errors).toEqual([]); });
});
describe('Controlled local runtime', () => {
    test('navigation, back, overlays and reset are isolated', () => { const d = document(); prototype(d).variables.count = 0; let s = initialState(d, 'a'); s = executeInteraction(d, s, interaction()); expect(s.pageId).toBe('b'); s = executeInteraction(d, s, interaction({ action: 'open-modal', destinationId: 'c' })); expect(s.overlays[0].pageId).toBe('c'); s = executeInteraction(d, s, interaction({ action: 'back' })); expect(s.pageId).toBe('a'); s = executeInteraction(d, s, interaction({ action: 'set-variable', variable: 'count', value: 2 })); expect(s.variables.count).toBe(2); expect(d.prototype?.variables.count).toBe(0); s = executeInteraction(d, s, interaction({ action: 'reset' })); expect(s.variables.count).toBe(0); });
    test('condition takes both branches; invalid navigation leaves current page', () => { const d = document(); prototype(d).variables.valid = false; const i = interaction({ action: 'conditional', condition: { variable: 'valid', operator: 'equals', value: true }, elseDestinationId: 'c' }); let s = executeInteraction(d, initialState(d, 'a'), i); expect(s.pageId).toBe('c'); s.variables.valid = true; s = executeInteraction(d, s, i); expect(s.pageId).toBe('b'); const failed = executeInteraction(d, s, interaction({ destinationId: 'missing' })); expect(failed.pageId).toBe('b'); expect(failed.error).not.toBe(''); });
});
describe('Approval transaction', () => {
    test('stable identities, unrelated edits, nonoverlapping new screens, one undo snapshot', () => { const base = document(), proposal = structuredClone(base), current = structuredClone(base); proposal.pages[0].name = 'Updated'; proposal.pages.push({ ...structuredClone(base.pages[0]), id: 'new', objects: [] }); current.pages[1].name = 'Manual edit'; const undo = structuredClone(current), merged = mergeDraft(current, base, proposal, { kind: 'artboard', id: 'a' }); expect(merged.pages[0].id).toBe('a'); expect(merged.pages[1].name).toBe('Manual edit'); expect(merged.pages[3].canvasX).toBeGreaterThan(390); expect(current).toEqual(undo); expect(changes(base, proposal).filter(c => c.status !== 'Unchanged')).toHaveLength(2); });
    test('conflicts and out-of-scope changes do not mutate current document', () => { const base = document(), proposal = structuredClone(base), current = structuredClone(base); proposal.pages[0].name = 'AI'; current.pages[0].name = 'Manual'; const snapshot = JSON.stringify(current); expect(() => mergeDraft(current, base, proposal)).toThrow('changed after'); expect(JSON.stringify(current)).toBe(snapshot); proposal.pages[1].name = 'Other'; expect(() => mergeDraft(base, base, proposal, { kind: 'artboard', id: 'a' })).toThrow('outside its target'); });
    test('malformed connections cannot partially import screens', () => { const base = document(), proposal = structuredClone(base); proposal.pages[0].name = 'AI'; prototype(proposal).interactions.push(interaction({ destinationId: 'missing' })); expect(() => mergeDraft(base, base, proposal)).toThrow('destination'); expect(base.pages[0].name).toBe('a'); });
});

test('prototype-wide revisions explicitly include several artboards but protect unrelated approved screens',()=>{
 const base=document(),proposal=structuredClone(base);proposal.pages[0].name='New A';proposal.pages[1].name='New B'
 expect(mergeDraft(base,base,proposal,{kind:'artboards',ids:['a','b']}).pages.map(p=>p.name)).toEqual(['New A','New B','c'])
 proposal.pages[2].name='Unexpected C'
 expect(()=>mergeDraft(base,base,proposal,{kind:'artboards',ids:['a','b']})).toThrow('outside its target')
})
test('native process import lays branches and overlays into nonoverlapping journeys and preserves current positions',()=>{
 const current=document();current.pages[0].canvasX=123;current.pages[0].canvasY=456
 const proposal=structuredClone(current)
 for(const id of ['form','error','success','confirm'])proposal.pages.push({...structuredClone(current.pages[0]),id,objects:[]})
 const f=createFlow(proposal,'Create item',['a','form','error','success','confirm']);f.positions={}
 prototype(proposal).variables.valid=false
 prototype(proposal).interactions.push(interaction({id:'start',destinationId:'form'}),interaction({id:'result',sourceArtboardId:'form',sourceElementId:undefined,action:'conditional',condition:{variable:'valid',operator:'truthy'},destinationId:'success',elseDestinationId:'error'}),interaction({id:'overlay',sourceArtboardId:'form',sourceElementId:undefined,action:'open-modal',destinationId:'confirm'}))
 const next=mergeDraft(current,current,proposal,{kind:'artboard',id:'a'}),added=next.pages.filter(p=>!current.pages.some(c=>c.id===p.id))
 expect(next.pages[0]).toEqual(current.pages[0])
 const success=added.find(p=>p.id==='success')!,error=added.find(p=>p.id==='error')!,form=added.find(p=>p.id==='form')!,confirm=added.find(p=>p.id==='confirm')!
 expect(success.canvasX).toBeGreaterThan(form.canvasX!)
 expect(success.canvasX).toBe(error.canvasX);expect(success.canvasY).not.toBe(error.canvasY)
 expect(confirm.canvasX).toBe(form.canvasX);expect(confirm.canvasY).toBeGreaterThan(form.canvasY!)
 for(let i=0;i<added.length;i++)for(let j=i+1;j<added.length;j++){const a=added[i],b=added[j];expect((a.canvasX!+a.width<=b.canvasX!||b.canvasX!+b.width<=a.canvasX!||a.canvasY!+a.height<=b.canvasY!||b.canvasY!+b.height<=a.canvasY!)).toBe(true)}
 expect(next.prototype!.flows[0].positions.success.x).toBeGreaterThan(next.prototype!.flows[0].positions.form.x)
})

test('state relationships and evidence-backed completeness items persist and reject misleading completed controls',()=>{
 const d=document(),p=prototype(d);p.states=[{id:'loading-state',name:'Saving',kind:'loading',parentArtboardId:'a',artboardId:'b',interactionId:'i',notes:'Local save simulation'}];p.interactions=[interaction()]
 p.requirements=[{id:'title-field',artboardId:'a',label:'Reminder title',kind:'control',elementIds:['abutton'],interactionIds:[],status:'implemented',notes:'Native editable control'}]
 expect(validatePrototype(visualDocumentSchema.parse(d)).errors).toEqual([])
 p.requirements[0].elementIds=[]
 expect(validatePrototype(d).errors[0]).toContain('native element evidence')
 p.requirements[0].status='unresolved';p.requirements[0].notes='Needs required data rules'
 expect(validatePrototype(d).warnings.some(w=>w.includes('Needs required data rules'))).toBe(true)
 p.states[0].artboardId='missing'
 expect(validatePrototype(d).errors.some(w=>w.includes('state screen'))).toBe(true)
})

test('narrowing a follow-up revision preserves the import authority for prior approved-scope changes',async()=>{
 const {extendPrototypeTarget}=await import('../../src/core/prototype/model')
 const base=document(),proposal=structuredClone(base);proposal.pages[0].name='Earlier change';proposal.pages[1].name='Latest change'
 const cumulative=extendPrototypeTarget(base,{kind:'artboard',id:'a'},{kind:'artboard',id:'b'},proposal)
 expect(cumulative).toEqual({kind:'artboards',ids:['a','b']})
 expect(mergeDraft(base,base,proposal,cumulative).pages.map(p=>p.name)).toEqual(['Earlier change','Latest change','c'])
})
