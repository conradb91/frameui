import { CAPTURED_STYLE_PROPERTIES } from '@shared/captureStyleProperties'

/**
 * Runs inside the guest page's own JS context via `<webview
 * >.executeJavaScript()` (`CaptureSessionView.tsx`) — a completely
 * different runtime from this file's own: no TypeScript, no bundler, no
 * access to `window.frameui` or anything else FrameUI-side (spec §3
 * "runtime observation" reads the guest, it never grants the guest
 * anything). Written as one IIFE so `executeJavaScript`'s eval-like
 * semantics return its value directly, and every element is wrapped in its
 * own try/catch so one unusual node (e.g. an SVG element whose
 * `className` isn't a plain string) can't fail the whole capture.
 *
 * Mirrors the static structure extractors' shape and budgets
 * (`extractMarkupStructure.ts`: 500 nodes, depth 30, 60-char text preview)
 * for consistency, even though this walks the live DOM instead of parsed
 * source and reports real `getBoundingClientRect()`/`getComputedStyle()`
 * values instead of source attributes.
 */
export const CAPTURE_SCRIPT = `
(function () {
  var MAX_NODES = 10000
  var MAX_DEPTH = 30
  var MAX_TEXT_PREVIEW = 20000
  var NON_VISUAL_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, TITLE: 1 }
  var count = 0

  // Shared with the CDP capture path (\`cdp/domSnapshot.ts\`) via
  // \`@shared/captureStyleProperties\` — one source of truth for which
  // computed styles either capture mechanism reports.
  var STYLE_PROPERTIES = ${JSON.stringify(CAPTURED_STYLE_PROPERTIES)}

  function textPreviewOf(el) {
    if (el.matches && el.matches('input,textarea,select,[contenteditable="true"]')) return undefined
    var text = ''
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i]
      if (node.nodeType === 3) text += node.textContent || ''
    }
    text = text.replace(/\\s+/g, ' ').trim()
    if (!text) return undefined
    if (/(?:bearer\\s+[a-z0-9._-]+|api[_-]?key\\s*[:=]|password\\s*[:=]|secret\\s*[:=]|\\b\\d{13,19}\\b)/i.test(text)) return '[redacted]'
    return text.length > MAX_TEXT_PREVIEW ? text.slice(0, MAX_TEXT_PREVIEW) + '…' : text
  }

  function stylesOf(computed) {
    var styles = {}
    for (var i = 0; i < STYLE_PROPERTIES.length; i++) {
      var prop = STYLE_PROPERTIES[i]
      styles[prop] = computed[prop]
    }
    return styles
  }

  // Raw accessibility-relevant attributes only — role, every aria-*
  // present, and alt on <img> — never a computed accessible name/role.
  function ariaOf(el) {
    var aria = {}
    var role = el.getAttribute('role')
    if (role) aria.role = role
    var attrs = el.attributes
    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i]
      if (attr.name.indexOf('aria-') === 0 && !/(?:value|token|secret)/i.test(attr.name)) aria[attr.name] = /(?:bearer\\s+[a-z0-9._-]+|api[_-]?key\\s*[:=]|password\\s*[:=]|secret\\s*[:=]|\\b\\d{13,19}\\b)/i.test(attr.value) ? '[redacted]' : attr.value
    }
    if (el.tagName === 'IMG') {
      var alt = el.getAttribute('alt')
      if (alt !== null) aria.alt = /(?:bearer\\s+[a-z0-9._-]+|api[_-]?key\\s*[:=]|password\\s*[:=]|secret\\s*[:=]|\\b\\d{13,19}\\b)/i.test(alt) ? '[redacted]' : alt
    }
    return Object.keys(aria).length > 0 ? aria : undefined
  }

  function convert(el, depth) {
    if (count >= MAX_NODES || depth > MAX_DEPTH) return null
    if (!el || el.nodeType !== 1 || NON_VISUAL_TAGS[el.tagName]) return null
    count++
    try {
      var rect = el.getBoundingClientRect()
      var computed = window.getComputedStyle(el)
      if (computed.display === 'none' || computed.opacity === '0') return null
      var children = []
      var visualChildren = el.shadowRoot ? el.shadowRoot.children : el.tagName === 'SLOT' && el.assignedElements().length ? el.assignedElements() : el.children
      for (var i = 0; i < visualChildren.length; i++) {
        var child = convert(visualChildren[i], depth + 1)
        if (child) children.push(child)
      }
      // Text ranges retain padding, inline positioning and mixed text/element content.
      var directText = textPreviewOf(el)
      if (directText) for (var ti = 0; ti < el.childNodes.length; ti++) {
        var tn = el.childNodes[ti]
        if (tn.nodeType !== 3 || !tn.textContent.trim()) continue
        var range = document.createRange(); range.selectNodeContents(tn)
        var textRect = range.getBoundingClientRect()
        var textStyles = stylesOf(computed)
        textStyles.backgroundColor = 'transparent'; textStyles.backgroundImage = 'none'; textStyles.borderWidth = '0'; textStyles.boxShadow = 'none'; textStyles.opacity = '1'
        var lines=[]
        if(range.getClientRects().length>1 && directText!=='[redacted]') {
          var words=tn.textContent.matchAll(/\\S+\\s*/g)
          for(var word of words) { range.setStart(tn,word.index);range.setEnd(tn,word.index+word[0].length);var wr=range.getBoundingClientRect();var previous=lines[lines.length-1];if(previous&&Math.abs(previous.rect.y-wr.y)<2){previous.textPreview+=word[0];previous.rect.width=Math.max(previous.rect.width,wr.right-previous.rect.x)}else lines.push({tag:'frameui-text',textPreview:word[0],rect:{x:wr.x,y:wr.y,width:wr.width,height:wr.height},styles:textStyles,children:[]}) }
        }
        if(lines.length) children.push.apply(children,lines)
        else children.push({tag:'frameui-text',textPreview:directText === '[redacted]' ? directText : tn.textContent.replace(/\\s+/g,' ').trim(),rect:{x:textRect.x,y:textRect.y,width:textRect.width,height:textRect.height},styles:textStyles,children:[]})
      }
      // Pseudo elements are visual children, never exposed as DOM terminology.
      ;['::before','::after'].forEach(function(pseudo) {
        var ps=window.getComputedStyle(el,pseudo)
        if (!ps || ps.content==='none' || ps.content==='normal' || ps.display==='none') return
        var content=ps.content.replace(/^["']|["']$/g,'')
        var width=parseFloat(ps.width),height=parseFloat(ps.height)
        if (!isFinite(width)) width=content.length*(parseFloat(ps.fontSize)||16)*0.6
        if (!isFinite(height)) height=parseFloat(ps.lineHeight)||parseFloat(ps.fontSize)||16
        if (width<=0 || height<=0) return
        var x=rect.x+(parseFloat(ps.left)||0),y=rect.y+(parseFloat(ps.top)||0)
        if (ps.left==='auto' && ps.right!=='auto') x=rect.right-width-(parseFloat(ps.right)||0)
        children.push({tag:'frameui-visual',textPreview:content || undefined,rect:{x:x,y:y,width:width,height:height},styles:stylesOf(ps),children:[]})
      })
      var classes = typeof el.className === 'string' && el.className ? el.className : undefined
      var attributes = {}; ['src','alt','placeholder','type','viewBox','d','fill','stroke','cx','cy','r','rx','ry','x1','x2','y1','y2','stroke-width','transform','x','y','width','height','points','data-frameui-source','poster'].forEach(function(name) { var value=el.getAttribute(name); if(value !== null) attributes[name]=value });
      if(el.matches('button,input,select,[role="button"],[data-component],[data-frameui-component],iframe,frame')) {
        var path=[]; var cursor=el;
        while(cursor && cursor.parentElement && cursor!==document.documentElement){
          var index=Array.prototype.indexOf.call(cursor.parentElement.children,cursor)+1
          path.unshift(cursor.tagName.toLowerCase()+':nth-child('+index+')')
          cursor=cursor.parentElement
        }
        attributes.captureSelector='html>'+path.join('>')
      }
      if(el.tagName === 'A') attributes.href=el.href;
      if(el.tagName === 'IMG') attributes.src=el.currentSrc || el.src;
      var capturedTag = el.tagName.toLowerCase();
      if (el.tagName === 'CANVAS') { try { attributes.src = el.toDataURL('image/png'); capturedTag = 'img' } catch (_) { /* Tainted canvases remain in the screenshot. */ } }
      // \`background-image\` can be a comma-separated list of layers (e.g.
      // an image with a gradient overlay: \`url(...), linear-gradient(...)\`)
      // — split on top-level commas (respecting nested parens) rather than
      // anchoring a regex on the whole value, so the image layer is found
      // even when it isn't the only one.
      var bgLayers=[],bgDepth=0,bgStart=0;
      for(var bgIndex=0;bgIndex<computed.backgroundImage.length;bgIndex++){
        var bgChar=computed.backgroundImage[bgIndex];
        if(bgChar==='(')bgDepth++;else if(bgChar===')')bgDepth--;
        else if(bgChar===','&&bgDepth===0){bgLayers.push(computed.backgroundImage.slice(bgStart,bgIndex).trim());bgStart=bgIndex+1}
      }
      bgLayers.push(computed.backgroundImage.slice(bgStart).trim());
      for(var bgLayerIndex=0;bgLayerIndex<bgLayers.length;bgLayerIndex++){
        var backgroundMatch=bgLayers[bgLayerIndex].match(/^url\\(["']?([^"')]+)["']?\\)$/);
        if(backgroundMatch){attributes.backgroundSrc=backgroundMatch[1];break}
      }
      if(el.matches(':disabled')) attributes.visualState='Disabled'; else if(el.matches(':focus')) attributes.visualState='Focus'; else if(el.matches(':active')) attributes.visualState='Pressed';
      return {
        attributes: attributes,
        tag: capturedTag,
        classes: classes,
        textPreview: undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        styles: stylesOf(computed),
        aria: ariaOf(el),
        componentHint: el.getAttribute('data-component') || el.getAttribute('data-frameui-component') || undefined,
        children: children,
      }
    } catch (err) {
      return null
    }
  }

  var captured = convert(document.body, 1)
  if (captured) { captured.rect.height = Math.max(captured.rect.height, innerHeight); captured.rect.width = Math.max(captured.rect.width, innerWidth) }
  return captured || {
    tag: 'body',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    styles: {},
    children: [],
  }
})()
`

