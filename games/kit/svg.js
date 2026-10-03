/**
 * Drawing a game from shapes. Every game in recreo is SVG built from basic
 * shapes; these are the few helpers they all end up wanting.
 */

export const NS = 'http://www.w3.org/2000/svg'

/** An SVG element with attributes: shape('circle', { cx: 5, cy: 5, r: 4 }). */
export function shape(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  for (const child of children) node.append(child)
  return node
}

/**
 * The board's SVG, sized to whatever room the window gives it, keeping its
 * shape. Mount it into the stage element a view is given.
 */
export function board(el, { viewBox, className = '' }) {
  const svg = shape('svg', { viewBox, class: className })
  el.append(svg)
  return svg
}

/** Where a pointer event lands, in the SVG's own coordinates. */
export function pointIn(svg, e) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** Text that is safe to put into markup. */
export function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/** The outline every shape in recreo wears. */
export const INK = '#241c3a'
export const PAPER = '#fffaf0'
