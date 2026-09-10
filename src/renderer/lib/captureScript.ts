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
  var MAX_NODES = 500
  var MAX_DEPTH = 30
  var MAX_TEXT_PREVIEW = 60
  var NON_VISUAL_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, TITLE: 1 }
  var count = 0

  // Box/layout, Flexbox, Grid, spacing, typography, visual — a curated
  // allowlist answering real design questions, not every computed style.
  var STYLE_PROPERTIES = [
    'display', 'position', 'boxSizing', 'overflow',
    'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent', 'gap',
    'gridTemplateColumns', 'gridTemplateRows', 'gridAutoFlow',
    'padding', 'margin',
    'color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'textAlign',
    'backgroundColor', 'backgroundImage', 'borderRadius', 'borderColor', 'borderStyle', 'borderWidth', 'boxShadow', 'opacity', 'zIndex', 'fill', 'stroke',
  ]

  function textPreviewOf(el) {
    if (el.matches && el.matches('input,textarea,select,[contenteditable="true"]')) return undefined
    var text = ''
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i]
      if (node.nodeType === 3) text += node.textContent || ''
    }
    text = text.replace(/\\s+/g, ' ').trim()
    if (!text) return undefined
    if (/(?:bearer\\s+[a-z0-9._-]+|api[_-]?key|password|secret|card\\s*number|\\b\\d{13,19}\\b)/i.test(text)) return '[redacted]'
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
      if (attr.name.indexOf('aria-') === 0 && !/(?:value|token|secret)/i.test(attr.name)) aria[attr.name] = /(?:bearer\\s+|api[_-]?key|password|secret|card\\s*number|\\b\\d{13,19}\\b)/i.test(attr.value) ? '[redacted]' : attr.value
    }
    if (el.tagName === 'IMG') {
      var alt = el.getAttribute('alt')
      if (alt !== null) aria.alt = /(?:bearer\\s+|api[_-]?key|password|secret|card\\s*number|\\b\\d{13,19}\\b)/i.test(alt) ? '[redacted]' : alt
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
      var children = []
      for (var i = 0; i < el.children.length; i++) {
        var child = convert(el.children[i], depth + 1)
        if (child) children.push(child)
      }
      var classes = typeof el.className === 'string' && el.className ? el.className : undefined
      var attributes = {}; ['src','alt','placeholder','type','viewBox','d','fill','stroke','cx','cy','r','x','y','width','height','points'].forEach(function(name) { var value=el.getAttribute(name); if(value !== null) attributes[name]=value });
      if(el.tagName === 'IMG') attributes.src=el.currentSrc || el.src;
      return {
        attributes: attributes,
        tag: el.tagName.toLowerCase(),
        classes: classes,
        textPreview: children.length === 0 ? textPreviewOf(el) : undefined,
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

  return convert(document.body, 1) || {
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
