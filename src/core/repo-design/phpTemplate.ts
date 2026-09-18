import { parsePhp, isPhpNode } from '../adapters/php/parsePhp'
import { previewValue } from './previewData'
type Value = string | number | boolean | Value[] | { [key: string]: Value } | undefined
type Scope = Record<string, Value>
const escaped = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')

/** Interprets only presentation AST nodes; never invokes PHP, functions or a server. */
export function phpTemplate(content: string, file: string, state: string, include: (reference: string) => string, warn: (message: string) => void): { html: string; states: string[]; generatedData: boolean } {
  const ast = parsePhp(content, file), states = new Set(['Populated'])
  let generatedData = false, steps = 0
  function value(raw: unknown, scope: Scope, depth = 0): Value {
    if (!isPhpNode(raw) || depth > 30) return undefined
    const next = (node: unknown) => value(node, scope, depth + 1)
    if (raw.kind === 'string' && typeof raw.value === 'string') return raw.value
    if (raw.kind === 'number') return Number(raw.value)
    if (raw.kind === 'boolean') return Boolean(raw.value)
    if (raw.kind === 'variable' && typeof raw.name === 'string') {
      if (/password|secret|token|credential/i.test(raw.name)) return ''
      if (Object.hasOwn(scope,raw.name)) return scope[raw.name]
      if (/loading|error|open/i.test(raw.name)) { const matched = /loading|error|open/i.exec(raw.name)![0].toLowerCase(); const label = matched[0].toUpperCase()+matched.slice(1); states.add(label); return state === label }
      return undefined
    }
    if (raw.kind === 'array' && Array.isArray(raw.items)) {
      const output: Record<string, Value> = {}, list: Value[] = []
      for (const item of raw.items.filter(isPhpNode)) { const v=next(item.value), key=next(item.key); if(typeof key==='string')output[key]=v;else list.push(v) }
      return Object.keys(output).length ? output : list
    }
    if (raw.kind === 'offsetlookup' || raw.kind === 'propertylookup') {
      const object = next(raw.what), offset = isPhpNode(raw.offset) && raw.offset.kind === 'identifier' ? String(raw.offset.name) : next(raw.offset)
      if (object && typeof object === 'object' && typeof offset === 'string' && Object.hasOwn(object,offset)) return (object as Scope)[offset]
      if (typeof offset === 'string') { generatedData = true; return previewValue(offset,Number(scope.__row??0)) }
    }
    if (raw.kind === 'unary' && raw.type === '!') return !next(raw.what)
    if (raw.kind === 'bin') { const a=next(raw.left),b=next(raw.right); if(raw.type==='.')return String(a??'')+String(b??'');if(raw.type==='==='||raw.type==='==')return a===b;if(raw.type==='!=='||raw.type==='!=')return a!==b;if(raw.type==='>')return Number(a)>Number(b);if(raw.type==='<')return Number(a)<Number(b) }
    if (raw.kind === 'call' && isPhpNode(raw.what)) {
      const name=String(raw.what.name??''),args=Array.isArray(raw.arguments)?raw.arguments:[]
      if (['esc','htmlspecialchars','htmlentities'].includes(name)) return next(args[0])
      if (['base_url','site_url'].includes(name)) return '/'+String(next(args[0])??'').replace(/^\//,'')
      if (name==='count') {states.add('Empty');const data=next(args[0]);return Array.isArray(data)?data.length:state==='Empty'?0:5}
    }
    if (raw.kind === 'empty') { states.add('Empty'); const data=next(raw.expression);return data === undefined ? state==='Empty' : Array.isArray(data)?data.length===0:!data }
    return undefined
  }
  function render(raw: unknown, scope: Scope, depth = 0): string {
    if (++steps>4000||depth>40) {warn('This template exceeds the supported reconstruction size.');return ''}
    if (Array.isArray(raw)) return raw.map(n=>render(n,scope,depth+1)).join('')
    if (!isPhpNode(raw)) return ''
    if (raw.kind==='program'||raw.kind==='block') return render(raw.children,scope,depth+1)
    if (raw.kind==='inline') return String(raw.value??'')
    if (raw.kind==='echo') return (Array.isArray(raw.expressions)?raw.expressions:[]).map(expression=>{
      if(isPhpNode(expression)&&expression.kind==='call'&&isPhpNode(expression.what)&&expression.what.name==='view')return include(String(value((expression.arguments as unknown[])?.[0],scope)??''))
      const v=value(expression,scope);if(v===undefined){warn('Some dynamic template content could not be resolved.');return ''}return escaped(String(v))
    }).join('')
    if (raw.kind==='foreach') {
      states.add('Empty');let data=value(raw.source,scope)
      if(!Array.isArray(data)){generatedData=true;data=state==='Empty'?[]:Array.from({length:5},()=>({}))}
      const name=isPhpNode(raw.value)?String(raw.value.name):'item'
      return data.slice(0,10).map((item,i)=>render(raw.body,{...scope,[name]:item,__row:i},depth+1)).join('')
    }
    if (raw.kind==='if') return render(value(raw.test,scope)?raw.body:raw.alternate,scope,depth+1)
    if (raw.kind==='expressionstatement'&&isPhpNode(raw.expression)) {
      const expression=raw.expression
      if(expression.kind==='assign'&&isPhpNode(expression.left)&&expression.left.kind==='variable')scope[String(expression.left.name)]=value(expression.right,scope)
      else if(expression.kind==='include')return include(String(value(expression.target,scope)??''))
      else warn('A server-side template operation was not executed.')
    }
    return ''
  }
  // Discover branches without evaluating them.
  const inventory = (raw: unknown) => {if(Array.isArray(raw)){raw.forEach(inventory);return}if(!isPhpNode(raw))return;if(raw.kind==='variable')value(raw,{});if(raw.kind==='foreach'||raw.kind==='empty')states.add('Empty');Object.values(raw).forEach(v=>{if(v!==raw)inventory(v)})}
  if(ast)inventory(ast)
  else warn('This PHP template could not be parsed safely.')
  return {html:render(ast,{}),states:[...states],generatedData}
}
