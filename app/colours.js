/**
 * Each player's colour: their cursor, their name in chat, the frame of their
 * camera, their face when the camera is off.
 *
 * Only some colours are allowed: every one — presets and custom alike — sits
 * inside a band of lightness that reads on both the light and the dark
 * panels, so nothing anywhere needs to ask which theme it is in. The band is
 * in OKLCH, where lightness means what the eye sees: a yellow and a blue of
 * the same L look equally light, which HSL cannot promise. Hue is kept,
 * chroma is trimmed if the clamped colour would fall outside sRGB.
 */

var L_MIN = 0.62
var L_MAX = 0.74
var C_MIN = 0.09 // a little colour at least: greys read as nobody's
var C_PAD = 0.17 // how vivid the custom pad's colours are, where sRGB allows

const RAW = ['#ff5d8f', '#f2533f', '#ff8f2e', '#d9a21b', '#5cbc3c', '#17ab94', '#2fa4e6', '#4e7cf0', '#9a72f2', '#d65fd0']

/** The colours on offer before anyone picks a custom one. */
export const PRESETS = RAW.map((hex) => clampColour(hex))

/** A colour someone chose, brought inside the readable band. */
export function clampColour(hex) {
  const rgb = parse(hex)
  if (!rgb) return '#ff5d8f'
  let [L, C, h] = toOklch(rgb)
  // Already inside the band (a preset, or a pick from the pad): keep it exactly.
  if (L >= L_MIN - 0.003 && L <= L_MAX + 0.003 && C >= C_MIN - 0.003) return hexOf(rgb)
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

/** A colour in the band from a hue (degrees) and a lightness, as vivid as sRGB allows. */
export function bandColour(hue, L) {
  const h = (hue * Math.PI) / 180
  const lightness = Math.min(L_MAX, Math.max(L_MIN, L))
  let lo = 0
  let hi = C_PAD
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (fromOklch([lightness, mid, h]).every((v) => v >= -0.0005 && v <= 1.0005)) lo = mid
    else hi = mid
  }
  return hexOf(fromOklch([lightness, lo, h]))
}

/** A colour's OKLCH lightness and chroma. */
export function oklch(hex) {
  const [L, C] = toOklch(parse(hex) ?? [0, 0, 0])
  return { L, C }
}

/** Where a colour sits on the custom pad: its hue in degrees and its lightness. */
function padPlace(hex) {
  const [L, , h] = toOklch(parse(hex) ?? [1, 0.36, 0.56])
  return { hue: ((h * 180) / Math.PI + 360) % 360, L: Math.min(L_MAX, Math.max(L_MIN, L)) }
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
 * the settings alike: the presets, and a pad for any other colour. The pad
 * is drawn from the readable band itself — hue across, lightness down — so
 * there is nothing on it that would not read on both themes.
 * `onPick` is called with the colour as it will be shown.
 */
export function colourPicker({ value, onPick }) {
  const el = document.createElement('div')
  el.className = 'colour-picker'
  el.innerHTML = `
    <div class="swatches">
      ${PRESETS.map((c) => `<button type="button" class="swatch" data-colour="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
    </div>
    <div class="pad" role="slider" aria-label="any colour" tabindex="0">
      <canvas></canvas><span class="thumb"></span>
    </div>`
  const pad = el.querySelector('.pad')
  const canvas = pad.querySelector('canvas')
  const thumb = pad.querySelector('.thumb')
  let current = value

  // Paint the band once, at the pad's own resolution.
  const W = 180
  const H = 40
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  const img = g.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hex = bandColour((x / (W - 1)) * 360, L_MAX - (y / (H - 1)) * (L_MAX - L_MIN))
      const n = parseInt(hex.slice(1), 16)
      const i = (y * W + x) * 4
      img.data[i] = n >> 16
      img.data[i + 1] = (n >> 8) & 255
      img.data[i + 2] = n & 255
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)

  const show = () => {
    for (const b of el.querySelectorAll('.swatch')) b.setAttribute('aria-pressed', String(b.dataset.colour === current))
    const custom = !PRESETS.includes(current)
    thumb.hidden = !custom
    if (custom) {
      const { hue, L } = padPlace(current)
      thumb.style.left = `${(hue / 360) * 100}%`
      thumb.style.top = `${((L_MAX - L) / (L_MAX - L_MIN)) * 100}%`
      thumb.style.background = current
    }
  }
  const choose = (c) => { current = c; show(); onPick(c) }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-colour]')
    if (b) choose(b.dataset.colour)
  })
  const fromPointer = (e) => {
    const box = pad.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
    choose(bandColour(fx * 360, L_MAX - fy * (L_MAX - L_MIN)))
  }
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    pad.setPointerCapture(e.pointerId)
    fromPointer(e)
    const move = (ev) => fromPointer(ev)
    const up = () => { pad.removeEventListener('pointermove', move); pad.removeEventListener('pointerup', up) }
    pad.addEventListener('pointermove', move)
    pad.addEventListener('pointerup', up)
  })
  // Arrow keys walk the pad: left and right for hue, up and down for lightness.
  pad.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 0.01], ArrowDown: [0, -0.01] }[e.key]
    if (!step) return
    e.preventDefault()
    const { hue, L } = padPlace(current)
    choose(bandColour((hue + step[0] + 360) % 360, L + step[1]))
  })
  show()
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
