figma.showUI(__html__, { width: 420, height: 620, themeColors: true })

let cancelled = false
const warnings = []

function progress(stage, completed, total) {
  figma.ui.postMessage({ type: 'progress', stage, completed, total })
}

function color(value, fallback) {
  const text = String(value || '').trim()
  let match = text.match(/^#([0-9a-f]{3,8})$/i)
  if (match) {
    let hex = match[1]
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((part) => part + part).join('')
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255
    return { r, g, b, a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1 }
  }
  match = text.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i)
  if (match) return { r: Number(match[1]) / 255, g: Number(match[2]) / 255, b: Number(match[3]) / 255, a: match[4] ? (match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4])) : 1 }
  return fallback || { r: 0, g: 0, b: 0, a: 1 }
}

function paints(items) {
  return (items || []).flatMap((paint) => {
    if (paint.type === 'GRADIENT') {
      const values = String(paint.value).match(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/ig) || []
      if (values.length < 2) return []
      return [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: values.map((value, index) => ({ position: index / (values.length - 1), color: color(value) })), opacity: paint.opacity == null ? 1 : paint.opacity }]
    }
    if (paint.type !== 'SOLID') return []
    const rgba = color(paint.color)
    return [{ type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: Math.max(0, Math.min(1, rgba.a * (paint.opacity == null ? 1 : paint.opacity))) }]
  })
}

function fontStyle(weight) {
  const value = Number.parseInt(weight, 10)
  if (value >= 900) return 'Black'
  if (value >= 800) return 'Extra Bold'
  if (value >= 700) return 'Bold'
  if (value >= 600) return 'Semi Bold'
  if (value >= 500) return 'Medium'
  if (value <= 300) return 'Light'
  return 'Regular'
}

