import {captureImageMime} from '../../src/core/capture-compiler/imageMime'
import {capturedPositionStyleFor} from '../../src/core/capture-compiler/structuredNodeStyle'
import {updateStructuredNodeText} from '../../src/core/capture-compiler/edit'
import {changeCanvasNode} from '../../src/core/ai/canvas'
import type {VisualPage} from '../../src/shared/types/visualDesign'
import {expect,test} from 'bun:test'
import {compileStructuredNodes} from '../../src/core/capture-compiler/compile'
import {makeStructuredFrame} from '../../src/core/capture-compiler/document'
import {structuredFrameSchema} from '../../src/core/capture-compiler/schema'
import {appearanceStyleFor} from '../../src/core/capture-compiler/structuredNodeStyle'
import {updateStructuredNodeBounds,layoutStructured} from '../../src/core/capture-compiler/edit'
import {renderStructuredFrameToHtml} from '../../src/core/capture-compiler/renderStructuredFrameToHtml'
import type {CapturedElement} from '../../src/shared/types/runtimeCapture'
const element=(styles:Record<string,string>,children:CapturedElement[]=[]):CapturedElement=>({tag:'div',rect:{x:20,y:30,width:300,height:200},styles,children})
test('effect-only wrappers retain native children and CSS masks, clipping and compositing after save/reopen',()=>{
 const root=element({clipPath:'inset(0 round 20px)',maskImage:'linear-gradient(black, transparent)',maskPosition:'50% 50%',maskSize:'cover',filter:'blur(2px) contrast(1.2)',backdropFilter:'blur(8px)',mixBlendMode:'screen',isolation:'isolate'},[element({backgroundImage:'conic-gradient(red, blue, red)'})]);
 const frame=makeStructuredFrame(root,{name:'Effects',route:'/',width:500,height:500,durationMs:0});expect(frame.children).toHaveLength(1);const wrapper=frame.children[0];expect(wrapper.children).toHaveLength(1);
 const reopened=structuredFrameSchema.parse(JSON.parse(JSON.stringify(frame))),css=appearanceStyleFor(reopened.children[0].appearance);expect(css.clipPath).toBe('inset(0 round 20px)');expect(css.maskImage).toContain('linear-gradient');expect(css.filter).toBe('blur(2px) contrast(1.2)');expect(css.backdropFilter).toBe('blur(8px)');expect(css.mixBlendMode).toBe('screen');
 const changed=updateStructuredNodeBounds(reopened,[{id:wrapper.id,bounds:{x:40,width:200}}]);expect(changed.children[0].children[0].parentId).toBe(wrapper.id);expect(changed.children[0].appearance.clipPath).toBe(wrapper.appearance.clipPath);expect(renderStructuredFrameToHtml(changed)).toContain('mask-image:linear-gradient');
});
test('text inputs retain real editable control metadata and computed typography instead of a painted text substitute',()=>{
 const [input]=compileStructuredNodes({...element({fontFamily:'Arial',fontSize:'18px',fontWeight:'600',lineHeight:'24px',padding:'12px 16px'}),tag:'input',attributes:{type:'email',placeholder:'Work email',controlValue:'person@example.com'}});
 expect(input.source.control).toMatchObject({type:'email',placeholder:'Work email',value:'person@example.com'});expect(input.typography?.fontSize).toBe(18);expect(input.typography?.fontWeight).toBe('600');expect(input.children).toHaveLength(0);expect(input.layout.padding?.left).toBe(16);
});
test('intentional stack editing shares the existing native layout algorithm',()=>{
 const [parent]=compileStructuredNodes(element({overflow:'hidden'},[element({backgroundColor:'red'}),element({backgroundColor:'blue'})]));parent.layout={mode:'stack',direction:'vertical',gap:12,padding:{top:16,left:16,right:16,bottom:16}};layoutStructured(parent);expect(parent.children[0].bounds.y).toBe(16);expect(parent.children[1].bounds.y).toBe(228);expect(parent.appearance.clip).toBe(true)
});

test('Claude text revisions change native input content while keeping default data separate',()=>{
 const frame=makeStructuredFrame({...element({fontSize:'16px'}),tag:'input',attributes:{type:'text',placeholder:'Old hint',controlValue:'Existing data'}},{name:'Form',route:'/',width:500,height:500,durationMs:0});
 const page={id:'p',name:'Form',width:500,height:500,objects:[],structured:frame} as VisualPage;changeCanvasNode(page,frame.children[0].id,{text:'New hint'});expect(frame.children[0].source.control?.placeholder).toBe('New hint');expect(frame.children[0].source.control?.value).toBe('Existing data');
});

test('AVIF images with a wrong server content type remain original image bytes, while actual JSON is rejected',()=>{
 const avif=new Uint8Array([0,0,0,28,102,116,121,112,97,118,105,102,0,0,0,0]);expect(captureImageMime(avif,'application/json')).toBe('image/avif');expect(()=>captureImageMime(new TextEncoder().encode('{"error":"missing"}'),'application/json')).toThrow('recognised image');
});
test('captured percentage constraints cannot clamp measured geometry',()=>{
 const [node]=compileStructuredNodes(element({maxWidth:'100%',backgroundColor:'white'}));const css=capturedPositionStyleFor(node);expect(css.maxWidth).toBe('none');expect(css.width).toBe('300px');
});
test('mixed inline headings preserve measured line positions as one editable text layer, then reflow on text edit',()=>{
 const lines=[{text:'First line',x:0,y:0,width:150,height:24},{text:'Second',x:40,y:24,width:80,height:24}];const root={...element({fontSize:'20px',lineHeight:'24px'}),tag:'frameui-text',textPreview:'First line Second',attributes:{'data-frameui-text-lines':JSON.stringify(lines)}};
 const frame=makeStructuredFrame(root,{name:'Heading',route:'/',width:500,height:500,durationMs:0});expect(frame.children).toHaveLength(1);expect(frame.children[0].typography?.captureLines).toEqual(lines);const reopened=structuredFrameSchema.parse(JSON.parse(JSON.stringify(frame)));expect(renderStructuredFrameToHtml(reopened)).toContain('left:40px');expect(updateStructuredNodeText(reopened,reopened.children[0].id,'Revised heading').children[0].typography?.captureLines).toBeUndefined();
});
test('horizontal paragraph padding retains its container rather than shifting text to the outer box',()=>{
 const child={...element({fontSize:'18px',lineHeight:'24px'}),tag:'frameui-text',textPreview:'Privacy notice',rect:{x:44,y:30,width:180,height:24}};const nodes=compileStructuredNodes({...element({padding:'0px 24px'},[child]),tag:'p'});expect(nodes[0].type).not.toBe('Text');expect(nodes[0].children[0].bounds.x).toBe(24);expect(nodes[0].children[0].typography?.text).toBe('Privacy notice');
});