/** Installs a deliberately narrow recorder inside the guest page. It never
 * reads input values, keystrokes, scroll position, or pointer movement. */
export const START_JOURNEY_RECORDING_SCRIPT = `
(function () {
  if (window.__frameuiJourneyRecorder) return true
  var events = []
  var lastUrl = location.href
  function labelFor(el) {
    if (!el || !el.closest) return undefined
    var target = el.closest('button,a,[role="button"],input[type="submit"],summary,label') || el
    var label = target.getAttribute && (target.getAttribute('aria-label') || target.getAttribute('title'))
    if (!label) label = (target.textContent || '').replace(/\\s+/g, ' ').trim()
    if (!label && target.getAttribute) label = target.getAttribute('name') || target.tagName.toLowerCase()
    return label ? label.slice(0, 160) : undefined
  }
  function push(type, label) {
    var item = { type: type, url: location.href, at: Date.now(), elementLabel: label }
    events.push(item)
    try {
      var buffered = JSON.parse(sessionStorage.getItem('__frameuiJourneyEvents') || '[]')
      buffered.push(item)
      sessionStorage.setItem('__frameuiJourneyEvents', JSON.stringify(buffered.slice(-200)))
    } catch (_) {}
  }
  function onClick(event) { push('click', labelFor(event.target)) }
  function onSubmit(event) { push('submit', labelFor(event.submitter || event.target)) }
  function onPop() { push('back') }
  document.addEventListener('click', onClick, true)
  document.addEventListener('submit', onSubmit, true)
  window.addEventListener('popstate', onPop)
  try {
    var carried = JSON.parse(sessionStorage.getItem('__frameuiJourneyEvents') || '[]')
    if (Array.isArray(carried)) events = carried.slice(-200)
    sessionStorage.removeItem('__frameuiJourneyEvents')
  } catch (_) {}
  push('navigate')
  var timer = setInterval(function () { if (location.href !== lastUrl) { lastUrl = location.href; push('navigate') } }, 300)
  var overlaySelector = '[role="dialog"],[aria-modal="true"],.modal,.drawer,[class*="modal"],[class*="drawer"]'
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      Array.prototype.forEach.call(mutation.addedNodes, function (node) {
        if (!node || node.nodeType !== 1) return
        var match = node.matches(overlaySelector) ? node : node.querySelector(overlaySelector)
        if (match) push((String(match.className).toLowerCase().indexOf('drawer') >= 0) ? 'open-drawer' : 'open-modal', labelFor(match))
      })
      Array.prototype.forEach.call(mutation.removedNodes, function (node) {
        if (!node || node.nodeType !== 1) return
        var match = node.matches(overlaySelector) ? node : node.querySelector(overlaySelector)
        if (match) push((String(match.className).toLowerCase().indexOf('drawer') >= 0) ? 'close-drawer' : 'close-modal', labelFor(match))
      })
    })
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.__frameuiJourneyRecorder = {
    take: function () { var batch = events.slice(); events.length = 0; try { sessionStorage.removeItem('__frameuiJourneyEvents') } catch (_) {} return batch },
    stop: function () { clearInterval(timer); observer.disconnect(); document.removeEventListener('click', onClick, true); document.removeEventListener('submit', onSubmit, true); window.removeEventListener('popstate', onPop); var batch = events.slice(); events.length = 0; try { sessionStorage.removeItem('__frameuiJourneyEvents') } catch (_) {} delete window.__frameuiJourneyRecorder; return batch }
  }
  return true
})()
`

