/**
 * The pointer recreo draws: everyone's cursor is this arrow in their colour,
 * and on devices with a mouse your own pointer is drawn the same way, so you
 * see yourself as the others see you.
 */

const MOVING_MS = 220

/** The cursor everyone sees, in one player's colour. */
export function arrow(colour) {
  return `<svg class="arrow" viewBox="0 0 24 28" width="22" height="26" aria-hidden="true"><path d="M2 2 L2 22 L8 16 L12 26 L16 24 L12 14 L20 14 Z"
    fill="${colour}" stroke="#241c3a" stroke-width="2.2" stroke-linejoin="round"/></svg>`
}

/** The other shapes your own pointer takes: a text caret, and resize arrows. */
const TEXT = `<svg viewBox="0 0 24 28" width="22" height="26" aria-hidden="true">
  <path d="M8 3 h8 M12 3 v22 M8 25 h8" fill="none" stroke="#241c3a" stroke-width="5" stroke-linecap="round"/>
  <path d="M8 3 h8 M12 3 v22 M8 25 h8" fill="none" stroke="#fffaf0" stroke-width="2" stroke-linecap="round"/></svg>`
const RESIZE = `<svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true"><path d="M3 14 L9 8 V12 H19 V8 L25 14 L19 20 V16 H9 V20 Z"
  fill="#fffaf0" stroke="#241c3a" stroke-width="2" stroke-linejoin="round"/></svg>`

/** What shape the pointer should take over an element. */
function shapeAt(target) {
  if (!(target instanceof Element)) return 'arrow'
  if (target.closest('input:not([type=checkbox]):not([type=color]):not([type=file]), textarea, [contenteditable]')) return 'text'
  if (target.closest('.gutter')) return 'resize-col'
  if (target.closest('.hgutter')) return 'resize-row'
  const c = target.closest('.win')?.style.cursor
  if (c === 'nwse-resize') return 'resize-nwse'
  if (c === 'nesw-resize') return 'resize-nesw'
  return 'arrow'
}

/**
 * Draw your own pointer, on devices that have one. `colour` is asked each
 * time it is drawn, so a new colour shows at once.
 */
export function ownCursor({ colour }) {
  if (!matchMedia('(pointer: fine)').matches) return { recolour() {} }
  const el = document.createElement('div')
  el.className = 'cursor own'
  el.hidden = true
  document.body.append(el)
  document.documentElement.classList.add('own-cursor')
  let still = null
  let shape = null

  const draw = (next, force = false) => {
    if (next === shape && !force) return
    shape = next
    el.innerHTML = next === 'arrow' ? arrow(colour()) : next === 'text' ? TEXT : RESIZE
    el.dataset.shape = next
    el.style.setProperty('--turn', `${{ 'resize-row': 90, 'resize-nwse': 45, 'resize-nesw': -45 }[next] ?? 0}deg`)
  }

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    el.hidden = false
    draw(shapeAt(e.target))
    el.style.setProperty('--x', `${e.clientX}px`)
    el.style.setProperty('--y', `${e.clientY}px`)
    el.classList.add('moving')
    clearTimeout(still)
    still = setTimeout(() => el.classList.remove('moving'), MOVING_MS)
  }, { passive: true })
  document.documentElement.addEventListener('mouseleave', () => { el.hidden = true })

  return { recolour: () => draw(shape ?? 'arrow', true) }
}
