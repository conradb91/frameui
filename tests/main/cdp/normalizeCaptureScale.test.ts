import { expect, test } from 'bun:test'
import type { CapturedElement } from '../../../src/shared/types/runtimeCapture'
import { normalizeCaptureScale } from '../../../src/main/ipc/handlers/cdp/normalizeCaptureScale'
const node = (styles: Record<string,string>, children: CapturedElement[] = [], tag='div'): CapturedElement => ({ tag, styles, children, rect:{x:10,y:20,width:100,height:30} })

test('flattens nested uniform scales once without changing measured geometry or source styles', () => {
  const text = node({fontSize:'20px',lineHeight:'24px',transform:'matrix(0.5, 0, 0, 0.5, 0, 0)'},[],'frameui-text')
  const source = node({transform:'matrix(0.8, 0, 0, 0.8, 0, 0)'},[node({transform:'matrix(0.5, 0, 0, 0.5, 0, 0)',borderRadius:'10px',boxShadow:'0px 4px 8px rgb(0, 0, 0)'},[text])])
  const scaled = normalizeCaptureScale(source).children[0]
  expect(scaled.styles.borderRadius).toBe('4px')
  expect(scaled.styles.boxShadow).toBe('0px 1.6px 3.2px rgb(0, 0, 0)')
  expect(scaled.children[0].styles.fontSize).toBe('8px')
  expect(scaled.children[0].rect).toEqual(text.rect)
  expect(text.styles.fontSize).toBe('20px')
})

test('does not mistake a rotation or nonuniform transform for a uniform scale', () => {
  for(const transform of ['matrix(0, 1, -1, 0, 0, 0)','matrix(0.5, 0, 0, 0.8, 0, 0)']) {
    const result=normalizeCaptureScale(node({transform,fontSize:'20px'}))
    expect(result.styles.transform).toBe(transform)
    expect(result.styles.fontSize).toBe('20px')
  }
})

test('recovers rotated border boxes without applying the matrix to an already rotated bounding box',()=>{
 const source=node({width:'100px',height:'40px',boxSizing:'border-box',transform:'matrix(0, 1, -1, 0, 0, 0)',transformOrigin:'50px 20px'})
 source.rect={x:130,y:170,width:40,height:100}
 const result=normalizeCaptureScale(source)
 expect(result.rect).toEqual({x:100,y:200,width:100,height:40})
 expect(result.styles.frameuiTransform).toBe('matrix(0,1,-1,0,0,0)')
 expect(result.styles.transform).toBe('none')
 expect(source.rect.width).toBe(40)
})
test('recovers skew, reflection and nonuniform scale on leaf boxes',()=>{
 for(const [matrix,rect] of [['matrix(1, 0, 0.5, 1, 0, 0)',{x:90,y:200,width:120,height:40}],['matrix(-1, 0, 0, 0.5, 0, 0)',{x:100,y:210,width:100,height:20}]] as const){
 const source=node({width:'100px',height:'40px',boxSizing:'border-box',transform:matrix,transformOrigin:'50px 20px'});source.rect={...rect};const result=normalizeCaptureScale(source);expect(result.rect).toEqual({x:100,y:200,width:100,height:40});expect(result.styles.frameuiTransform).toBeDefined()
 }
})