async function loadFont(family, weight, nodeName) {
  const requested = { family: String(family || 'Inter').split(',')[0].replace(/["']/g, '').trim(), style: fontStyle(weight) }
  try { await figma.loadFontAsync(requested); return requested } catch (_) {
    const regular = { family: requested.family, style: 'Regular' }
    try { await figma.loadFontAsync(regular); warnings.push(`${nodeName}: ${requested.style} was unavailable; Regular was used.`); return regular } catch (_) {
      const fallback = { family: 'Inter', style: 'Regular' }
      await figma.loadFontAsync(fallback)
      warnings.push(`${nodeName}: ${requested.family} is missing; editable Inter text was used.`)
      return fallback
    }
  }
}

function resize(node, model) {
  if ('resize' in node) node.resize(Math.max(0.01, model.width || 0.01), Math.max(0.01, model.height || 0.01))
  if ('x' in node) { node.x = Number.isFinite(model.x) ? model.x : 0; node.y = Number.isFinite(model.y) ? model.y : 0 }
  if ('rotation' in node) node.rotation = Number.isFinite(model.rotation) ? model.rotation : 0
  if ('opacity' in node) node.opacity = Math.max(0, Math.min(1, model.opacity == null ? 1 : model.opacity))
  if ('visible' in node) node.visible = model.visible !== false
  if ('locked' in node) node.locked = !!model.locked
}

function configureFrame(node, model) {
  node.clipsContent = !!model.clipContent
  node.fills = paints(model.fills)
  node.strokes = paints(model.strokes)
  node.strokeWeight = Math.max(0, model.strokeWidth || 0)
  const radius = model.radius || [0, 0, 0, 0]
  node.topLeftRadius = radius[0] || 0; node.topRightRadius = radius[1] || 0; node.bottomRightRadius = radius[2] || 0; node.bottomLeftRadius = radius[3] || 0
  if (model.layout && (model.layout.mode === 'HORIZONTAL' || model.layout.mode === 'VERTICAL')) {
    node.layoutMode = model.layout.mode
    node.layoutWrap = model.layout.wrap ? 'WRAP' : 'NO_WRAP'
    node.itemSpacing = model.layout.gap || 0
    node.paddingTop = model.layout.padding.top || 0; node.paddingRight = model.layout.padding.right || 0; node.paddingBottom = model.layout.padding.bottom || 0; node.paddingLeft = model.layout.padding.left || 0
    const align = String(model.layout.align || '').toLowerCase()
    node.counterAxisAlignItems = align.includes('center') ? 'CENTER' : align.includes('end') ? 'MAX' : align.includes('stretch') ? 'BASELINE' : 'MIN'
    const justify = String(model.layout.justify || '').toLowerCase()
    node.primaryAxisAlignItems = justify.includes('space-between') ? 'SPACE_BETWEEN' : justify.includes('center') ? 'CENTER' : justify.includes('end') ? 'MAX' : 'MIN'
  }
}

function applyMetadata(node, model, documentId) {
  node.name = model.name || model.type
  node.setPluginData('frameuiNodeId', model.id)
  node.setPluginData('frameuiDocumentId', documentId)
  if (model.component && model.component.componentId) node.setPluginData('frameuiComponentId', model.component.componentId)
  if (model.tokenBindings) node.setPluginData('frameuiTokenBindings', JSON.stringify(model.tokenBindings))
}

function applyEffects(node, model) {
  if (!('effects' in node)) return
  const result = []
  for (const effect of model.effects || []) {
    if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') result.push({ type: effect.type, radius: Math.max(0, effect.radius || parseFloat(effect.value) || 0), visible: true })
    else if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const numbers = String(effect.value).replace(/rgba?\([^)]+\)|#[0-9a-f]+/ig, '').match(/-?[\d.]+/g) || []
      const match = String(effect.value).match(/rgba?\([^)]+\)|#[0-9a-f]+/i)
      const rgba = color(match && match[0], { r: 0, g: 0, b: 0, a: .2 })
      result.push({ type: effect.type, color: rgba, offset: { x: Number(numbers[0]) || 0, y: Number(numbers[1]) || 0 }, radius: Math.max(0, Number(numbers[2]) || 0), spread: Number(numbers[3]) || 0, blendMode: 'NORMAL', visible: true })
    } else warnings.push(`${model.name}: unsupported effect retained in FrameUI metadata.`)
  }
  try { node.effects = result } catch (_) { warnings.push(`${model.name}: one effect could not be represented exactly.`) }
}

function applyVariableBindings(node, model, variables) {
  for (const [field, tokenId] of Object.entries(model.tokenBindings || {})) {
    const variable = variables.get(tokenId)
    if (!variable) continue
    try {
      if (['fill', 'backgroundColor', 'color'].includes(field) && 'fills' in node && Array.isArray(node.fills) && node.fills[0] && node.fills[0].type === 'SOLID') {
        const values = [...node.fills]; values[0] = figma.variables.setBoundVariableForPaint(values[0], 'color', variable); node.fills = values
      } else if (['stroke', 'borderColor'].includes(field) && 'strokes' in node && Array.isArray(node.strokes) && node.strokes[0] && node.strokes[0].type === 'SOLID') {
        const values = [...node.strokes]; values[0] = figma.variables.setBoundVariableForPaint(values[0], 'color', variable); node.strokes = values
      } else if (typeof node.setBoundVariable === 'function') {
        const targets = field === 'radius' || field === 'borderRadius' ? ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'] : field === 'gap' ? ['itemSpacing'] : field === 'padding' ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] : [field]
        for (const target of targets) node.setBoundVariable(target, variable)
      }
    } catch (_) { warnings.push(`${model.name}: ${field} variable could not be bound.`) }
  }
}

async function createNative(model, context, parentModel) {
  if (cancelled) throw new Error('cancelled')
  let node
  if (model.type === 'TEXT') {
    node = figma.createText()
    const text = model.text || { characters: '', fontFamily: 'Inter', fontWeight: '400', fontSize: 16, lineHeight: 20, letterSpacing: 0, alignment: 'left' }
    node.fontName = await loadFont(text.fontFamily, text.fontWeight, model.name)
    node.characters = text.characters || ''
    node.fontSize = Math.max(1, text.fontSize || 16)
    node.lineHeight = { unit: 'PIXELS', value: Math.max(1, text.lineHeight || text.fontSize * 1.2) }
    node.letterSpacing = { unit: 'PIXELS', value: text.letterSpacing || 0 }
    node.textAlignHorizontal = String(text.alignment || 'left').toUpperCase() === 'RIGHT' ? 'RIGHT' : String(text.alignment || '').toUpperCase() === 'CENTER' ? 'CENTER' : 'LEFT'
    node.fills = paints(model.fills)
    for (const run of text.runs || []) {
      const start = Math.max(0, Math.min(node.characters.length, run.start)), end = Math.max(start, Math.min(node.characters.length, run.end))
      if (start === end) continue
      if (run.fontWeight) node.setRangeFontName(start, end, await loadFont(text.fontFamily, run.fontWeight, model.name))
      if (run.color) node.setRangeFills(start, end, paints([{ type: 'SOLID', color: run.color, opacity: 1 }]))
    }
  } else if (model.type === 'ELLIPSE') node = figma.createEllipse()
  else if (model.type === 'LINE') node = figma.createLine()
  else if (model.type === 'SECTION') node = figma.createSection()
  else if ((model.type === 'VECTOR' || model.type === 'ICON') && model.vector && model.vector.svg) {
    try { node = figma.createNodeFromSvg(model.vector.svg) } catch (_) { node = figma.createVector(); warnings.push(`${model.name}: SVG geometry could not be parsed exactly.`) }
  } else if ((model.type === 'VECTOR' || model.type === 'ICON') && model.vector && model.vector.path) {
    node = figma.createVector()
    try { node.vectorPaths = [{ windingRule: 'NONZERO', data: model.vector.path }] } catch (_) { warnings.push(`${model.name}: vector path requires attention.`) }
  } else if (model.type === 'COMPONENT') node = figma.createComponent()
  else if (model.type === 'COMPONENT_INSTANCE' && model.component && context.components.has(model.component.componentId)) node = context.components.get(model.component.componentId).createInstance()
  else if (model.type === 'RECTANGLE' || model.type === 'IMAGE') node = figma.createRectangle()
  else node = figma.createFrame()

  applyMetadata(node, model, context.documentId)
  context.nodes.set(model.id, node)
  resize(node, model)
  if ('fills' in node && model.type !== 'TEXT') node.fills = paints(model.fills)
  if ('strokes' in node) { node.strokes = paints(model.strokes); node.strokeWeight = Math.max(0, model.strokeWidth || 0) }
  if ('clipsContent' in node) configureFrame(node, model)
  applyEffects(node, model)
  if (model.type === 'IMAGE' && model.image) {
    const bytes = context.assets.get(model.image.assetId)
    if (bytes && 'fills' in node) {
      const image = figma.createImage(bytes)
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: model.image.fit === 'CONTAIN' ? 'FIT' : model.image.fit === 'FILL' ? 'STRETCH' : 'FILL' }]
    } else warnings.push(`${model.name}: source image is missing.`)
  }
  applyVariableBindings(node, model, context.variables)
  if (parentModel && parentModel.layout && ['HORIZONTAL', 'VERTICAL'].includes(parentModel.layout.mode) && model.layout && ['absolute', 'fixed'].includes(model.layout.constraints) && 'layoutPositioning' in node) node.layoutPositioning = 'ABSOLUTE'
  for (const child of model.children || []) {
    const childNode = await createNative(child, context, model)
    if ('appendChild' in node) node.appendChild(childNode)
  }
  return node
}