export const TAKE_JOURNEY_RECORDING_EVENTS_SCRIPT = `(window.__frameuiJourneyRecorder && window.__frameuiJourneyRecorder.take()) || []`
export const STOP_JOURNEY_RECORDING_SCRIPT = `(window.__frameuiJourneyRecorder && window.__frameuiJourneyRecorder.stop()) || []`

/** Wait for initial hydration/loading screens before copying the visible DOM. */
export const WAIT_FOR_CAPTURE_SCRIPT = `
(async function () {
  var deadline = Date.now() + 15000
  var lastChange = Date.now()
  var observer = new MutationObserver(function () { lastChange = Date.now() })
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  try {
    while (Date.now() < deadline) {
      var text = (document.body && document.body.innerText || '').trim()
      var loading = /^(loading|starting|please wait)([.\\s…]*)$/i.test(text)
      var busy = document.body && document.body.querySelector('[aria-busy="true"]')
      var visual = document.body && Array.from(document.body.querySelectorAll('img,svg,canvas,video')).some(function (element) { var rect = element.getBoundingClientRect(); return rect.width > 1 && rect.height > 1 && (element.tagName !== 'IMG' || element.complete && element.naturalWidth > 0) })
      if (document.readyState === 'complete' && (text || visual) && !loading && !busy && Date.now() - lastChange >= 350) return true
      await new Promise(function (resolve) { setTimeout(resolve, 100) })
    }
    throw new Error('This screen is still loading. Wait for its content, then try again.')
  } finally { observer.disconnect() }
})()
`

