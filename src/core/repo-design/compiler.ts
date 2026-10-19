import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Project, Node, SyntaxKind, type SourceFile } from 'ts-morph'
import { baseParse, NodeTypes, type TemplateChildNode, type ElementNode } from '@vue/compiler-core'
import { parse as parseVue } from '@vue/compiler-sfc'
import postcss from 'postcss'
import type { DesignIR, DesignIRNode } from '@shared/types/designIR'
import type { Page, ProjectModel } from '@shared/types/model/projectModel'
import { utilityRule } from './utilities'
import { previewValue } from './previewData'
import { phpTemplate } from './phpTemplate'

type Value = string | number | boolean | null | undefined | Value[] | { [key: string]: Value }
type Scope = Record<string, Value>
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const blockedTags = new Set('script iframe frame object embed base meta link'.split(' '))
const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }
const safeAttributes = /^(?:id|class|style|title|role|type|name|value|placeholder|alt|src|width|height|viewBox|d|fill|stroke|stroke-width|cx|cy|r|rx|ry|x|y|x1|x2|y1|y2|points|transform|opacity|disabled|checked|selected|colspan|rowspan|aria-[\w-]+)$/

/** A deliberately bounded interpreter, not a bundler/evaluator of user code. */
export function compileRepositoryPage(root: string, page: Page, model: ProjectModel, state = 'Populated', propsOverride:Record<string,string> = {}): DesignIR {
  const canonicalRoot = fs.realpathSync(root)
  const dependencies = new Map<string, Buffer>()
  const warnings = new Set<string>()
  const states = new Set(['Populated'])
  const styles = new Map<string, string>()
  const sourceFiles = new Map<string, SourceFile>()
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { noLib: true } })
  const componentStack = new Set<string>()
  let generatedData = false, count = 0, totalBytes = 0
  function safeFile(file: string): string | undefined {
    try {
      const resolved = fs.realpathSync(file)
      const relative = path.relative(canonicalRoot, resolved)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.env') || part === '.git')) return
      if (!fs.statSync(resolved).isFile() || fs.statSync(resolved).size > 8_000_000) return
      return resolved
    } catch { return }
  }
  function read(file: string): string {
    const allowed = safeFile(file)
    if (!allowed || dependencies.size >= 200) return ''
    if (!dependencies.has(allowed)) {
      const size = fs.statSync(allowed).size
      if (totalBytes + size > 32_000_000 || (!mime[path.extname(allowed)] && size > 1_000_000)) { warnings.add('A large source dependency was omitted from this page preview.'); return '' }
      const content=fs.readFileSync(allowed);totalBytes+=content.length;dependencies.set(allowed,content)
    }
    return dependencies.get(allowed)!.toString('utf8')
  }
  function local(reference: string, from: string): string | undefined {
    if (!reference || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(reference)) return
    const clean = reference.split(/[?#]/)[0]
    const bases = clean.startsWith('/') ? [path.join(canonicalRoot, 'public', clean), path.join(canonicalRoot, clean)] : clean.startsWith('@/') || clean.startsWith('~/') ? [path.join(canonicalRoot, 'src', clean.slice(2)), path.join(canonicalRoot, clean.slice(2))] : [path.resolve(path.dirname(from), clean)]
    for (const base of bases) for (const suffix of ['', '.tsx', '.ts', '.jsx', '.js', '.vue', '.json', '.php', '.html', '/index.tsx', '/index.ts', '/index.jsx']) {
      const allowed = safeFile(base + suffix)
      if (allowed) return allowed
    }
  }
  function asset(reference: string, from: string): string {
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(reference)) return reference
    const file = local(reference, from)
    if (!file || !mime[path.extname(file).toLowerCase()]) { if (reference) warnings.add('An asset is unavailable locally; external downloads are disabled.'); return '' }
    read(file)
    const buffer = dependencies.get(file)
    return buffer ? `data:${mime[path.extname(file).toLowerCase()]};base64,${buffer.toString('base64')}` : ''
  }
  function css(source: string, file: string) {
    if (styles.has(file)) return
    styles.set(file, '')
    try {
      const ast = postcss.parse(source, { from: file })
      ast.walkAtRules(rule => {
        if (rule.name === 'import') {
          const ref = /^(?:url\(\s*)?['"]?([^'"\s);]+)/.exec(rule.params)?.[1]
          const imported = ref && local(ref, file)
          if (imported) css(read(imported), imported)
          else warnings.add('An external or unresolved stylesheet was omitted.')
          rule.remove()
        }
      })
      ast.walkRules(rule => { for (const pseudo of ['hover', 'focus', 'active', 'disabled']) if (rule.selector.includes(`:${pseudo}`)) states.add(pseudo[0].toUpperCase() + pseudo.slice(1)); if (state !== 'Populated') rule.selector = rule.selector.replace(new RegExp(`:${state.toLowerCase()}\\b`, 'g'), '') })
      ast.walkDecls(decl => { decl.value = decl.value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, url: string) => `url("${asset(url, file)}")`) })
      styles.set(file, ast.toString())
    } catch { warnings.add(`Some styles in ${path.basename(file)} could not be read.`) }
  }
  function node(tag: string, file: string, line?: number): DesignIRNode {
    return { id: `source-${++count}`, tag, name: tag, source: { file: path.relative(canonicalRoot, file), line }, attributes: {}, children: [] }
  }
  function placeholder(name: string, file: string): DesignIRNode {
    warnings.add(`${name} could not be fully resolved; the rest of the page is available.`)
    const result = node('section', file)
    result.name = name; result.unsupported = name; result.text = `${name} · component preview unavailable`
    result.attributes.style = 'min-height:80px;padding:16px;border:1px dashed #94a3b8;background:#f8fafc;color:#475569'
    return result
  }
  function generated(field: string, scope: Scope): Value { generatedData = true; return previewValue(field, Number(scope.__row ?? 0)) }
  function resolveValue(expr: Node | undefined, scope: Scope, depth = 0): Value {
    if (!expr || depth > 25) return undefined
    const next = (n: Node | undefined) => resolveValue(n, scope, depth + 1)
    if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralText()
    if (Node.isNumericLiteral(expr)) return expr.getLiteralValue()
    if (expr.getKind() === SyntaxKind.TrueKeyword) return true
    if (expr.getKind() === SyntaxKind.FalseKeyword) return false
    if (expr.getKind() === SyntaxKind.NullKeyword) return null
    if (Node.isParenthesizedExpression(expr) || Node.isAsExpression(expr) || Node.isNonNullExpression(expr)) return next(expr.getExpression())
    if (Node.isIdentifier(expr)) {
      const name = expr.getText()
      if (/password|secret|token|apikey|credential/i.test(name)) return ''
      if (/^(is)?loading$/i.test(name)) { states.add('Loading'); return state === 'Loading' }
      if (/^(is)?error$/i.test(name)) { states.add('Error'); return state === 'Error' ? 'Preview error' : false }
      if (/^(is)?(?:open|visible)$/i.test(name)) { states.add('Open'); return state === 'Open' }
      if (Object.hasOwn(scope, name)) return scope[name]
      return undefined
    }
    if (Node.isArrayLiteralExpression(expr)) return expr.getElements().slice(0, 10).map(next)
    if (Node.isObjectLiteralExpression(expr)) {
      const out: Scope = Object.create(null)
      for (const p of expr.getProperties()) if (Node.isPropertyAssignment(p)) out[p.getName().replace(/^['"]|['"]$/g, '')] = next(p.getInitializer())
      return out
    }
    if (Node.isPropertyAccessExpression(expr)) {
      const value = next(expr.getExpression()), key = expr.getName()
      if (key === 'length') { states.add('Empty'); return state === 'Empty' ? 0 : Array.isArray(value) || typeof value === 'string' ? value.length : 5 }
      if (value && typeof value === 'object' && Object.hasOwn(value, key)) return (value as Scope)[key]
      return generated(key, scope)
    }
    if (Node.isElementAccessExpression(expr)) {
      const value = next(expr.getExpression()), key = next(expr.getArgumentExpression())
      if (value && typeof value === 'object' && (typeof key === 'string' || typeof key === 'number') && Object.hasOwn(value, key)) return (value as Scope)[String(key)]
    }
    if (Node.isPrefixUnaryExpression(expr)) { const value = next(expr.getOperand()); return expr.getOperatorToken() === SyntaxKind.ExclamationToken ? !value : expr.getOperatorToken() === SyntaxKind.MinusToken && typeof value === 'number' ? -value : undefined }
    if (Node.isConditionalExpression(expr)) return next(next(expr.getCondition()) ? expr.getWhenTrue() : expr.getWhenFalse())
    if (Node.isBinaryExpression(expr)) {
      const a = next(expr.getLeft()), b = next(expr.getRight()), op = expr.getOperatorToken().getText()
      if (op === '||') return a || b
      if (op === '??') return a ?? b
      if (op === '&&') return a && b
      if (op === '===' || op === '==') return a === b
      if (op === '!==' || op === '!=') return a !== b
      if (op === '+') return typeof a === 'string' || typeof b === 'string' ? String(a ?? '') + String(b ?? '') : Number(a) + Number(b)
      if (op === '>') return Number(a) > Number(b)
      if (op === '<') return Number(a) < Number(b)
    }
    if (Node.isTemplateExpression(expr)) return expr.getHead().getLiteralText() + expr.getTemplateSpans().map(span => String(next(span.getExpression()) ?? '') + span.getLiteral().getLiteralText()).join('')
    // Calls are never evaluated. Only explicit data-only constructors below are interpreted.
    return undefined
  }
  function source(file: string): SourceFile {
    if (!sourceFiles.has(file)) sourceFiles.set(file, project.createSourceFile(file, read(file), { overwrite: true }))
    return sourceFiles.get(file)!
  }
  function scopeFor(sf: SourceFile, parent: Scope): Scope {
    const scope = { ...parent }
    for (const imp of sf.getImportDeclarations()) {
      const ref = imp.getModuleSpecifierValue(), resolved = local(ref, sf.getFilePath())
      if (resolved && /\.css$/i.test(resolved)) {
        css(read(resolved), resolved)
        if (/\.module\.css$/i.test(resolved)) warnings.add('CSS Module bindings are partially supported in this preview.')
      }
      if (resolved && /\.json$/i.test(resolved) && imp.getDefaultImport()) {
        try { scope[imp.getDefaultImport()!.getText()] = JSON.parse(read(resolved)) as Value } catch { /* invalid fixture */ }
      }
      if (resolved && mime[path.extname(resolved)] && imp.getDefaultImport()) scope[imp.getDefaultImport()!.getText()] = path.relative(path.dirname(sf.getFilePath()), resolved)
    }
    for (const declaration of sf.getVariableDeclarations()) if (Node.isIdentifier(declaration.getNameNode())) {
      const value = resolveValue(declaration.getInitializer(), scope)
      if (value !== undefined) scope[declaration.getName()] = value
    }
    return scope
  }
  function component(file: string, exportName: string, props: Scope, children: DesignIRNode[], depth: number): DesignIRNode[] {
    if (depth > 30 || count > 1800 || componentStack.has(`${file}:${exportName}`)) return [placeholder(exportName, file)]
    componentStack.add(`${file}:${exportName}`)
    try {
      if (/\.vue$/i.test(file)) return markup(read(file), file, props, depth)
      const sf = source(file), scope = scopeFor(sf, props)
      const declarations = sf.getExportedDeclarations().get(exportName)
      const candidate = declarations?.[0] ?? sf.getFunction(exportName) ?? sf.getVariableDeclaration(exportName) ?? (exportName === 'default' ? sf.getFunctions().find(f => f.isDefaultExport()) : undefined)
      let body: Node | undefined = candidate
      if (body && Node.isVariableDeclaration(body)) body = body.getInitializer()
      if (body && Node.isExportAssignment(body)) body = body.getExpression()
      if (body && Node.isIdentifier(body)) body = sf.getFunction(body.getText()) ?? sf.getVariableDeclaration(body.getText())?.getInitializer()
      if (!body) body = sf.getFunctions()[0] ?? sf.getVariableDeclarations().find(d => { const i = d.getInitializer(); return i && Node.isArrowFunction(i) })?.getInitializer()
      if (!body) return [placeholder(exportName, file)]
      if (Node.isFunctionDeclaration(body) || Node.isArrowFunction(body) || Node.isFunctionExpression(body)) {
        const parameter = body.getParameters()[0]
        if (parameter) {
          const name = parameter.getNameNode()
          if (Node.isIdentifier(name)) scope[name.getText()] = props
          if (Node.isObjectBindingPattern(name)) for (const item of name.getElements()) {
            const key = item.getPropertyNameNode()?.getText() ?? item.getName()
            const value = props[key] ?? resolveValue(item.getInitializer(), scope)
            if (value !== undefined) scope[item.getName()] = value
            else if (!/^(?:is)?(?:loading|error|open|visible)$/i.test(key) && key !== 'children') scope[item.getName()] = generated(key,scope)
          }
        }
        body = body.getBody()
      }
      if (!body) return []
      const returned = (part: Node): DesignIRNode[] | undefined => {
        if (Node.isReturnStatement(part)) return jsx(part.getExpression(), file, scope, children, depth + 1)
        if (Node.isIfStatement(part)) {
          const condition = resolveValue(part.getExpression(), scope)
          const branch = condition ? part.getThenStatement() : part.getElseStatement()
          return branch ? returned(branch) : undefined
        }
        if (Node.isBlock(part)) {
          for (const statement of part.getStatements()) {
            if (Node.isVariableStatement(statement)) for (const d of statement.getDeclarations()) { const value = resolveValue(d.getInitializer(), scope); if (value !== undefined) scope[d.getName()] = value }
            const result = returned(statement)
            if (result !== undefined) return result
          }
        }
        return undefined
      }
      // Inventory conditional states even when a particular branch is not selected.
      body.forEachDescendant(n => { if (Node.isIdentifier(n) && /^(?:is)?(?:loading|error|open|visible)$/i.test(n.getText())) resolveValue(n, {}); if (Node.isPropertyAccessExpression(n) && n.getName() === 'length') states.add('Empty') })
      const result = returned(body) ?? jsx(body, file, scope, children, depth + 1)
      for (const n of result) { n.name = exportName === 'default' ? path.basename(file).replace(/\.[^.]+$/, '') : exportName; n.source.component = n.name }
      return result
    } finally { componentStack.delete(`${file}:${exportName}`) }
  }
  function jsx(expr: Node | undefined, file: string, scope: Scope, slot: DesignIRNode[], depth: number): DesignIRNode[] {
    if (!expr || depth > 40 || count > 2000) return []
    if (Node.isParenthesizedExpression(expr) || Node.isJsxExpression(expr)) return jsx(expr.getExpression(), file, scope, slot, depth + 1)
    if (Node.isJsxFragment(expr)) return expr.getJsxChildren().flatMap(n => jsx(n, file, scope, slot, depth + 1))
    if (Node.isConditionalExpression(expr)) return jsx(resolveValue(expr.getCondition(), scope) ? expr.getWhenTrue() : expr.getWhenFalse(), file, scope, slot, depth + 1)
    if (Node.isBinaryExpression(expr) && ['&&', '||', '??'].includes(expr.getOperatorToken().getText())) {
      const truth = resolveValue(expr.getLeft(), scope)
      return jsx(expr.getOperatorToken().getText() === '&&' ? truth ? expr.getRight() : undefined : truth ? expr.getLeft() : expr.getRight(), file, scope, slot, depth + 1)
    }
    if ((expr.getText() === 'children' || expr.getText() === 'props.children') && slot.length) return structuredClone(slot)
    if (Node.isCallExpression(expr) && Node.isPropertyAccessExpression(expr.getExpression()) && expr.getExpression().getText().endsWith('.map')) {
      const access = expr.getExpression() as import('ts-morph').PropertyAccessExpression
      const callback = expr.getArguments()[0]
      if (callback && Node.isArrowFunction(callback)) {
        let data = resolveValue(access.getExpression(), scope)
        if (!Array.isArray(data)) { generatedData = true; data = state === 'Empty' ? [] : Array.from({ length: 5 }, () => ({})) }
        const key = callback.getParameters()[0]?.getName() ?? 'item'
        return data.slice(0, 10).flatMap((value, i) => jsx(callback.getBody(), file, { ...scope, [key]: value, __row: i }, slot, depth + 1))
      }
    }
    if (Node.isJsxElement(expr) || Node.isJsxSelfClosingElement(expr)) {
      const opening = Node.isJsxElement(expr) ? expr.getOpeningElement() : expr
      const tag = opening.getTagNameNode().getText(), props: Scope = {}
      const result = node(tag, file, expr.getStartLineNumber())
      for (const attr of opening.getAttributes()) if (Node.isJsxAttribute(attr)) {
        const key = attr.getNameNode().getText(), init = attr.getInitializer()
        const value = !init ? true : resolveValue(Node.isJsxExpression(init) ? init.getExpression() : init, scope)
        props[key] = value
        const name = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key
        if (name === 'style' && value && typeof value === 'object' && !Array.isArray(value)) result.attributes.style = Object.entries(value).map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${typeof v === 'number' && !['opacity', 'zIndex', 'fontWeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'lineHeight'].includes(k) ? v + 'px' : String(v)}`).join(';')
        else if (safeAttributes.test(name) && value !== undefined && value !== false && value !== null && typeof value !== 'object') result.attributes[name] = name === 'src' ? asset(String(value), file) : String(value)
      }
      const kids = Node.isJsxElement(expr) ? expr.getJsxChildren().flatMap(n => jsx(n, file, scope, slot, depth + 1)) : []
      if (/^[A-Z]/.test(tag)) {
        const sf = source(file)
        for (const imp of sf.getImportDeclarations()) {
          const named = imp.getNamedImports().find(i => (i.getAliasNode()?.getText() ?? i.getName()) === tag)
          if (named || imp.getDefaultImport()?.getText() === tag) {
            const resolved = local(imp.getModuleSpecifierValue(), file)
            return resolved ? component(resolved, named?.getName() ?? 'default', props, kids, depth + 1) : [placeholder(tag, file)]
          }
        }
        if (sf.getFunction(tag) || sf.getVariableDeclaration(tag)) return component(file, tag, props, kids, depth + 1)
        return [placeholder(tag, file)]
      }
      if (blockedTags.has(tag)) return []
      result.children = kids
      return [result]
    }
    const value = Node.isJsxText(expr) ? expr.getText().replace(/\s+/g, ' ') : resolveValue(expr, scope)
    if (typeof value !== 'string' && typeof value !== 'number') return []
    if (!String(value).trim()) return []
    const result = node('#text', file, expr.getStartLineNumber()); result.text = String(value); return [result]
  }
  function markup(content: string, file: string, scope: Scope = {}, depth = 0): DesignIRNode[] {
    if (depth > 30) return [placeholder(path.basename(file), file)]
    const vue = /\.vue$/i.test(file) ? parseVue(content).descriptor : null
    if (vue) {
      for (const style of vue.styles) css(style.content, file + '#style' + style.loc.start.offset)
      const script = vue.scriptSetup ?? vue.script
      if (script) scope = scopeFor(project.createSourceFile(file + '.ts', script.content, {overwrite:true}), scope)
      content = vue.template?.content ?? ''
    }
    const ast = baseParse(content, { isVoidTag: tag => voidTags.has(tag), onError: () => warnings.add(`Some markup in ${path.basename(file)} is incomplete.`) })
    const expressions = new Map<string, Node | undefined>()
    function templateValue(expression: string, variables: Scope): Value {
      if (!expressions.has(expression)) expressions.set(expression, project.createSourceFile(`/template-expression-${sourceFiles.size}-${count}-${expressions.size}.ts`, `const value = (${expression})`, {overwrite:true}).getVariableDeclarations()[0]?.getInitializer())
      return resolveValue(expressions.get(expression),variables)
    }
    function convertChildren(children: TemplateChildNode[], variables: Scope): DesignIRNode[] {
      let matched = false
      return children.flatMap(child => {
        if (child.type === NodeTypes.ELEMENT) {
          const branch = child.props.find(p=>p.type===NodeTypes.DIRECTIVE && ['if','else-if','else'].includes(p.name))
          if (branch?.type === NodeTypes.DIRECTIVE) {
            if (branch.name === 'if') matched = false
            if (matched) return []
            const visible = branch.name === 'else' || !!templateValue(branch.exp?.loc.source??'false',variables)
            matched ||= visible
            if (!visible) return []
          }
        }
        return convert(child,variables)
      })
    }
    function convert(n: TemplateChildNode, variables: Scope): DesignIRNode[] {
      if (count > 2000) return []
      if (n.type === NodeTypes.TEXT) { const item = node('#text', file, n.loc.start.line); item.text = n.content; return [item] }
      if (n.type === NodeTypes.INTERPOLATION) { const item = node('#text', file, n.loc.start.line); const field = n.content.loc.source.split('.').pop() ?? 'content'; item.text = String(templateValue(n.content.loc.source,variables) ?? generated(field, variables)); return [item] }
      if (n.type !== NodeTypes.ELEMENT) return []
      if (n.tag === 'style') { css(n.children.map(c => c.type === NodeTypes.TEXT ? c.content : '').join(''), file + '#inline' + n.loc.start.offset); return [] }
      if (n.tag === 'link') { const href = n.props.find(p => p.type === NodeTypes.ATTRIBUTE && p.name === 'href'); if (href?.type === NodeTypes.ATTRIBUTE && href.value) { const resolved = local(href.value.content, file); if (resolved && /\.css$/i.test(resolved)) css(read(resolved), resolved) } return [] }
      if (blockedTags.has(n.tag) || n.tag === 'head') { if (n.tag === 'head') n.children.forEach(child => convert(child, variables)); return [] }
      if (n.tag === 'html' || n.tag === 'template') return convertChildren(n.children, variables)
      const item = node(n.tag, file, n.loc.start.line)
      const loop = n.props.find(p => p.type === NodeTypes.DIRECTIVE && p.name === 'for')
      if (loop?.type === NodeTypes.DIRECTIVE) {
        states.add('Empty')
        const without: ElementNode = { ...n, props: n.props.filter(p => p !== loop) }
        const parts = /^(?:\(([^,)]+)(?:,[^)]+)?\)|([^ ]+))\s+(?:in|of)\s+(.+)$/.exec(loop.exp?.loc.source??'')
        let rows = parts && templateValue(parts[3],variables)
        if (!Array.isArray(rows)) {generatedData = true; rows=state==='Empty'?[]:Array.from({length:5},()=>({}))}
        return rows.slice(0,10).flatMap((row,i)=>convert(without,{...variables,[parts?.[1]?.trim()??parts?.[2]??'item']:row,__row:i}))
      }
      for (const p of n.props) {
        if (p.type === NodeTypes.ATTRIBUTE && safeAttributes.test(p.name)) item.attributes[p.name] = p.name === 'src' ? asset(p.value?.content ?? '', file) : p.value?.content ?? ''
        if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.arg?.loc.source && safeAttributes.test(p.arg.loc.source)) {
          const field = p.exp?.loc.source.split('.').pop() ?? 'content'
          const value = String(templateValue(p.exp?.loc.source??'',variables) ?? generated(field, variables))
          item.attributes[p.arg.loc.source] = p.arg.loc.source === 'src' ? asset(value,file) : value
        }
      }
      if (/^[A-Z]/.test(n.tag) || n.tag.includes('-')) {
        const known = model.components.find(c => c.name.replace(/-/g,'').toLowerCase() === n.tag.replace(/-/g,'').toLowerCase())
        const resolved = known && safeFile(path.resolve(canonicalRoot, known.source.filePath))
        return resolved ? component(resolved, 'default', variables, [], depth + 1) : [placeholder(n.tag, file)]
      }
      item.children = convertChildren(n.children, variables)
      return [item]
    }
    return convertChildren(ast.children, scope)
  }
  const entry = safeFile(path.resolve(canonicalRoot, page.source.filePath))
  let nodes: DesignIRNode[] = []
  if (!entry) warnings.add('This page source is no longer available inside the repository.')
  else if (/\.[jt]sx?$/i.test(entry)) {
    const known = model.components.find(c=>c.id===page.id)
    const fixture = known && model.designSystem?.components.find(c=>c.componentId===known.id)?.fixtures[0]
    const props: Scope = {}
    for (const [name,value] of Object.entries({...fixture?.props,...propsOverride})) {try{props[name]=JSON.parse(value) as Value}catch{props[name]=value}}
    nodes = component(entry, known?.exportKind==='named'?known.name:'default', props, [], 0)
    if (/^page\.[jt]sx?$/.test(path.basename(entry))) {
      let folder = path.dirname(entry)
      for (let level=0;level<15 && folder!==canonicalRoot;level++,folder=path.dirname(folder)) {
        const layout=local('./layout',path.join(folder,'page.tsx'))
        if(layout)nodes=component(layout,'default',{},nodes,0)
        if(path.basename(folder)==='app')break
      }
    }
  }
  else if (/\.(html?|vue)$/i.test(entry)) nodes = markup(read(entry), entry)
  else if (/\.(php|phtml)$/i.test(entry)) {
    const included = new Set<string>()
    const template = (file: string): string => {
      if (included.has(file) || included.size > 30) { warnings.add('A recursive template include was omitted.'); return '' }
      included.add(file)
      const result = phpTemplate(read(file),file,state,reference=>{
        const resolved=local(reference,file)??local('/app/Views/'+reference,file)??local('/resources/views/'+reference,file)
        if(!resolved){warnings.add('A template include is unavailable locally.');return ''}
        return template(resolved)
      },message=>warnings.add(message))
      result.states.forEach(s=>states.add(s));generatedData ||= result.generatedData
      included.delete(file)
      return result.html
    }
    nodes = markup(template(entry),entry)
  }
  else {
    warnings.add('This server-side template is partially supported; dynamic server logic is not executed.')
    const convert = (item: Page['structure'][number]): DesignIRNode => {
      const result = node(item.tagName, entry, item.sourceLine)
      result.name = item.tagName; result.text = item.textPreview
      for (const [key, value] of Object.entries(item.attributes ?? {})) if (safeAttributes.test(key)) result.attributes[key] = key === 'src' ? asset(value, entry) : value
      result.children = item.children.map(convert); return result
    }
    read(entry); nodes = page.structure.map(convert)
  }
  // Only project-indexed styles are read. No dependency installation or config execution.
  for (const style of model.styles ?? []) if (style.source && /(?:^|\/)(?:global|globals|app|index|main|tailwind|style|styles)\.css$/i.test(style.source.filePath)) { const file = safeFile(path.resolve(canonicalRoot, style.source.filePath)); if (file) css(read(file), file) }
  const utilities = new Map<string, string>()
  function utilityStyles(items: DesignIRNode[]) {
    for (const item of items) {
      for (const className of (item.attributes.class ?? '').split(/\s+/)) {
        const rule = utilityRule(className, model.tokens, state)
        if (rule) utilities.set(className, rule)
        for (const pseudo of ['Hover', 'Focus', 'Active', 'Disabled']) if (className.includes(pseudo.toLowerCase() + ':')) states.add(pseudo)
      }
      utilityStyles(item.children)
    }
  }
  utilityStyles(nodes)
  const unsupported = nodes.length === 0
  if (unsupported) nodes = [placeholder(page.name, entry ?? path.resolve(canonicalRoot,page.source.filePath))]
  const utilityCSS = [...utilities.values()].join('\n')
  const hash = createHash('sha256').update('repo-design-v3').update(state).update(page.id).update(page.route ?? '').update(JSON.stringify(model.tokens)).update(utilityCSS)
  for (const [file, content] of dependencies) hash.update(file).update(content)
  const dataSchemas = [...sourceFiles.values()].flatMap(sf=>sf.getInterfaces().map(schema=>({name:schema.getName(),source:path.relative(canonicalRoot,sf.getFilePath()),fields:schema.getProperties().map(p=>({name:p.getName(),type:p.getTypeNode()?.getText()??'unknown'}))})))
  return { version: 1, pageId: page.id, name: page.name, route: page.route ?? '', nodes, styles: [...styles.values()].join('\n') + '\n' + utilityCSS, dependencies: [...dependencies.keys()].map(f => path.relative(canonicalRoot, f)), hash: hash.digest('hex'), states: [...states], state, generatedData, dataSchemas, warnings: [...warnings], status: unsupported ? 'unsupported' : warnings.size ? 'partial' : 'ready' }
}

export function designIRMarkup(ir: DesignIR): string {
  function render(n: DesignIRNode): string {
    if (n.tag === '#text') return escape(n.text ?? '')
    if (!/^[a-z][a-z0-9-]*$/i.test(n.tag) || blockedTags.has(n.tag)) return ''
    const attrs = Object.entries(n.attributes).filter(([key]) => safeAttributes.test(key)).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')
    const semantic: Record<string,string> = {body:ir.name,main:'Page Content',header:'Header',footer:'Footer',nav:'Navigation',aside:'Sidebar',section:'Section',article:'Card',h1:'Page Heading',h2:'Section Heading',h3:'Heading',p:'Body Text',button:'Button',a:'Link',svg:'Icon'}
    const name = n.source.component ?? (n.name !== n.tag ? n.name : semantic[n.tag])
    const start = `<${n.tag}${attrs} data-frameui-source="${escape(n.source.file)}"${name ? ` data-frameui-component="${escape(name)}"` : ''}>`
    return start + (voidTags.has(n.tag) ? '' : escape(n.text ?? '') + n.children.map(render).join('') + `</${n.tag}>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${ir.styles.replace(/<\/style/gi, '<\\/style')}</style></head><body>${ir.nodes.map(render).join('')}</body></html>`
}