async function createVariables(tokens, documentId) {
  const collections = new Map()
  const variables = new Map()
  let count = 0
  for (const token of tokens) {
    if (cancelled) throw new Error('cancelled')
    let collection = collections.get(token.collection)
    if (!collection) { collection = figma.variables.createVariableCollection(token.collection || 'FrameUI'); collection.setPluginData('frameuiDocumentId', documentId); collections.set(token.collection, collection) }
    const type = token.type === 'COLOR' ? 'COLOR' : token.type === 'NUMBER' ? 'FLOAT' : token.type === 'BOOLEAN' ? 'BOOLEAN' : 'STRING'
    try {
      const variable = figma.variables.createVariable(token.name, collection, type)
      variable.setPluginData('frameuiTokenId', token.id)
      variable.setValueForMode(collection.defaultModeId, type === 'COLOR' ? color(token.value) : token.value)
      variables.set(token.id, variable)
      count++
    } catch (_) { warnings.push(`${token.name}: variable could not be created.`) }
    progress('Creating variables', count, tokens.length)
  }
  return { count, variables }
}

async function importPackage(payload) {
  cancelled = false; warnings.length = 0; warnings.push(...(payload.packageWarnings || []).map((warning) => warning.message))
  const manifest = payload.manifest, document = payload.document
  const context = { documentId: document.documentId, components: new Map(), nodes: new Map(), variables: new Map(), assets: new Map((payload.options.images ? payload.assets : []).map((asset) => [asset.id, new Uint8Array(asset.bytes)])) }
  progress('Preparing document', 0, document.pages.length)
  const variableResult = payload.options.variables ? await createVariables(payload.tokens, document.documentId) : { count: 0, variables: new Map() }
  const variableCount = variableResult.count; context.variables = variableResult.variables
  let componentCount = 0
  if (payload.options.components && payload.components.length) {
    const componentPage = figma.createPage(); componentPage.name = 'Components'; await componentPage.loadAsync(); await figma.setCurrentPageAsync(componentPage)
    for (const model of payload.components) {
      const variants = model.component && model.component.variants || []
      if (variants.length) {
        const nativeVariants = []
        for (const variant of variants) {
          const variantName = Object.entries(variant.properties || {}).map(([key, value]) => key + '=' + value).join(', ') || variant.name
          const variantModel = { ...model, id: variant.id, name: variantName, children: variant.children, component: { componentId: model.id }, type: 'COMPONENT' }
          const native = await createNative(variantModel, context, null); componentPage.appendChild(native); nativeVariants.push(native)
        }
        const set = figma.combineAsVariants(nativeVariants, componentPage); set.name = model.name; set.setPluginData('frameuiComponentId', model.id); set.setPluginData('frameuiDocumentId', document.documentId)
        context.components.set(model.id, nativeVariants[0])
      } else {
        const node = await createNative({ ...model, type: 'COMPONENT' }, context, null)
        componentPage.appendChild(node); context.components.set(model.id, node)
      }
      componentCount++
      progress('Creating components', componentCount, payload.components.length)
    }
  }
  let artboardCount = 0
  const imported = [], targetPages = new Map(), folderPages = new Map(), nextX = new Map()
  if (payload.options.designs) for (const pageModel of document.pages) {
    if (cancelled) throw new Error('cancelled')
    const folder = pageModel.folder || 'Designs'
    let page = folderPages.get(folder)
    if (!page) { page = figma.createPage(); page.name = folder; await page.loadAsync(); folderPages.set(folder, page); nextX.set(folder, 0) }
    await figma.setCurrentPageAsync(page)
    const frame = await createNative(pageModel.root, context, null)
    frame.x = nextX.get(folder) || 0; frame.y = 0; nextX.set(folder, frame.x + frame.width + 160)
    page.appendChild(frame); imported.push(frame); targetPages.set(pageModel.id, frame); artboardCount++
    progress('Creating artboards', artboardCount, document.pages.length)
  }
  if (payload.options.prototype) for (const interaction of payload.interactions || []) {
    const source = context.nodes.get(interaction.nodeId), destination = targetPages.get(interaction.targetPageId)
    if (!source || !destination) { warnings.push(`Prototype link ${interaction.nodeId} could not be connected.`); continue }
    source.setPluginData('frameuiInteraction', JSON.stringify(interaction))
    if (typeof source.setReactionsAsync === 'function') {
      const trigger = interaction.trigger === 'Hover' ? { type: 'MOUSE_ENTER', delay: 0 } : { type: 'ON_CLICK' }
      const transition = interaction.transition === 'Dissolve' ? { type: 'DISSOLVE', duration: .3, easing: { type: 'EASE_OUT' } } : null
      try { await source.setReactionsAsync([{ trigger, actions: [{ type: 'NODE', destinationId: destination.id, navigation: 'NAVIGATE', transition, preserveScrollPosition: false }] }]) } catch (_) { warnings.push(`${source.name}: prototype information was retained as metadata but could not be connected.`) }
    }
  }
  if (imported.length) { await figma.setCurrentPageAsync(imported[0].parent); figma.currentPage.selection = [imported[0]]; figma.viewport.scrollAndZoomIntoView([imported[0]]) }
  figma.ui.postMessage({ type: 'complete', stats: { artboards: artboardCount, components: componentCount, assets: payload.options.images ? payload.assets.length : 0, variables: variableCount }, warnings })
  figma.notify(`FrameUI import complete · ${artboardCount} artboard${artboardCount === 1 ? '' : 's'}`)
}

figma.ui.onmessage = async (message) => {
  if (message.type === 'cancel') { cancelled = true; return }
  if (message.type === 'close') { figma.closePlugin(); return }
  if (message.type !== 'import') return
  try { await importPackage(message.payload) }
  catch (error) {
    if (String(error && error.message) === 'cancelled') figma.ui.postMessage({ type: 'cancelled' })
    else figma.ui.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
