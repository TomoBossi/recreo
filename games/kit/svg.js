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
 * The board: an SVG sized to whatever room the window gives it, keeping its
 * shape, with one group inside — the board's own space — that a game draws
 * into in its own coordinates, the same for everyone.
 *
 *   const b = board(el, { width: 800, height: 800, pad: 6, className: 'chess' })
 *   b.space.innerHTML = …          // draw in board coordinates, 0…width, 0…height
 *   b.point(e)                     // where a pointer event lands, in board coordinates
 *   b.turn(180)                    // show the board turned round: black's view in chess
 *   b.upright(x, y)                // a transform that keeps a label at (x, y) reading upright
 *   b.svg                          // the root, for layers that never turn
 *   b.margin({ top, right, bottom, left })  // room round the board for those layers
 *
 * The space group is marked data-cursor-space, so pointers travel in board
 * coordinates and land on the same square for everyone, whichever way each
 * of them sees the board.
 *
 * fit: true lets a board that is wider than tall stand on end when the
 * stage is the other shape — a course on a phone held upright — turning a
 * quarter so that its left edge is at the bottom. onTurn(angle) is called
 * whenever the angle changes, for a game that keeps labels upright.
 */
export function board(el, { width, height, pad = 0, className = '', fit = false, onTurn = null }) {
  const svg = shape('svg', { class: className })
  const space = shape('g', { 'data-cursor-space': '' })
  svg.append(space)
  el.append(svg)

  let chosen = 0        // the game's own turn: 0 or 180
  let standing = false  // turned a quarter to suit the stage
  let angle = -1
  let room = { top: 0, right: 0, bottom: 0, left: 0 }

  const frame = () => {
    const sideways = angle % 180 !== 0
    const w = sideways ? height : width
    const h = sideways ? width : height
    const { top, right, bottom, left } = room
    svg.setAttribute('viewBox', `${-pad - left} ${-pad - top} ${w + 2 * pad + left + right} ${h + 2 * pad + top + bottom}`)
  }
  const apply = () => {
    const next = (chosen + (standing ? 270 : 0)) % 360
    if (next === angle) return
    angle = next
    frame()
    // Each turn maps the board onto the viewBox's 0…w, 0…h.
    const transforms = {
      0: '',
      90: `translate(${height} 0) rotate(90)`,
      180: `translate(${width} ${height}) rotate(180)`,
      270: `translate(0 ${width}) rotate(-90)`,
    }
    if (transforms[angle]) space.setAttribute('transform', transforms[angle])
    else space.removeAttribute('transform')
    if (ready) onTurn?.(angle)
  }
  let ready = false
  apply()
  ready = true

  if (fit && width > height) {
    // Stand on end when that makes the board clearly bigger, and back when
    // it no longer does: a margin either way, so a window being resized
    // near the line does not flip back and forth.
    new ResizeObserver(() => {
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) return
      const flat = Math.min(box.width / width, box.height / height)
      const upright = Math.min(box.width / height, box.height / width)
      const want = standing ? upright > flat : upright > flat * 1.2
      if (want !== standing) { standing = want; apply() }
    }).observe(el)
  }

  return {
    svg,
    space,
    width,
    height,
    get angle() { return angle },
    turn(deg) { chosen = ((deg % 360) + 360) % 360; apply() },
    margin(m = {}) { room = { top: 0, right: 0, bottom: 0, left: 0, ...m }; frame() },
    point: (e) => pointIn(space, e),
    upright: (x, y) => (angle ? `rotate(${-angle} ${x} ${y})` : ''),
  }
}

/** Where a pointer event lands, in an SVG element's own coordinates. */
export function pointIn(node, e) {
  const ctm = node.getScreenCTM()
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
