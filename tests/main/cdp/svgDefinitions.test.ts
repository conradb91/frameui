import {expect,test} from 'bun:test'
import {renderSvgDefinitions,scopeSvgValue} from '../../../src/core/capture-compiler/svgDefinitions'
test('SVG definitions scope IDs and references, and never replay scripts, events or external resources',()=>{
 const tree=[{tag:'filter',attributes:{id:'blur',onload:'alert(1)'},children:[{tag:'feGaussianBlur',attributes:{stdDeviation:'4'},children:[]},{tag:'script',attributes:{},children:[]},{tag:'feImage',attributes:{href:'https://bad.example/a.svg'},children:[]}]},{tag:'use',attributes:{href:'javascript:alert(1)'},children:[]}]
 const html=renderSvgDefinitions(JSON.stringify(tree),'one');expect(html).toContain('frameui-one-blur');expect(html).toContain('feGaussianBlur');expect(html).not.toContain('alert');expect(html).not.toContain('https:');expect(html).not.toContain('script');expect(scopeSvgValue('url("https://app.test/#blur")','two')).toBe('url(#frameui-two-blur)');expect(renderSvgDefinitions('broken','x')).toBe('')
})