/** Shared body for the scroll-to-settle scripts below — runs `scrollCommand`,
 * then waits (capped at `maxWaitMs`) for DOM mutation quiescence and any
 * newly-visible `<img>` to finish loading, and returns the settled
 * `scrollHeight` and whether the viewport reached the bottom. Only ever used with numeric/fixed scroll commands built by
 * this file, never with page-supplied input. */
function waitAfterScrollScript(scrollCommand: string, maxWaitMs: number, quietWindowMs: number): string {
  return `
(async function () {
  ${scrollCommand}
  var deadline = Date.now() + ${maxWaitMs}
  var lastChange = Date.now()
  var observer = new MutationObserver(function () { lastChange = Date.now() })
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  try {
    while (Date.now() < deadline) {
      var imagesLoading = Array.from(document.querySelectorAll('img')).some(function (img) {
        var rect = img.getBoundingClientRect()
        return rect.width > 1 && rect.height > 1 && rect.top < innerHeight && rect.bottom > 0 && !img.complete
      })
      var animationsRunning = document.getAnimations().some(function (animation) {
        return animation.playState === 'running' && animation.effect && Number.isFinite(animation.effect.getComputedTiming().endTime)
      })
      // GSAP uses requestAnimationFrame rather than the Web Animations API.
      // Wait for finite active tweens; looping decorations must not stall capture.
      var gsapRunning = window.gsap && window.gsap.globalTimeline && window.gsap.globalTimeline.getChildren(true, true, false).some(function (tween) {
        return tween.isActive() && tween.repeat() !== -1
      })
      if (!imagesLoading && !animationsRunning && !gsapRunning && document.fonts.status !== 'loading' && Date.now() - lastChange >= ${quietWindowMs}) break
      await new Promise(function (resolve) { setTimeout(resolve, 50) })
    }
  } finally { observer.disconnect() }
  var height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
  return { height: height, bottom: window.scrollY + innerHeight >= height - 2 }
})()
`
}

/** Scrolls down by `stepPx` to trigger lazy/`IntersectionObserver` content
 * below the fold, waits for it to settle, and returns the new
 * `scrollHeight` so the caller can tell whether more content appeared. */
export function scrollStepScript(stepPx: number, maxWaitMs: number, quietWindowMs: number): string {
  return waitAfterScrollScript(`window.scrollBy({left: 0, top: ${stepPx}, behavior: "instant"})`, maxWaitMs, quietWindowMs)
}

/** Returns the page to its original top scroll position, waiting for the
 * same quiescence signal — every downstream capture step assumes this. */
export function scrollToTopScript(maxWaitMs: number, quietWindowMs: number): string {
  return waitAfterScrollScript('window.scrollTo({left: 0, top: 0, behavior: "instant"})', maxWaitMs, quietWindowMs)
}
