import type { Token } from '@shared/types/model/projectModel'
import { resolveClassName } from '../adapters/tailwind/resolveClassName'
const plain: Record<string, string> = {
  flex:'display:flex',grid:'display:grid',block:'display:block',inline:'display:inline','inline-block':'display:inline-block','inline-flex':'display:inline-flex',hidden:'display:none',
  relative:'position:relative',absolute:'position:absolute',fixed:'position:fixed',sticky:'position:sticky',
  'flex-col':'flex-direction:column','flex-row':'flex-direction:row','flex-wrap':'flex-wrap:wrap','flex-1':'flex:1 1 0%','shrink-0':'flex-shrink:0',grow:'flex-grow:1',
  'items-center':'align-items:center','items-start':'align-items:flex-start','items-end':'align-items:flex-end','items-stretch':'align-items:stretch','justify-center':'justify-content:center','justify-between':'justify-content:space-between','justify-end':'justify-content:flex-end',
  'w-full':'width:100%','h-full':'height:100%','w-screen':'width:100vw','h-screen':'height:100vh','min-h-screen':'min-height:100vh','w-auto':'width:auto','h-auto':'height:auto','mx-auto':'margin-left:auto;margin-right:auto','overflow-hidden':'overflow:hidden','overflow-auto':'overflow:auto',
  'rounded-full':'border-radius:9999px',rounded:'border-radius:0.25rem','rounded-sm':'border-radius:0.125rem','rounded-md':'border-radius:0.375rem','rounded-lg':'border-radius:0.5rem','rounded-xl':'border-radius:0.75rem','rounded-2xl':'border-radius:1rem',
  border:'border-width:1px;border-style:solid','border-0':'border-width:0','text-center':'text-align:center','text-left':'text-align:left','text-right':'text-align:right',
  'font-normal':'font-weight:400','font-medium':'font-weight:500','font-semibold':'font-weight:600','font-bold':'font-weight:700',italic:'font-style:italic',underline:'text-decoration:underline',
  'text-xs':'font-size:0.75rem;line-height:1rem','text-sm':'font-size:0.875rem;line-height:1.25rem','text-base':'font-size:1rem;line-height:1.5rem','text-lg':'font-size:1.125rem;line-height:1.75rem','text-xl':'font-size:1.25rem;line-height:1.75rem','text-2xl':'font-size:1.5rem;line-height:2rem','text-3xl':'font-size:1.875rem;line-height:2.25rem','text-4xl':'font-size:2.25rem;line-height:2.5rem',
  'bg-white':'background-color:#fff','bg-black':'background-color:#000','text-white':'color:#fff','text-black':'color:#000','object-cover':'object-fit:cover','object-contain':'object-fit:contain','box-border':'box-sizing:border-box','whitespace-nowrap':'white-space:nowrap',
}
/** Supported utilities, with project tokens taking precedence over defaults. */
export function utilityRule(className: string, tokens: Token[], state: string): string | null {
  const parts = className.split(/:(?![^[]*\])/), utility = parts.pop()!
  const resolved = resolveClassName(utility, tokens)[0]
  let declaration = resolved?.value ? resolved.properties.map(p => `${p}:${resolved.value}`).join(';') : plain[utility]
  if (!declaration) {
    const numeric = /^(p[xytrbl]?|m[xytrbl]?|gap|gap-x|gap-y|w|h|min-w|min-h|max-w|max-h|top|left|right|bottom)-(\d+(?:\.\d+)?|\[[^\]]+\])$/.exec(utility)
    if (numeric) {
      const names: Record<string, string> = {p:'padding',m:'margin',w:'width',h:'height','min-w':'min-width','min-h':'min-height','max-w':'max-width','max-h':'max-height','gap-x':'column-gap','gap-y':'row-gap'}
      const prefix = numeric[1], value = numeric[2].startsWith('[') ? numeric[2].slice(1,-1).replace(/_/g,' ') : `${Number(numeric[2]) * .25}rem`
      const axis: Record<string, string[]> = {x:['left','right'],y:['top','bottom'],t:['top'],b:['bottom'],l:['left'],r:['right']}
      const properties = /^[pm][xytrbl]$/.test(prefix) ? axis[prefix[1]].map(side => `${names[prefix[0]]}-${side}`) : [names[prefix] ?? prefix]
      declaration = properties.map(property => `${property}:${value}`).join(';')
    }
    const grid = /^grid-cols-(\d+)$/.exec(utility)
    if (grid) declaration = `grid-template-columns:repeat(${Math.min(12, Number(grid[1]))},minmax(0,1fr))`
    const colour = /^(bg|text|border)-\[(#[\da-fA-F]{3,8}|var\(--[\w-]+\))\]$/.exec(utility)
    if (colour) declaration = `${colour[1] === 'bg' ? 'background-color' : colour[1] === 'text' ? 'color' : 'border-color'}:${colour[2]}`
  }
  if (!declaration || /url\(|[<>]/i.test(declaration)) return null
  let selector = `.${className.replace(/([^a-zA-Z0-9_-])/g, '\\$1')}`, media = ''
  for (const variant of parts) {
    if (['hover','focus','active','disabled'].includes(variant)) { if (state.toLowerCase() !== variant) selector += `:${variant}` }
    else {
      const breakpoint = tokens.find(t => t.category === 'breakpoint' && t.name === variant)?.value ?? ({sm:'640px',md:'768px',lg:'1024px',xl:'1280px','2xl':'1536px'} as Record<string,string>)[variant]
      if (!breakpoint || !/^[\d.]+(?:px|rem|em)$/.test(breakpoint)) return null
      media = `(min-width:${breakpoint})`
    }
  }
  const rule = `${selector}{${declaration}}`
  return media ? `@media ${media}{${rule}}` : rule
}
