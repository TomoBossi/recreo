/**
 * recreo's mark: a recess bell, drawn from shapes like everything else —
 * a red dome with its bolt, the box it hangs on, and the striker's arm
 * curling up to a knob. It sits beside the wordmark, and is the page's icon.
 */

const INK = '#241c3a'

/**
 * The bell's shapes in a 64 × 64 box. `shadow` draws its silhouette once
 * more, offset, in the colour CSS gives --drop, as the wordmark's lettering
 * has; `line` is the outline's width.
 */
function bell({ shadow = true, line = 3.5, detail = true, knob = 5, reach = 1 } = {}) {
  const arm = 'M43 49 C 55 49, 57 38, 56.5 25'
  const armWidth = (line + 1) * reach
  const shapes = (fill, stroke) => `
    <path d="${arm}" fill="none" stroke="${stroke ?? fill}" stroke-width="${armWidth}" stroke-linecap="round"/>
    <circle cx="56.5" cy="22" r="${knob}" fill="${fill}"/>
    <rect x="13" y="38" width="31" height="19" rx="5" fill="${fill}"/>
    <circle cx="28.5" cy="27" r="21" fill="${fill}"/>`
  return `
    ${shadow ? `<g class="bell-drop" transform="translate(3 3)">${shapes('var(--drop, #241c3a)')}</g>` : ''}
    <path d="${arm}" fill="none" stroke="${INK}" stroke-width="${armWidth}" stroke-linecap="round"/>
    <circle cx="56.5" cy="22" r="${knob}" fill="#ffd23f" stroke="${INK}" stroke-width="${line}"/>
    <rect x="13" y="38" width="31" height="19" rx="5" fill="#9a7bf2" stroke="${INK}" stroke-width="${line}"/>
    ${detail ? `<path class="vents" d="M21 46.5 V51.5 M28.5 46.5 V51.5 M36 46.5 V51.5" stroke="${INK}" stroke-width="${line * 0.85}" stroke-linecap="round"/>` : ''}
    <circle cx="28.5" cy="27" r="21" fill="#ff5d6c" stroke="${INK}" stroke-width="${line}"/>
    ${detail ? `<path d="M14.5 21 A 15.5 15.5 0 0 1 25 12.3" fill="none" stroke="#fff" stroke-width="${line}" stroke-linecap="round" opacity="0.75"/>` : ''}
    <circle cx="28.5" cy="27" r="6" fill="#ffd23f" stroke="${INK}" stroke-width="${line}"/>`
}

/** The bell beside the wordmark. */
export const BELL = `<svg class="bell" viewBox="-1 -1 68 68" aria-hidden="true">${bell()}</svg>`

/**
 * The page's icon: at sixteen pixels the details only blur, so it keeps the
 * shapes that say "bell" — dome, bolt, box, a thick arm and a big knob —
 * with bolder lines and no shadow, cropped close.
 */
export function setPageIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4.5 1.5 61 61">${bell({ shadow: false, line: 5, detail: false, knob: 6.5, reach: 1.25 })}</svg>`
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.append(link)
  }
  link.type = 'image/svg+xml'
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}
