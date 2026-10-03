/**
 * Each player's colour: their cursor, their name in chat, the frame of their
 * camera, their face when the camera is off.
 *
 * Any colour is allowed, but every one — presets and custom alike — is kept
 * inside a band of lightness that reads on both the light and the dark
 * panels, so nothing anywhere needs to ask which theme it is in. The band is
 * in OKLCH, where lightness means what the eye sees: a yellow and a blue of
 * the same L look equally light, which HSL cannot promise. Hue is kept,
 * chroma is trimmed if the clamped colour would fall outside sRGB.
 */

var L_MIN = 0.62
var L_MAX = 0.74
var C_MIN = 0.09 // a little colour at least: greys read as nobody's

const RAW = ['#ff5d8f', '#f2533f', '#ff8f2e', '#d9a21b', '#5cbc3c', '#17ab94', '#2fa4e6', '#4e7cf0', '#9a72f2', '#d65fd0']

/** The colours on offer before anyone picks a custom one. */
export const PRESETS = RAW.map((hex) => clampColour(hex))

/** A colour someone chose, brought inside the readable band. */
export function clampColour(hex) {
  const rgb = parse(hex)
  if (!rgb) return '#ff5d8f'
  let [L, C, h] = toOklch(rgb)
  L = Math.min(L_MAX, Math.max(L_MIN, L))
  C = Math.max(C_MIN, C)
  // Trim chroma until the colour exists in sRGB.
  for (let i = 0; i < 40; i++) {
    const out = fromOklch([L, C, h])
    if (out.every((v) => v >= -0.0005 && v <= 1.0005)) return hexOf(out)
    C *= 0.94
  }
  return hexOf(fromOklch([L, 0, h]))
}

/** A stable colour for someone who never chose one: their id, hashed. */
export function colourFor(id = '') {
  let x = 2166136261
  for (let i = 0; i < id.length; i++) {
    x ^= id.charCodeAt(i)
    x = Math.imul(x, 16777619)
  }
  return PRESETS[(x >>> 0) % PRESETS.length]
}

// ---------------------------------------------------------------- the maths

function parse(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
}

function toLinear(v) { return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
function toGamma(v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055 }

function toOklch(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}

function fromOklch([L, C, h]) {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return [r, g, b].map(toGamma)
}

function hexOf(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
}

// ------------------------------------------------------------------ picker

/**
 * The small popup for choosing a colour, used on the landing page and in
 * the settings alike: the presets, and a custom one, every choice clamped.
 * `onPick` is called with the colour as it will actually be shown.
 */
export function colourPicker({ value, onPick }) {
  const el = document.createElement('div')
  el.className = 'colour-picker'
  const render = (current) => {
    el.innerHTML = `
      <div class="swatches">
        ${PRESETS.map((c) => `<button type="button" class="swatch" data-colour="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${c === current}"></button>`).join('')}
        <label class="swatch custom" title="any colour" aria-pressed="${!PRESETS.includes(current)}" style="${PRESETS.includes(current) ? '' : `background:${current}`}">
          <input type="color" value="${current}" aria-label="any colour">
        </label>
      </div>`
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-colour]')
    if (!b) return
    onPick(b.dataset.colour)
    render(b.dataset.colour)
  })
  el.addEventListener('input', (e) => {
    if (e.target.type !== 'color') return
    const c = clampColour(e.target.value)
    e.target.closest('.custom').style.background = c
    onPick(c)
  })
  el.addEventListener('change', (e) => { if (e.target.type === 'color') render(clampColour(e.target.value)) })
  render(value)
  return el
}

/**
 * A swatch that opens the colour picker beneath it: the same small popup on
 * the landing page and in the settings.
 */
export function colourButton({ value, onPick, label = 'your colour' }) {
  const wrap = document.createElement('span')
  wrap.className = 'colour-anchor'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'colour-button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-expanded', 'false')
  button.style.setProperty('--c', value)
  const pop = document.createElement('div')
  pop.className = 'popover colour-pop'
  pop.hidden = true
  wrap.append(button, pop)

  let current = value
  const toggle = (open = pop.hidden) => {
    if (open) pop.replaceChildren(colourPicker({ value: current, onPick: pick }))
    pop.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }
  const pick = (c) => {
    current = c
    button.style.setProperty('--c', c)
    onPick(c)
  }
  button.addEventListener('click', (e) => { e.stopPropagation(); toggle() })
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !wrap.contains(e.target)) toggle(false) })
  return wrap
}
