/**
 * The roster: characters a player can be when their camera is off. Each is a
 * bust drawn from shapes on a coloured disc, cartoon style: thick ink
 * outlines, flat colours with a darker side and a shine, big eyes, and one
 * thing that makes it who it is.
 *
 * Every character draws in a 100 × 100 box, on a disc centred at (50, 57):
 *
 *   character('glorp')                     // -> a whole <svg>
 *   character('glorp', { bg: '#ff6b9a' })  // -> on a disc of that colour
 *
 * ROSTER holds every drawing, finished or not (tools/roster/ shows them all
 * for review); PLAYABLE says which of them players can be.
 */

/**
 * The characters players can be, in the order they are offered. Each id
 * names a drawing in ROSTER below: to add a character to the game, draw it
 * there and put its id here.
 */
export const PLAYABLE = ['glorp', 'dingding', 'moai', 'sus', 'skull', 'villager', 'bot', 'capy', 'tux', 'saturn', 'glep', 'cheese', 'squid', 'monty', 'frog']

const INK = '#241c3a'
const W = 3.5 // the outline every shape wears
const TONGUE = '#ff5d7a'
const BLUSH = '#ff7d9c'
const WHITE = '#ffffff'

/** Mix two #rrggbb colours: t = 0 is a, t = 1 is b. */
function mix(a, b, t) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [rgb(a), rgb(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}
/** The darker side of a colour. */
const shadow = (c) => mix(c, '#2a1650', 0.24)

// --------------------------------------------------------------- shapes
// Shapes are bare elements; the kit paints them.

const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`
const E = (cx, cy, rx, ry, rot = 0) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`
const R = (x, y, w, h, r = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`
const P = (d) => `<path d="${d}"/>`
const DISC = C(50, 57, 41)
/** The disc's bottom half and everything above it: heads may rise out of the disc but not hang below it. */
const TOPDISC = P('M-10 -10 L110 -10 L110 57 L91 57 A41 41 0 0 1 9 57 L-10 57 Z')

/** Shading that leaves the darker band along a shape's bottom edge. */
const DOWN = [0, -6]

const paint = (shape, attrs) => shape.replace(/\s*\/>\s*$/, ` ${attrs}/>`)
const ink = (w = W, colour = INK) => `stroke="${colour}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`

/**
 * The disc's border: just outside it and under the character, so whatever is
 * cut off by the disc meets its inside edge and whatever rises out of the
 * disc passes over it. It shows RING_W wide but reaches further in, under the
 * disc and the bodies, so where they meet it there is ink behind the seam and
 * the page can't show through it.
 */
const RING_W = 2.4
const RING_UNDER = 1.5
const RING = paint(C(50, 57, 41 + (RING_W - RING_UNDER) / 2), `fill="none" ${ink(RING_W + RING_UNDER)}`)
// The disc's colour stops just short of where bodies are cut, so their soft
// edges have only ink behind them, not a hairline of the disc's colour.
const DISC_INSET = 0.6

let serial = 0

/** The drawing kit, one per drawing, so clip ids never collide on a page. */
function kit() {
  const uid = `rc${++serial}`
  let n = 0

  const fill = (shape, colour, extra = '') => paint(shape, `fill="${colour}" ${extra}`)
  const line = (d, w = W, colour = INK) => `<path d="${d}" fill="none" ${ink(w, colour)}/>`
  const clip = (shape, inside) => {
    const id = `${uid}-${n++}`
    return `<clipPath id="${id}">${shape}</clipPath><g clip-path="url(#${id})">${inside}</g>`
  }

  /**
   * A shape filled, shaded and outlined: the darker side shows down and to
   * the left, and `inside` is drawn within the shape, under its outline.
   */
  function part(shape, colour, { inside = '', shade = [2.5, -4.5], dark = shadow(colour), w = W } = {}) {
    const lit = shade ? `<g transform="translate(${shade[0]} ${shade[1]})">${fill(shape, colour)}</g>` : ''
    return fill(shape, shade ? dark : colour)
      + (lit || inside ? clip(shape, lit + inside) : '')
      + (w ? paint(shape, `fill="none" ${ink(w)}`) : '')
  }

  /**
   * A chubby torso, cut off by the disc: round shoulders, arms marked by two
   * lines, and the shadow the head casts on it.
   */
  function torso(colour, { w = 34, top = 72, inside = '', arms = true, cast = 22 } = {}) {
    const shape = P(`M${50 - w} 108 L${50 - w} ${top + 16} C${50 - w} ${top + 3} ${50 - w * 0.55} ${top} 50 ${top} C${50 + w * 0.55} ${top} ${50 + w} ${top + 3} ${50 + w} ${top + 16} L${50 + w} 108 Z`)
    const arm = (s) => `M${50 + s * w * 0.56} ${top + 12} C${50 + s * w * 0.63} ${top + 22} ${50 + s * w * 0.58} ${top + 30} ${50 + s * w * 0.5} 108`
    return clip(DISC, part(shape, colour, {
      inside: (cast ? fill(E(50, top + 1, cast, 6), shadow(colour)) : '') + inside + (arms ? line(`${arm(-1)} ${arm(1)}`, 3) : ''),
    }))
  }

  /**
   * A small bust under a big head: a neck spreading into shoulders that the
   * disc cuts off, the head's shadow on them (pass the head's shape), and two
   * short strokes for arms.
   */
  function bust(colour, { head = null, top = 65.6, inside = '', arms = true, armTop = 84 } = {}) {
    const shape = P(`M35.9 ${top} C20 ${top + 2} 16 ${top + 14.4} 16 ${top + 14.4} L12 110 L88 110 L84 ${top + 14.4} C84 ${top + 14.4} 80 ${top + 2} 64.1 ${top} Z`)
    const cast = head ? `<g transform="translate(0 5)">${fill(head, shadow(colour))}</g>` : ''
    return clip(DISC, part(shape, colour, { shade: false, inside: cast + inside + (arms ? line(`M30 ${armTop} L${30 - (100 - armTop) * 0.09} 100 M70 ${armTop} L${70 + (100 - armTop) * 0.09} 100`, 3) : '') }))
  }

  // ------------------------------------------------------------- faces

  /**
   * A big eye: white, a pupil, two glints. `look` moves the pupil (-1..1);
   * `lid` draws a lid down over that much of it, tilted by `tilt` degrees.
   */
  function eye(cx, cy, r = 8, { look = [0, 0.2], pupil = 0.56, lid = 0, lidFill = WHITE, tilt = 0, iris = null } = {}) {
    const px = cx + look[0] * r * (1 - pupil) * 0.9
    const py = cy + look[1] * r * (1 - pupil) * 0.9
    const pr = r * pupil
    let inside = (iris ? fill(C(px, py, pr * 1.35), iris) : '')
      + fill(C(px, py, pr), INK)
      + fill(C(px - pr * 0.38, py - pr * 0.38, pr * 0.34), WHITE)
      + fill(C(px + pr * 0.4, py + pr * 0.35, pr * 0.15), WHITE)
    if (lid) {
      const y = cy - r + 2 * r * lid
      inside += `<g transform="rotate(${tilt} ${cx} ${cy})">${fill(R(cx - r - 3, cy - r - 3, 2 * r + 6, y - cy + r + 3), lidFill)}${line(`M${cx - r - 3} ${y} L${cx + r + 3} ${y}`, 3)}</g>`
    }
    return part(C(cx, cy, r), WHITE, { inside, shade: false, w: 3 })
  }

  /** A solid dot eye with a glint. */
  const dot = (cx, cy, r = 4.5) => fill(E(cx, cy, r, r * 1.12), INK) + fill(C(cx - r * 0.35, cy - r * 0.42, r * 0.36), WHITE)

  /** An eye shut in a happy arch (or, with `down`, a sleepy one). */
  const shut = (cx, cy, w = 6, down = false) => line(`M${cx - w} ${cy} Q${cx} ${cy + (down ? w : -w)} ${cx + w} ${cy}`)

  /** A crossed-out eye. */
  const cross = (cx, cy, r = 5) => line(`M${cx - r} ${cy - r} L${cx + r} ${cy + r} M${cx + r} ${cy - r} L${cx - r} ${cy + r}`, 4)

  const brow = (x1, y1, x2, y2, w = 4.5) => line(`M${x1} ${y1} L${x2} ${y2}`, w)

  /** An open mouth: flat on top, teeth along it, a tongue at the bottom. */
  function mouth(cx, cy, w = 10, h = 8, { teeth = true, tongue = true, lower = false } = {}) {
    const shape = P(`M${cx - w} ${cy} Q${cx} ${cy + h * 2.1} ${cx + w} ${cy} Q${cx} ${cy + h * 0.2} ${cx - w} ${cy} Z`)
    let inside = ''
    if (tongue) inside += fill(E(cx + w * 0.1, cy + h * 1.15, w * 0.6, h * 0.55), TONGUE)
    if (teeth) inside += fill(R(cx - w, cy - 3, 2 * w, h * 0.42 + 3), WHITE) + line(`M${cx - w * 0.3} ${cy} L${cx - w * 0.3} ${cy + h * 0.4} M${cx + w * 0.3} ${cy} L${cx + w * 0.3} ${cy + h * 0.4}`, 1.6)
    if (lower) inside += fill(R(cx - w * 0.5, cy + h * 0.85, w, h * 0.5), WHITE)
    return part(shape, INK, { inside, shade: false, w: 3 })
  }

  /** A wide grin full of teeth. */
  function grin(cx, cy, w = 13, h = 7, { gaps = 4 } = {}) {
    const shape = R(cx - w, cy - h / 2, 2 * w, h, h / 2)
    let lines = `M${cx - w} ${cy} L${cx + w} ${cy}`
    for (let i = 1; i < gaps; i++) lines += ` M${cx - w + (2 * w * i) / gaps} ${cy - h / 2} L${cx - w + (2 * w * i) / gaps} ${cy + h / 2}`
    return part(shape, WHITE, { inside: line(lines, 1.8), shade: false, w: 3 })
  }

  /** A smile with the tongue poking out of it. */
  function tongue(cx, cy, w = 7) {
    const t = P(`M${cx - 3.5} ${cy} L${cx - 3.5} ${cy + 6} A3.5 3.5 0 0 0 ${cx + 3.5} ${cy + 6} L${cx + 3.5} ${cy} Z`)
    return part(t, TONGUE, { shade: false, w: 2.6, inside: line(`M${cx} ${cy + 1} L${cx} ${cy + 5}`, 1.6) }) + line(`M${cx - w} ${cy - 1.5} Q${cx} ${cy + 2.5} ${cx + w} ${cy - 1.5}`, 3.2)
  }

  const smile = (cx, cy, w = 7, h = 4) => line(`M${cx - w} ${cy} Q${cx} ${cy + h * 1.6} ${cx + w} ${cy}`, 3.2)
  const blush = (cx, cy, r = 5, colour = BLUSH) => fill(E(cx, cy, r, r * 0.62), colour)
  /** A shine: a white spot and a smaller one. */
  const shine = (cx, cy, r = 3) => fill(C(cx, cy, r), WHITE) + fill(C(cx + r * 1.4, cy + r * 1.3, r * 0.45), WHITE)

  /**
   * A line that thins to nothing toward both ends, for a stroke that should
   * fade into what it meets. SVG strokes keep one width, so this one is drawn
   * as a filled shape: the curve sampled, and its sides set apart by a width
   * that eases down over the last `ends` of its length at each end (`start`
   * and `end` say which ends thin out). `d` is an M followed by C segments.
   */
  function taper(d, w = W, { ends = 0.3, start = true, end = true, to = 0, colour = INK } = {}) {
    const n = d.match(/-?\d*\.?\d+/g).map(Number)
    let [x, y] = n
    const pts = [[x, y]]
    for (let i = 2; i + 5 < n.length; i += 6) {
      const [x1, y1, x2, y2, x3, y3] = n.slice(i, i + 6)
      for (let j = 1; j <= 24; j++) {
        const t = j / 24
        const u = 1 - t
        pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3])
      }
      ;[x, y] = [x3, y3]
    }
    const at = [0]
    for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    const total = at.at(-1)
    // Thinning to nothing it eases out like a sine; thinning to another line's
    // width (`to`) it eases in and out, so it meets that line without a corner.
    const ease = to ? (v) => { const t = Math.min(1, v); return t * t * (3 - 2 * t) } : (v) => Math.sin((Math.min(1, v) * Math.PI) / 2)
    const [fromStart, toEnd] = [ends].flat().concat([ends].flat())
    const left = []
    const right = []
    pts.forEach(([px, py], i) => {
      const [ax, ay] = pts[Math.max(0, i - 1)]
      const [bx, by] = pts[Math.min(pts.length - 1, i + 1)]
      const len = Math.hypot(bx - ax, by - ay) || 1
      const half = to / 2 + ((w - to) / 2) * Math.min(start ? ease(at[i] / (fromStart * total)) : 1, end ? ease((total - at[i]) / (toEnd * total)) : 1)
      const [nx, ny] = [(-(by - ay) / len) * half, ((bx - ax) / len) * half]
      left.push(`${(px + nx).toFixed(2)} ${(py + ny).toFixed(2)}`)
      right.unshift(`${(px - nx).toFixed(2)} ${(py - ny).toFixed(2)}`)
    })
    // An end left at full width is rounded off, like any other line.
    const cap = ([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="${colour}"/>`
    return `<path d="M${left.join(' L')} L${right.join(' L')} Z" fill="${colour}"/>` + (start ? '' : cap(pts[0])) + (end ? '' : cap(pts.at(-1)))
  }

  /** An arm, leg, stalk or tentacle: a thick line with an outline. */
  const limb = (d, colour, w = 10) => line(d, w, INK) + line(d, w - 6, colour)
  /** Drawn mirrored, left for right. */
  const mirror = (svg) => `<g transform="matrix(-1 0 0 1 100 0)">${svg}</g>`

  return { taper, limb, mirror, fill, line, clip, part, torso, bust, eye, dot, shut, cross, brow, mouth, grin, tongue, smile, blush, shine }
}

// ------------------------------------------------------------ characters

const GREEN = '#7ad65a'

export const ROSTER = [
  {
    id: 'glorp', name: 'Glorp', bg: '#7b4fd6', draw: (k) => {
      const g = '#8fe36b'
      const head = P('M18 58 C15 45 17 33 23 14 L39 26 C46 24 54 24 61 26 L77 14 C83 33 85 45 82 58 C79 72 65 80 50 80 C35 80 21 72 18 58 Z')
      // Big alien eyes: tilted eggs, heavier low on the inside.
      const eye = k.fill(P('M-11.5 0 C-11.5 -6 -5.5 -8.4 0.5 -8.9 C7.5 -9.5 12.5 -5.5 12.5 0 C12.5 5.5 7.5 9.5 0.5 8.9 C-5.5 8.4 -11.5 6 -11.5 0 Z'), INK, 'transform="translate(35.5 50) rotate(36)"')
      return k.bust(g, { head, armTop: 88 })
        + k.part(head, g, { inside: k.fill(P('M26 23 L36 29 L28 36 Z'), shadow(g)) + k.fill(P('M74 23 L64 29 L72 36 Z'), shadow(g)) })
        + k.blush(28, 64.5, 4.6, '#f39bb2') + k.blush(72, 64.5, 4.6, '#f39bb2')
        + eye + k.mirror(eye)
        + k.fill(C(30.5, 44.5, 3.1), WHITE) + k.fill(C(35, 51.5, 1.4), WHITE)
        + k.fill(C(61.5, 46, 3.1), WHITE) + k.fill(C(66, 53, 1.4), WHITE)
        + k.line('M43 67 Q46.5 71 50 67 Q53.5 71 57 67', 3)
    },
  },
  {
    // Traced from photos of the toy: an egg of a head whose rim hangs in two
    // lobes like a cat's mouth, a chubby body under it, and two dot eyes set
    // wide apart.
    id: 'dingding', name: 'Ding Ding', bg: '#36c2b4', draw: (k) => {
      const skin = '#ffcdb8'
      const head = P('M24 56.7 C20.5 55.2 18.5 51.5 18.5 46.9 C18.5 41.7 27.5 7 50 7 C72.5 7 81.5 41.7 81.5 46.9 C81.5 51.5 79.5 55.2 76 56.7 C73 59.5 69 60 65 59.6 C58 59 53 55.5 50 52 C47 55.5 42 59 35 59.6 C31 60 27 59.5 24 56.7 Z')
      // The body's sides start just inside the corners of the head's rim: far
      // enough in that their lines come out from under the rim's, not so far
      // that the rim shows a step beside them.
      return k.clip(DISC, k.part(P('M26.35 48 L73.65 48 L74.15 56.95 C77.35 61.65 81.2 69.5 81.6 79 C81.9 86 81.6 96 81.2 110 L18.8 110 C18.4 96 18.1 86 18.4 79 C18.8 69.5 22.65 61.65 25.85 56.95 Z'), skin, {
        shade: false,
        inside: `<g transform="translate(0 4.5)">${k.fill(head, mix(skin, '#c8643a', 0.3))}</g>`,
      }))
        + k.part(head, skin, { shade: [0, -4.5], dark: mix(skin, '#e07a62', 0.32), inside: k.shine(39.5, 15.5, 3.3) })
        + k.dot(30.8, 34.5, 2.6) + k.dot(69.2, 34.5, 2.6)
    },
  },
  {
    id: 'moai', name: 'Moai', bg: '#ff9a3c', draw: (k) => {
      const stone = '#a5a9b1'
      const deep = mix(stone, INK, 0.35)
      // Deep-set: a shadowed socket under the brow, and a small dot of an eye in it.
      const socket = (x) => k.fill(P(`M${x - 9.5} 34 L${x + 9.5} 34 C${x + 9.5} 40.5 ${x + 5} 45 ${x} 45 C${x - 5} 45 ${x - 9.5} 40.5 ${x - 9.5} 34 Z`), deep)
      const eye = (x) => k.fill(E(x, 40.5, 3, 3.4), INK)
      return k.part(R(20, 36, 10, 30, 4.5), stone) + k.part(R(70, 36, 10, 30, 4.5), stone)
        + k.clip(TOPDISC, k.part(P('M27 108 L28 32 C28 12 38 4 50 4 C62 4 72 12 72 32 L73 108 Z'), stone, {
          inside: k.fill(R(24, 26, 52, 8), shadow(stone)) + socket(37.5) + socket(62.5),
        }))
        + k.line('M28 34 L72 34', 3)
        + eye(37.5) + eye(62.5)
        + k.part(P('M46.5 33 L39 62 C43 68 57 68 61 62 L53.5 33 Z'), stone)
        + k.part(R(38.5, 72, 23, 5.5, 2.75), stone, { shade: false })
        + k.line('M39 86 Q50 90 61 86', 3)
    },
  },
  {
    id: 'sus', name: 'Sus', bg: '#ffd23f', draw: (k) => {
      const red = '#e5343c'
      const body = P('M26 111.5 L26 43.5 C26 21.5 40 10.5 57 10.5 C74 10.5 86 21.5 86 43.5 L86 111.5 Z')
      return k.part(R(15, 43.5, 19, 44, 7), shadow(red), { shade: false })
        // In shade down the left: nothing at the top of the head, widening round the dome and down the side.
        + k.clip(TOPDISC, k.part(body, red, { shade: false, inside: k.fill(P('M57 10.5 C40 10.5 26 21.5 26 43.5 L26 112 L37 112 L37 43.5 C37 26 46 10.5 57 10.5 Z'), shadow(red)) }))
        + k.part(R(43, 22.5, 51, 32, 13), '#8fdcff', { inside: k.fill(R(55, 28.3, 26, 6.2, 3.1), WHITE, 'opacity="0.9"') + k.fill(C(86.5, 31.4, 2.1), WHITE) })
    },
  },
  {
    id: 'skull', name: 'Skull Emoji', bg: '#8a5cf0', draw: (k) => {
      const bone = '#eef0f4'
      const head = P('M17 42 C17 21 31 7 50 7 C69 7 83 21 83 42 C83 52 79 58 73 61 L71 72 C71 78 65 82 59 82 L41 82 C35 82 29 78 29 72 L27 61 C21 58 17 52 17 42 Z')
      const socket = P('M27 42 C27 33 35 29 42 32 C48 35 49 45 45 51 C41 56 30 55 28 49 Z')
      // A skeleton under the skull: a rib curving off each side of the spine, vertebrae
      // down the middle, a collarbone out either side.
      const rib = '#dfe2ea'
      const ribs = k.limb('M46 96.5 C38 94 30.5 95.5 25 102', rib, 9.5)
      const collar = k.limb('M46 89 C40 86.5 33 86 26.5 87.5', bone, 9.5)
      const spine = [82.5, 88.6, 94.7].map((y) => k.part(R(44, y, 12, 5.3, 2.6), bone, { shade: false, w: 2.8 })).join('')
      return k.clip(DISC, ribs + k.mirror(ribs) + collar + k.mirror(collar) + spine)
        + k.part(head, bone, {
          inside: k.shine(67, 18, 2.8) + k.line('M58 8 L55 17 L60 21 L57 27', 2.4) + k.fill(E(25, 58, 5, 3), shadow(bone)) + k.fill(E(75, 58, 5, 3), shadow(bone)),
        })
        + k.fill(socket, INK) + k.mirror(k.fill(socket, INK))
        + k.fill(P('M46 59 C46 55 50 51 50 51 C50 51 54 55 54 59 C52 61 48 61 46 59 Z'), INK)
        + k.part(R(35, 65, 30, 13, 4), WHITE, { shade: false, w: 2.6, inside: k.line('M35 71.5 L65 71.5 M42.5 65 L42.5 78 M50 65 L50 78 M57.5 65 L57.5 78', 2) })
    },
  },
  {
    // A Minecraft villager, pixel for pixel from the game's own texture: the
    // 8 × 10 face, eyes either side of the nose, and the nose itself, stuck out
    // further than in the game.
    id: 'villager', name: 'Hmm', bg: '#4fbf62', draw: (k) => {
      const pal = { a: '#be886c', b: '#b78272', c: '#b37b62', d: '#332411', w: '#ffffff', g: '#009611', e: '#905e43', m: '#774235' }
      const face = ['aaaaaabc', 'aabaaaab', 'aacaaaaa', 'baaaaaab', 'bbaaaabb', 'bddddddb', 'awgaagwa', 'ecbaaace', 'ecmmmmce', 'ecccccce']
      const px = 7
      const x0 = 22
      const y0 = 3
      const pixels = face.flatMap((row, r) => [...row].map((ch, c) => k.fill(R(x0 + c * px, y0 + r * px, px + 0.4, px + 0.4), pal[ch]))).join('')
      const head = R(x0, y0, 8 * px, 10 * px, 1.5)
      const robe = '#5a433d'
      const sleeve = '#7a5b52'
      // The nose is a block standing out of the face: its front, and its underside
      // showing below it, in shade.
      const [nx, ny, nw, nh, dx, dy] = [x0 + 3 * px - 0.9, y0 + 6 * px + 5.5, 2 * px + 1.8, 5 * px - 5.5, 0, 5]
      const side = P(`M${nx} ${ny} L${nx + dx} ${ny + dy} L${nx + dx} ${ny + nh + dy} L${nx} ${ny + nh} Z`)
      const under = P(`M${nx} ${ny + nh} L${nx + dx} ${ny + nh + dy} L${nx + nw + dx} ${ny + nh + dy} L${nx + nw} ${ny + nh} Z`)
      const block = P(`M${nx} ${ny} L${nx + nw} ${ny} L${nx + nw} ${ny + nh} L${nx + nw + dx} ${ny + nh + dy} L${nx + dx} ${ny + nh + dy} L${nx + dx} ${ny + dy} Z`)
      return k.clip(DISC, k.part(R(22, 66, 56, 50, 1.5), robe, { shade: false })
        + k.part(R(13, 78, 74, 17, 1.5), sleeve, { shade: false, inside: k.fill(R(36, 78, 28, 17), mix(sleeve, WHITE, 0.12)) + k.line('M36 78 L36 95 M64 78 L64 95', 2.4) }))
        + k.part(head, pal.a, { shade: false, inside: pixels })
        + k.fill(block, pal.e) + k.fill(side, '#75472f') + k.fill(under, '#5e3a27')
        + k.fill(R(nx, ny, nw, 3), mix(pal.e, WHITE, 0.15))
        + k.line(`M${nx} ${ny + nh} L${nx} ${ny}`, 2) + k.line(`M${nx} ${ny + nh} L${nx + nw} ${ny + nh}`, 2)
        + k.fill(block, 'none', `stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"`)
    },
  },
  {
    id: 'bot', name: 'BotAr2.0', bg: '#ff9a3c', draw: (k) => {
      const metal = '#c9d3df'
      const glow = '#5dffb0'
      const screen = '#1f2b3a'
      // The head and all on it are drawn round their middle at (50, 48.5),
      // then sized up and set at (50, MID): lines keep their width.
      const SIZE = 1.12
      const MID = 45.5
      const X = (x) => 50 + (x - 50) * SIZE
      const Y = (y) => MID + (y - 48.5) * SIZE
      const L = (v) => v * SIZE
      const box = (x, y, w, h, r) => R(X(x), Y(y), L(w), L(h), L(r))
      const head = box(18, 21, 64, 55, 14)
      const p = L(4.6)
      // The face, on a grid of pixels: eyes on rows 0–1, a row of space, the mouth on rows 3–4.
      const px = (col, row, wide = 1) => k.fill(R(X(27 + col * 4.6), Y(37.1 + row * 4.6), p * wide, p), glow)
      // Not a body but a monitor's stand: a straight column down from the head
      // to the edge of the disc, with the head's shadow and the lights on it.
      const lights = k.part(R(38, 83, 24, 10, 3), screen, { shade: false, w: 2.6 }) + k.fill(C(44, 88, 2.2), '#ff4b4b') + k.fill(C(50, 88, 2.2), '#ffd23f') + k.fill(C(56, 88, 2.2), glow)
      return k.clip(DISC, k.part(R(30, 56, 40, 60), metal, { shade: false, inside: `<g transform="translate(0 5)">${k.fill(head, shadow(metal))}</g>` + lights }))
        + k.part(box(10, 40, 10, 18, 3), metal, { shade: DOWN }) + k.part(box(80, 40, 10, 18, 3), metal, { shade: DOWN })
        + k.part(head, metal, { shade: DOWN, inside: k.shine(X(24), Y(27), L(2)) + k.line(`M${X(39)} ${Y(71.5)} L${X(61)} ${Y(71.5)}`, 2.4, shadow(metal)) })
        + k.part(box(25, 28, 50, 37, 9), screen, { shade: false, inside: k.fill(box(30, 30.6, 17, 4.6, 2.3), WHITE, 'opacity="0.3"') + k.fill(C(X(51), Y(32.9), L(1.7)), WHITE, 'opacity="0.3"') })
        + px(1, 1) + px(2, 0) + px(3, 1) + px(6, 1) + px(7, 0) + px(8, 1)
        + px(2, 3) + px(7, 3) + px(3, 4, 4)
    },
  },
  {
    id: 'capy', name: 'Quandale', bg: '#47b6ff', draw: (k) => {
      const brown = '#b07a4f'
      const snout = '#c99366'
      const head = R(16, 22, 68, 60, 26)
      // Oval eyes looking away from each other, tipped down ever so slightly at their outer ends.
      const eye = (x, side, size = 0.82) => {
        const drawn = k.part(E(x, 40.4, 6.8 * size, 5.6 * size), WHITE, { shade: false, w: 2.2 * size, inside: k.fill(C(x + side * 2.6 * size, 40.6, 4.5 * size), INK) })
        return `<g transform="rotate(${side * 3.5} ${x} 40.4)">${drawn}</g>`
      }
      return k.bust(brown, { head, armTop: 88 })
        + k.part(E(25.5, 27, 7.5, 6.5), brown, { inside: k.fill(E(25.5, 29, 3.6, 3), shadow(brown)) }) + k.part(E(74.5, 27, 7.5, 6.5), brown, { inside: k.fill(E(74.5, 29, 3.6, 3), shadow(brown)) })
        + k.part(head, brown, { shade: DOWN })
        + k.blush(23.5, 54, 4.5) + k.blush(76.5, 54, 4.5)
        + k.part(R(30, 47, 40, 34, 11), snout, { shade: DOWN, w: 2.2, inside: k.fill(E(44.5, 56, 2.7, 1.9), INK) + k.fill(E(55.5, 56, 2.7, 1.9), INK) })
        + k.line('M50 62 L50 71.5 M42 75 Q46 78 50 71.5 Q54 78 58 75', 2.2)
        + eye(30.5, -1) + eye(69.5, 1)
        + k.part(C(50, 19, 10), '#ff9a3c', { shade: DOWN, w: 2.6, inside: k.shine(45, 14, 1.8) })
        // One leaf on top of it, pointed at both ends.
        + k.part('<path d="M-6.5 0 Q-1.25 -4.2 4 0 Q-1.25 4.2 -6.5 0 Z" transform="translate(55.8 8.3) rotate(-38)"/>', GREEN, { shade: false, w: 1.8 })
    },
  },
  {
    // Tux, traced from the Linux mascot's own artwork and redrawn in the house
    // style: the head and the top of the body, cut off by the disc.
    id: 'tux', name: 'Tux', bg: '#36c2a0', draw: (k) => {
      const black = '#2b2a3f'
      const cream = '#f6f2ea'
      const yellow = '#ffc21a'
      // The shine on his head is lit from the right, like the glints in his eyes.
      const body = P('M44.1 4.1 C31.0 5.6 22.8 13.8 20.8 27.4 C20.1 31.5 20.4 48.6 21.2 59.4 C21.7 66.3 21.8 68.8 21.4 70.4 C20.7 73.0 19.9 74.4 16.9 77.7 C15.2 79.6 12.3 82.9 9.8 85.9 C4.4 92.2 2.3 96.0 0.5 102.8 C-1.2 109.2 -3.0 113.6 -6.8 120.8 C-11.3 129.5 -11.5 129.9 -11.5 133.0 C-11.5 135.2 -11.3 136.3 -10.6 138.3 C-10.3 139.2 -10.3 139.2 -10.9 140.2 C-11.3 140.8 -11.9 141.8 -12.4 142.6 C-14.8 147.0 -17.0 148.1 -22.6 147.8 C-26.6 147.5 -29.1 148.6 -30.2 150.9 C-31.3 153.0 -31.3 154.3 -30.7 160.3 C-29.9 168.0 -30.2 170.8 -32.3 175.2 C-34.2 179.2 -34.5 180.8 -33.5 182.7 C-32.6 184.4 -31.8 184.9 -26.5 186.5 C-24.6 187.1 -21.9 187.9 -20.5 188.3 C-19.1 188.8 -15.3 189.7 -12.0 190.5 C-2.8 192.6 -0.1 193.4 4.2 195.1 C11.0 198.0 11.6 198.1 14.7 198.1 C17.4 198.1 18.4 198.0 20.4 197.0 C23.4 195.6 25.9 193.0 27.2 189.9 C27.9 188.3 27.6 188.4 30.6 187.9 C38.4 186.7 45.6 186.6 56.2 187.9 C61.4 188.4 64.2 189.0 70.5 190.5 C74.1 191.4 74.1 191.4 74.6 192.3 C77.2 196.7 85.4 199.4 91.1 197.7 C94.5 196.7 96.8 195.2 101.4 190.8 C107.2 185.2 109.5 183.6 119.0 179.0 C125.5 175.8 127.8 174.0 129.2 171.2 C130.7 168.2 129.9 166.5 125.9 163.8 C125.1 163.2 123.5 162.0 122.5 161.2 C117.2 156.8 115.8 154.7 115.5 150.3 C115.2 145.7 114.0 143.7 111.0 142.5 C111.0 142.5 111.2 141.7 111.5 140.8 C112.2 138.8 113.0 134.9 113.2 132.6 C114.2 123.9 109.8 106.8 103.8 96.1 C101.4 91.9 100.0 90.0 95.5 85.1 C92.5 81.9 88.0 75.9 86.2 72.7 C83.3 67.7 81.6 63.8 80.4 59.7 C79.2 55.5 79.0 52.9 78.8 43.0 C78.6 30.5 78.1 27.6 75.3 21.9 C70.7 12.3 62.6 6.1 52.2 4.4 C50.8 4.1 45.3 4.0 44.1 4.1 Z')
      const belly = P('M62.9 64.1 C62.6 64.8 62.2 65.0 60.0 65.8 C57.9 66.6 56.3 67.5 52.8 69.9 C48.7 72.7 45.7 73.7 41.5 73.9 C36.8 74.0 35.0 73.1 31.2 68.6 C30.0 67.3 28.7 65.8 28.3 65.4 C27.5 64.6 27.5 64.6 27.4 65.2 C27.3 65.6 27.3 66.6 27.3 67.5 C27.3 72.6 26.7 74.3 22.8 79.8 C18.1 86.6 16.7 90.1 16.7 95.3 C16.7 97.0 16.7 97.0 15.5 98.9 C8.2 110.5 4.2 123.1 4.3 134.9 L4.3 138.0 L6.4 140.0 C10.9 144.1 14.4 147.1 19.8 151.4 C25.1 155.5 26.8 157.3 27.7 159.9 C29.5 164.8 25.8 168.5 20.4 167.4 C19.8 167.3 19.4 167.2 19.4 167.2 C19.3 167.3 20.3 168.5 21.5 170.0 C22.7 171.5 24.0 173.2 24.4 173.7 C25.0 174.6 25.2 174.8 26.5 175.4 C34.9 179.6 45.0 180.5 53.6 177.7 C59.9 175.6 65.0 172.1 73.2 164.0 L76.5 160.7 L76.6 158.2 C76.8 155.8 76.7 152.9 76.5 146.1 C76.2 140.6 77.9 139.2 83.4 140.1 C84.1 140.3 84.8 140.3 84.8 140.3 C84.9 140.2 85.1 138.7 85.3 136.9 C87.5 117.6 84.5 104.5 75.7 94.5 C74.6 93.3 74.6 93.3 74.4 91.9 C73.4 86.0 71.9 81.9 68.0 74.0 C66.7 71.4 65.2 68.3 64.7 67.1 C64.3 66.0 63.7 64.7 63.6 64.4 C63.2 63.7 63.2 63.7 62.9 64.1 Z')
      // Its mouth line is a slit in the outline; the shading goes on the beak
      // without it, so no shadow shows through the slit.
      const beak = P('M39.6 46.6 C36.3 47.4 33.5 48.9 31.0 51.3 C30.2 52.0 29.1 53.0 28.5 53.4 C26.5 55.0 25.2 56.9 24.8 58.8 C24.4 60.7 24.5 61.2 25.1 61.8 C25.7 62.4 26.1 62.5 25.7 62.0 C25.5 61.8 25.6 61.8 26.0 61.8 C26.8 61.8 28.0 62.4 29.4 63.5 C32.4 65.7 35.2 66.5 39.5 66.1 C45.0 65.6 49.3 64.1 53.6 61.0 C56.0 59.3 56.4 59.3 54.2 61.0 C51.1 63.4 48.4 64.8 44.5 65.7 C36.9 67.5 32.3 67.2 29.5 64.6 C28.8 63.9 27.2 62.9 26.9 62.9 C26.8 62.9 27.3 63.5 28.0 64.2 C28.8 64.9 30.1 66.4 31.0 67.6 C34.5 72.3 36.8 73.7 41.1 73.6 C45.7 73.6 49.0 72.2 54.8 67.7 C56.7 66.3 58.7 65.2 60.2 64.7 C62.5 64.0 63.3 63.2 63.6 61.6 C63.7 61.0 63.9 59.9 64.1 59.1 C64.5 57.2 64.5 56.9 64.0 55.6 C63.6 54.3 62.9 53.6 61.6 53.2 C57.6 52.0 56.6 51.7 55.2 51.2 C54.3 50.8 52.5 50.0 51.1 49.2 C47.6 47.4 46.9 47.1 45.9 46.8 C44.6 46.4 41.0 46.3 39.6 46.6 Z')
      const beakSolid = P('M39.6 46.6 C36.3 47.4 33.5 48.9 31.0 51.3 C30.2 52.0 29.1 53.0 28.5 53.4 C26.5 55.0 25.2 56.9 24.8 58.8 C24.4 60.7 24.5 61.2 25.1 61.8 C25.9 62.7 27 63.4 28.0 64.2 C28.8 64.9 30.1 66.4 31.0 67.6 C34.5 72.3 36.8 73.7 41.1 73.6 C45.7 73.6 49.0 72.2 54.8 67.7 C56.7 66.3 58.7 65.2 60.2 64.7 C62.5 64.0 63.3 63.2 63.6 61.6 C63.7 61.0 63.9 59.9 64.1 59.1 C64.5 57.2 64.5 56.9 64.0 55.6 C63.6 54.3 62.9 53.6 61.6 53.2 C57.6 52.0 56.6 51.7 55.2 51.2 C54.3 50.8 52.5 50.0 51.1 49.2 C47.6 47.4 46.9 47.1 45.9 46.8 C44.6 46.4 41.0 46.3 39.6 46.6 Z')
      const eyes = [[P('M29.6 33.1 C26.3 33.7 24.6 36.7 24.6 41.6 C24.6 47.1 25.4 50.9 27.1 52.8 C28.0 53.9 27.9 53.9 32.2 50.7 C38.2 46.2 38.7 45.4 37.8 41.3 C36.8 36.3 33.0 32.5 29.6 33.1 Z'), P('M29.3 39.4 C28.0 40.1 27.3 41.5 27.2 43.8 C27.0 46.6 28.1 49.1 30.1 50.4 C31.1 51.0 31.1 51.0 32.2 50.1 C32.7 49.7 33.5 49.2 33.9 48.9 C36.2 47.5 34.7 40.9 31.7 39.5 C31.0 39.2 29.8 39.1 29.3 39.4 Z M31.7 41.0 C32.8 41.6 33.5 42.9 33.2 43.8 C32.9 44.5 32.7 44.4 32.2 43.6 C32.0 43.2 31.5 42.7 31.1 42.3 C30.0 41.3 30.4 40.4 31.7 41.0 Z')], [P('M53.0 31.9 C48.9 33.1 45.9 37.4 46.0 42.0 C46.1 43.6 46.1 43.6 47.1 45.6 C48.1 47.6 48.2 47.6 49.2 48.2 C52.2 49.9 58.7 52.6 60.7 52.9 C61.3 53.0 61.4 52.9 61.9 52.3 C64.8 48.9 65.3 41.6 62.9 37.0 C60.8 32.9 56.8 30.9 53.0 31.9 Z'), P('M54.2 38.7 C51.7 39.3 50.1 42.0 50.4 45.4 C50.5 46.8 50.9 48.3 51.6 49.1 C52.2 49.9 55.3 51.3 56.1 51.1 C62.1 50.2 62.2 40.3 56.3 38.8 C55.3 38.5 55.0 38.5 54.2 38.7 Z M57.1 40.8 C58.5 41.4 59.7 43.8 58.9 44.1 C58.1 44.4 55.0 41.3 55.4 40.6 C55.5 40.4 56.5 40.5 57.1 40.8 Z')]]
      return k.clip(TOPDISC, k.part(body, black, { shade: DOWN, inside: k.shine(60, 12, 2.6) }) + k.part(belly, cream, { shade: DOWN }))
        + eyes.map(([eye, pupil]) => k.part(eye, WHITE, { shade: false, w: 2.4, inside: k.fill(pupil, INK) })).join('')
        + k.part(beakSolid, yellow, { shade: DOWN, w: 0 }) + paint(beak, `fill="none" ${ink()}`)
    },
  },
  {
    // Mr. Saturn, from EarthBound, turned a little to his left: an egg of a head
    // bulging into a big nose on that side, a little foot, heavy brows over dot
    // eyes, whiskers, and one hair with a bow.
    id: 'saturn', name: 'Mr. Saturn', bg: '#5b8def', draw: (k) => {
      const skin = '#f7d3ae'
      const red = '#e5343c'
      // He is drawn a size up from the rest and sits low, the lines kept at the
      // weight every character wears.
      const S = 1.1
      const scaled = (art) => `<g transform="translate(44 89.1) scale(${S}) translate(-40 -75)">${art}</g>`
      // The outline runs down the near side into his foot and back into the body;
      // the far foot is hidden behind the nose.
      const head = P('M46 13.5 C34 13.8 25 24 22 36 C20 44 19.6 51 19.8 57 C20 61.5 20.6 64 20 66.5 C17 68.5 12.8 72.5 13 77 C13.3 81.5 19.5 83 26 82 C31.5 81 36 78.5 39.5 74.3 C43 72.8 48 72.6 52 72.6 C64 72 75 71 78.8 65 C81.5 60.5 81.2 51 78.5 44 C75.5 36 71.5 28 66.5 21.5 C61.5 15.5 54 13.3 46 13.5 Z')
      // The nose stands out from the face past the edge of the head: its top, its
      // round far end and its bottom drawn, its near side left open, where it
      // melts into the cheek.
      const nose = 'M50.3 49.0C57.5 38.9 73.6 37.3 83.3 45.7C92.9 54.1 91.1 68.2 79.5 74.5C68.0 80.8 52.7 76.1 48.3 64.8'
      // Its shading is only the crescent along the bottom, so nothing dark meets
      // the open side, where it would show as a seam on the cheek.
      const noseD = nose + ' C47 61.5 47.2 52.5 50.3 49.0 Z'
      const noseShape = P(noseD)
      let n = 0
      const lifted = noseD.replace(/-?\d*\.?\d+/g, (v) => (Number(v) + (n++ % 2 ? -5 : -3)).toFixed(2))
      const noseShade = `<path d="M-60 -60 H160 V160 H-60 Z ${lifted}" fill-rule="evenodd" fill="${shadow(skin)}"/>`
      const brow = 'M32.5 33 C32 28.5 36 26.5 41 26.8 C45 27 47.5 28.5 47.5 30.6 C47.5 32 46 32.4 44 32 C40.5 31.4 36.5 31.6 34.5 32.6 C33.4 33.2 32.6 33.6 32.5 33 Z'
      const wing = (d) => k.part(P(d), red, { shade: false, w: 1.8 / S })
      // A whisker from the face out, thinning to its tip.
      const whisker = (x1, y1, x2, y2) => k.taper(`M${x1} ${y1} C${x1 + (x2 - x1) / 3} ${y1 + (y2 - y1) / 3} ${x1 + (x2 - x1) * 2 / 3} ${y1 + (y2 - y1) * 2 / 3} ${x2} ${y2}`, 1.9 / S, { ends: 0.7, start: false })
      return scaled(''
        + k.taper('M47 13.8 C47 5.5 46.3 -1 43.6 -5.5', 2.4 / S, { ends: 0.7, start: false })
        + wing('M45 1.8 L31.5 -1.6 L32.3 4.6 Z') + wing('M46.3 2.6 L57 0.6 L56.4 6 Z')
        + k.part(head, skin, { shade: DOWN, w: 0, inside: k.shine(34, 21, 2.2) })
        // His outline all round, lighter along the bottom, which runs in under the
        // nose.
        + k.line('M39.5 74.3 C36 78.5 31.5 81 26 82 C19.5 83 13.3 81.5 13 77 C12.8 72.5 17 68.5 20 66.5 C20.6 64 20 61.5 19.8 57 C19.6 51 20 44 22 36 C25 24 34 13.8 46 13.5 C54 13.3 61.5 15.5 66.5 21.5 C71.5 28 75.5 36 78.5 44 C81.2 51 81.5 60.5 78.8 65', W / S)
        + k.line('M39.5 74.3 C43 72.8 48 72.6 52 72.6 C64 72 75 71 78.8 65', 2.6 / S)
        + whisker(78, 46.6, 102, 44.7) + whisker(78.5, 51.7, 102, 55.6)
        + k.part(noseShape, skin, { shade: false, w: 0, inside: noseShade })
        + k.taper(nose, 3 / S, { ends: [0.3, 0.1] })
        + whisker(33, 46.6, -2, 45.2) + whisker(33.5, 52.1, -0.5, 57)
        + `<g transform="translate(0 -1.5)">${k.fill(P(brow), INK)}</g>`
        + `<g transform="translate(67.5 28.6) scale(-0.62 1) translate(-40 -30.2)">${k.fill(P(brow), INK)}</g>`
        + k.fill(C(42.5, 35.8, 2), INK) + k.fill(C(68.5, 36, 1.75), INK))
    },
  },
  {
    // Glep, from Smiling Friends: a green bean with a long beak for a face, one
    // big eye and a floppy purple wizard hat. Facing right, from the waist up.
    id: 'glep', name: 'Glep', bg: '#ff9f43', draw: (k) => {
      const green = '#87fc87'
      const purple = '#b75af0'
      const inside = mix(purple, INK, 0.35)
      // Drawn big, cut a little below the beak, at the weight every character wears.
      const S = 1.25
      const scaled = (art) => `<g transform="translate(45.5 98) scale(${S}) translate(-50 -87)">${art}</g>`
      const fine = 1.6 / S
      const brimLine = 2.4 / S // where the brim lies on his head
      // Only his middle goes down behind the disc; the beak stays out in front.
      const low = P('M-10 -10 L110 -10 L110 80 L83.9 80 A41 41 0 0 1 16.1 80 L-10 80 Z')
      // His whole outline, head and all, at full weight; the hat is drawn over it.
      const body = P('M31.4 73 C31.6 75 31.7 77 31.9 79 C32.4 84 33.1 88 33 92 C32.7 97 33.2 101 34 104 L65.5 104 C66.6 99 67.3 92 67.2 85 C67.1 78 66.6 73 67.2 70.8 C67.8 69.2 69.5 68.9 72 68.6 C77.5 68 83.5 67.6 87.5 65.8 C91 64.2 92.3 61 91.6 58.3 C91 55.6 88.6 53.4 83 52.9 C78.5 52.2 74 51.95 70.6 51.9 C69.8 51.9 69.8 51.6 70.6 51.6 C74 51.5 79 51.6 83 51.3 C87 51 90.8 50.6 92.6 48.6 C94.4 46.5 93 43.2 89.5 41.4 C85.5 39.3 78 38.7 71 38.8 C67.5 38.85 65 38.9 63.6 38.9 C61 38.9 58 37.4 54 37.2 C47 37 40 41 35.5 46.5 C32.2 50.6 30.9 56 30.8 61 C30.8 64 31 68 31.4 73 Z')
      // The hat, flat purple, its brim sticking out past his head at the front
      // and the back: a full outline against the background, a fine line where
      // the brim lies on his head. Under the front tip the inside of the brim
      // shows, marked off by a fine line.
      const tail = (d) => d.slice(d.indexOf('C'))
      const crown = 'M66.6 31.5 C65.4 30 61.5 31 58.2 32.6 C55.5 33.8 52.5 35.1 49.5 35 C46 34.8 42.5 32.4 38.5 30 C33 26.6 29 23.4 24.5 21.3 C21 19.8 17 19.2 14.2 19.1 C15.6 22.5 18 27 20.4 31.5 C23 36 25.8 39.5 27.5 44.5 C28.8 48.3 29.6 52 29.2 55.5 C28.8 59 27 62.5 26.3 66.5'
      const back = 'M26.3 66.5 C27.6 65.4 30.85 65.9 30.85 63.6'
      const onHead = 'M30.85 63.6 C30.85 61.2 32.8 59.6 35.2 57.6 C40 53.6 46 45.8 51 43.5 C56.5 41 60.5 38.9 63.6 38.9'
      const front = 'M63.6 38.9 C66.2 38.9 66.8 34.5 66.6 31.5'
      // From each tip the brim's full outline carries on a little way along the
      // fine line, thinning down into it.
      const backLine = back + ' C30.85 62.64 31.16 61.81 31.69 61.03'
      const frontLine = 'M66.6 31.5 C66.8 34.5 66.2 38.9 63.6 38.9 C62.67 38.9 61.66 39.09 60.55 39.42'
      const hat = P(crown + ' ' + tail(back) + ' ' + tail(onHead) + ' ' + tail(front) + ' Z')
      const rim = 'M66.6 31.5 C63.6 34.2 61.2 37.4 59.2 39.8'
      const underside = P('M63.6 38.9 C66.2 38.9 66.8 34.5 66.6 31.5 C63.6 34.2 61.2 37.4 59.2 39.8 C60.6 39.3 62 38.9 63.6 38.9 Z')
      const eye = P('M50.9 47.2 C41.9 51.1 44.7 63.5 54.6 63.9 C62.6 64.1 67 55.2 61.7 49.5 C58.9 46.6 54.4 45.7 50.9 47.2 Z')
      const pupil = P('M52.6 49.4 C47.2 51.1 47.2 58.5 52.6 60.1 C59.6 62.1 63.5 53 57 49.7 C56.2 49.3 53.5 49 52.6 49.4 Z')
      return k.clip(low, scaled(k.part(body, green, { shade: [8, 0], w: W / S })))
        + scaled(k.part(hat, purple, { shade: [7, -2], w: 0 }) + k.fill(underside, inside)
          + k.line(rim, fine) + k.line(onHead, brimLine) + k.line(crown + ' C26.69 66.17 27.26 65.98 27.86 65.82', W / S) + k.taper(backLine, W / S, { ends: [0.01, 0.5], start: false, to: brimLine })
          + k.taper(frontLine, W / S, { ends: [0.01, 0.3], start: false, to: brimLine })
          + k.part(eye, WHITE, { shade: false, w: 2.4 / S }) + k.fill(pupil, INK))
    },
  },
  {
    // Cheesing: the grinning emoji, all eyes and buck teeth, on a body. Traced
    // from the emoji: half-dome eyes with a big blue iris under a lid line,
    // brows high up, blush under the eyes, and a huge open mouth with the two
    // big front teeth, a little tongue and two little bottom teeth.
    id: 'cheese', name: 'Cheesing', bg: '#ff7aa8', draw: (k) => {
      const yellow = '#ffcf3d'
      const mouthLine = 1.9
      const head = C(50.35, 45.35, 37.2)
      // One eye, drawn on the left and mirrored about the middle of the face.
      const flip = (art) => `<g transform="translate(100.7 0) scale(-1 1)">${art}</g>`
      // Its lower edge is a slice of a big circle, and the lower lid line carries
      // that circle on a little past the outer corner.
      const eyeTop = 'M29.8 26.69 C29.6 20.5 33 17.2 37.2 17.2 C41.5 17.2 44.6 20.5 44.4 26.8'
      const eyeShape = P(eyeTop + ' C39.58 25.87 34.63 25.83 29.8 26.69 Z')
      const eye = (mirrored) => {
        // Both look a touch to his left, so the mirrored eye's iris and pupil
        // sit a little further over.
        const cx = 37.8
        const inside = k.fill(C(cx + (mirrored ? -0.6 : 0), 24.3, 4.6), '#3d7fd6')
          + k.fill(C(cx + (mirrored ? -0.4 : 0.2), 24.3, 1.9), INK)
        // One fine line round the top and along the lower lid, running on a
        // little past the outer corner.
        return k.part(eyeShape, '#d6ebfa', { shade: false, w: 0, inside })
          + k.line(eyeTop + ' C38.91 25.74 33.25 25.84 27.8 27.1', 1.4)
      }
      // Each brow follows its eye's dome round its outer side, a little way above it.
      const brow = k.taper('M27.15 23.17 C28.71 16.31 34.92 12.5 40.6 14.93', 2.4, { ends: 0.3, colour: '#8a4a22' })
      const blush = k.fill(E(33.1, 30.5, 5, 1.75), '#f5913c', 'opacity="0.85"')
      // A round bump of cheek over each corner of the mouth, tucking the corner
      // under it. Its inner edge is a crease where it lies on the face and its
      // outline where it lies over the mouth, down to the bottom of the circle,
      // which sits right on the mouth's line.
      const cheek = k.fill(C(23.99, 41.37, 5.4), mix(yellow, WHITE, 0.2)) + k.taper('M26.69 36.69 C28.81 37.91 29.84 40.41 29.21 42.77 C28.58 45.13 26.43 46.77 23.99 46.77', mouthLine, { ends: 0.45, end: false })
      const mouth = P('M24 44.6 C25 41 29.5 39 34 38 C39 36.9 44.5 36.5 50.3 36.5 C56.1 36.5 61.6 36.9 66.6 38 C71.1 39 75.6 41 76.6 44.6 C77.4 56.5 66.1 71 50.3 70.8 C34.5 71 23.2 56.5 24 44.6 Z')
      const upper = P('M39 34 C38 40 37.3 43 37.5 46 C37.8 50.5 40 54 44.5 54.9 C47 55.3 53.6 55.3 56.1 54.9 C60.6 54 62.8 50.5 63.1 46 C63.3 43 62.6 40 61.6 34 Z')
      const lower = R(43.35, 63.9, 13.9, 10, 2.2)
      const tongue = P('M45.6 57.6 C45.4 56.8 46.6 56.7 47.6 57.3 C48.8 58 51.8 58 53 57.3 C54 56.7 55.2 56.8 55 57.6 C54.8 60.2 53.1 61.5 50.3 61.5 C47.5 61.5 45.8 60.2 45.6 57.6 Z')
      const gap = '#c9cbd4'
      return k.bust(yellow, { head, armTop: 88 })
        + k.part(head, yellow, { shade: DOWN })
        + blush + flip(blush) + brow + flip(brow)
        + k.part(mouth, '#7a2a1f', { shade: false, w: mouthLine, inside:
            k.fill(tongue, '#e0434b')
            // Each pair of teeth: a fine outline, the gap between the two down
            // its middle, kept inside them.
            + k.part(upper, WHITE, { shade: false, w: 1.2, inside: k.fill(R(30, 30, 40, 9.3), '#dcdee5') + k.line('M50.3 30 L50.3 60', 0.9, gap) })
            + k.part(lower, WHITE, { shade: false, w: 1.2, inside: k.line('M50.3 60 L50.3 76', 0.9, gap) }) })
        + cheek + flip(cheek)
        + eye(false) + flip(eye(true))
        // The glints, lit from the same side in both eyes, so not mirrored.
        + [38, 63.3].map((x) => k.fill(E(x - 2.4, 22.9, 1.1, 1.6), WHITE) + k.fill(C(x + 2.2, 24.8, 0.5), WHITE)).join('')
    },
  },
  {
    // Squiddy: the grumpy octopus neighbour. Traced from the cartoon: a huge
    // dome of a head with spots on top, heavy-lidded eyes under a flat brow,
    // the long nose hanging over his frown, the frown's flaps out to either
    // side, and his thin neck.
    id: 'squid', name: 'Squiddy', bg: '#f6a04d', draw: (k) => {
      const skin = '#bad9cf'
      const lidColour = '#91bdb3'
      // His outline, but for his neck, whose sides get a lighter line.
      const outline = 'M50 2.7 C66 2.7 86.6 13 86.6 30 C86.6 38.5 80.5 45.2 71.3 48.5 C69 49.4 67.6 49.9 67.4 51 C67.1 54.5 67 58.5 67.1 61.5 C67.1 64.2 67.4 65.8 68.9 66.4 C74 68.2 76.6 70.7 75.5 74.8 C74.5 78.3 72 79 69.5 78.2 C66.8 77.4 63.7 76.5 61.3 75.8 C59.4 75.3 57.2 75.8 55.6 76.8 M48.9 76.8 C47 76 43 75.2 39.6 74.8 C37.6 74.6 36.6 74.5 35.1 75 C33 75.7 29.8 76.5 27.2 76.9 C24.6 77.3 22.6 75.4 22.1 71.8 C21.6 68.6 24 66.2 29.6 63.6 C31.3 62.8 31.6 62.4 31.4 61.2 C31 57.5 30.8 55.5 30.4 53.5 C30 51 29.8 48.8 29.2 48 C28.4 47 27.2 46.6 25.6 45.7 C17.6 41.5 13.1 35 13.1 28 C13.1 13.5 32 2.7 50 2.7'
      // A little wider where it leaves his head, narrowing gently downwards.
      const neck = 'M55.6 76.8 C55.3 84 55.1 90 55 96 C54.95 100 54.9 104 54.9 108 M49.6 108 C49.6 104 49.55 100 49.5 96 C49.4 90 49.2 84 48.9 76.8'
      const head = P('M50 2.7 C66 2.7 86.6 13 86.6 30 C86.6 38.5 80.5 45.2 71.3 48.5 C69 49.4 67.6 49.9 67.4 51 C67.1 54.5 67 58.5 67.1 61.5 C67.1 64.2 67.4 65.8 68.9 66.4 C74 68.2 76.6 70.7 75.5 74.8 C74.5 78.3 72 79 69.5 78.2 C66.8 77.4 63.7 76.5 61.3 75.8 C59.4 75.3 57.2 75.8 55.6 76.8 C55.3 84 55.1 90 55 96 C54.95 100 54.9 104 54.9 108 L49.6 108 C49.6 104 49.55 100 49.5 96 C49.4 90 49.2 84 48.9 76.8 C47 76 43 75.2 39.6 74.8 C37.6 74.6 36.6 74.5 35.1 75 C33 75.7 29.8 76.5 27.2 76.9 C24.6 77.3 22.6 75.4 22.1 71.8 C21.6 68.6 24 66.2 29.6 63.6 C31.3 62.8 31.6 62.4 31.4 61.2 C31 57.5 30.8 55.5 30.4 53.5 C30 51 29.8 48.8 29.2 48 C28.4 47 27.2 46.6 25.6 45.7 C17.6 41.5 13.1 35 13.1 28 C13.1 13.5 32 2.7 50 2.7 Z')
      const spots = [[25.3, 13.6], [33.9, 8.5], [38.8, 10.5], [49.7, 6], [53.1, 10.8], [65.3, 13.8], [71.5, 11.6], [77.7, 17.5]]
        // Each spot lies along the curve of the dome, the ones in the middle a little bigger.
        .map(([x, y]) => {
          const tilt = Math.atan(-((x - 49.85) * 27.3 ** 2) / ((y - 30) * 36.75 ** 2)) * 180 / Math.PI
          const size = 1.2 - Math.min(1, Math.abs(x - 50) / 28) * 0.35
          return k.fill(E(x, y, 1.5 * size, 0.8 * size, tilt.toFixed(1)), '#30634f')
        }).join('')
      const fine = 1.6
      // A line a little narrower at both ends, for brows and creases.
      const crease = (d, w = fine) => k.taper(d, w, { ends: 0.5, to: w * 0.3 })
      // Each eye: the yellow eye; the pupil, a red dash hanging from the lid; and
      // the heavy lid over the top, its rim bulging out at either side, with a
      // short crease along it and a line where it meets the eye.
      const eye = (white, pupil, lid, outline, rimBottom, rimCrease) => k.part(P(white), '#fffdc6', { shade: false, w: fine })
        + k.part(pupil, '#6b2a26', { shade: false, w: 1 })
        + k.fill(P(lid), lidColour) + k.line(outline, 1.8) + k.line(rimBottom, 1.8) + crease(rimCrease, 1.1)
      const nose = P('M48.3 48 C51.5 48 54.4 54.5 56.3 61.5 C57.7 66.5 58.4 71.5 57.6 75 C56.6 79.4 53.2 81.8 48.6 81.8 C43.7 81.8 39.8 79 39.4 73.5 C39 68.5 40.6 62.5 42.3 57.5 C43.8 52.8 45.8 48 48.3 48 Z')
      return k.clip(TOPDISC, k.part(head, skin, { shade: [2.5, -3], w: 0, inside: spots }) + k.line(outline) + k.line(neck, 2.2))
        // Wrinkles on his brow over the right eye.
        + crease('M53.2 24.2 C55 22.9 57 22.5 59 22.6 C61.3 22.8 63.5 24.4 64.7 27.1') + crease('M56.6 19.8 C58 19 59.6 18.8 61 18.9 C62.3 19 63.5 19.6 64.2 20.4')
        // The frown, running out from under the nose to a little curved tick at each end,
      // the right half the left one mirrored, a touch lower to sit in its flap.
        + k.line('M38.2 69.1 C34.6 69.6 30.9 70.3 27.2 71 M28.1 69.5 C27.2 70.3 27.1 71.9 28.3 72.9', fine)
        + k.line('M58.3 70.5 C63.3 71.2 67 71.9 70.7 72.6 M69.8 71.1 C70.7 71.9 70.8 73.5 69.6 74.5', fine)
        + eye('M31.6 43.7 C31.6 50.8 35.2 56.2 39.6 56.2 C44 56.2 47.6 50.8 47.6 43.7 Z', R(40.1, 42.5, 2.2, 5.6, 0.8),
          'M48.3 43.95 L30.4 43.7 C29.8 43.7 29.5 43 29.9 42.4 C30.3 41.9 30.9 41.7 31.6 41.4 C32 37.4 33.1 34.2 34.6 31.9 C37.5 32.6 42 32.6 45 31.9 C46.6 34.4 47.8 37.9 48.1 41.5 Z',
          'M30.4 43.7 C29.8 43.7 29.5 43 29.9 42.4 C30.3 41.9 30.9 41.7 31.6 41.4 C32 37.4 32.9 34.6 34.4 32.5 M45.2 32.5 C46.7 34.8 47.8 37.9 48.1 41.5',
          'M30.4 43.7 L48.3 43.95', 'M35.4 41.6 C38.6 41.33 41.8 41.33 45 41.6')
        + eye('M49.3 44.1 C49.3 51.2 53 56.6 57.6 56.6 C62.2 56.6 65.9 51.2 66 44.1 Z', R(55.3, 42.9, 2.2, 5.6, 0.8),
          'M48.3 43.95 L48.2 41.5 C48.6 35 52.5 30.7 57.4 30.7 C62.3 30.7 66 35.5 66.5 41.3 C67.6 41.6 68.6 42.3 68.4 43.1 C68.2 43.9 67.4 44.1 66.8 44.1 Z',
          'M48.2 41.5 C48.6 35 52.5 30.7 57.4 30.7 C62.3 30.7 66 35.5 66.5 41.3 C67.6 41.6 68.6 42.3 68.4 43.1 C68.2 43.9 67.4 44.1 66.8 44.1',
          'M48.3 43.95 L66.8 44.1', 'M55.8 42.1 C57.87 41.83 59.93 41.83 62 42.1')
        // His brow, dipping across the top of the left lid.
        + crease('M30.4 30.9 C34.5 32.6 44.5 32.9 49 31.1', 1.45)
        + k.part(nose, skin, { shade: [2.5, -3], w: 2.7 })
    },
  },
  {
    // Monty: the mole from the Mario games, traced from a render with his head
    // turned level, and drawn symmetrical. A round brown head swelling out into
    // his body where his arms would be, a big white belly, two puffy white
    // cheeks with long whiskers, a black button nose, a single buck tooth in
    // front of the cheeks, and happily shut eyes.
    id: 'monty', name: 'Monty', bg: '#76c96a', draw: (k) => {
      const brown = '#b0651f'
      const white = '#f3f6f8'
      // Drawn a size down from the trace so the disc shows round him, at the
      // weight every character wears.
      const S = 0.724
      const scaled = (art) => `<g transform="translate(50 37.15) scale(${S}) translate(-50 -45)">${art}</g>`
      const mirror = (art) => `<g transform="translate(100 0) scale(-1 1)">${art}</g>`
      // One fat shape from the top of his head down: below his whiskers his sides
      // spread, more and more, until they go behind the disc.
      const body = P('M50 4.8 C68.5 4.8 84.2 18.4 87.6 36 C88.4 39.5 89.6 42 90.24 45 C91.2 50 91.9 55.5 93 61.5 C94 67 95.4 71.5 97 76 C98.8 81 100.8 86.5 103 92 C105.2 98 107.6 105 110 113 L114 140 L-14 140 L-10 113 C-7.6 105 -5.2 98 -3 92 C-0.8 86.5 1.2 81 3 76 C4.6 71.5 6 67 7 61.5 C8.1 55.5 8.8 50 9.76 45 C10.4 42 11.6 39.5 12.4 36 C15.8 18.4 31.5 4.8 50 4.8 Z')
      // His muzzle: two puffy whisker pads, round at their outer ends, joined
      // under his nose and parting below it in a V, where the tooth shows through.
      const muzzle = P('M50 30.4 C47.6 29.4 45 28.2 42.4 27.6 C39.4 26.4 35.4 25.6 31 25.8 C24.6 26.2 18.8 29.8 17.6 35.4 C16.8 39.2 17.2 43.8 19.6 46.6 C21.8 49 26.4 48.8 30.4 48 C34.8 47.1 39.6 45.4 42.8 43 C44.2 41.8 45 40 45.6 38 L50 33 L54.4 38 C55 40 55.8 41.8 57.2 43 C60.4 45.4 65.2 47.1 69.6 48 C73.6 48.8 78.2 49 80.4 46.6 C82.8 43.8 83.2 39.2 82.4 35.4 C81.2 29.8 75.4 26.2 69 25.8 C64.6 25.6 60.6 26.4 57.6 27.6 C55 28.2 52.4 29.4 50 30.4 Z')
      const tooth = P('M44.8 33 L55.2 33 C55.1 41 54.6 47.8 53.9 51.2 C53.7 52.3 53 52.9 51.9 52.9 L48.1 52.9 C47 52.9 46.3 52.3 46.1 51.2 C45.4 47.8 44.9 41 44.8 33 Z')
      const nose = P('M43.2 23.4 C46.4 22.4 53.6 22.4 56.8 23.4 C58.4 24.2 58.6 26.6 57.6 28 C55.6 30.8 52.4 33.6 50 34.1 C47.6 33.6 44.4 30.8 42.4 28 C41.4 26.6 41.6 24.2 43.2 23.4 Z')
      // One side's whiskers and eye; the other side is their mirror image.
      const half = k.taper('M23 34.9 C12.6 32.3 0.6 29.9 -13 28', 1.3 / S, { ends: 0.6, start: false }) + k.taper('M22.5 39 C12.6 38.1 0.6 37.6 -12.5 37.6', 1.3 / S, { ends: 0.6, start: false })
        // Shut tight and tipped down towards the nose, a little menacing.
        + `<g transform="translate(-1.3 -0.6) rotate(8 36 21)">${k.taper('M29.6 21.2 C31.6 18.8 35.4 18 38.6 19.3 C40.4 20.1 41.8 21.7 42.6 23.7', 2.3 / S, { ends: 0.45 })}</g>`
      return k.clip(TOPDISC, scaled(k.part(body, brown, { w: W / S }) + k.part(E(50, 96.5, 45, 39), white, { shade: [0, -4], w: 1.7 / S })))
        + scaled(k.part(tooth, WHITE, { shade: false, w: 1.3 / S })
          + k.part(muzzle, white, { shade: [0, -2.5], w: 1.8 / S })
          + mirror(half) + half
          + k.part(nose, '#1f1d24', { shade: false, w: 1.8 / S, inside: k.fill(E(51.6, 25.8, 1.2, 0.7, -20), WHITE) }))
    },
  },
  {
    // Watashi: the deadpan pale frog. A wide flat head with two big eyes bulging
    // out of its top corners, heavy-lidded, each with a long dark pupil and one
    // glint; two small nostrils; one long straight line of a mouth; and a thin,
    // fragile body with its arms hanging close at its sides.
    id: 'frog', name: 'Watashi', bg: '#4f9bea', draw: (k) => {
      const skin = '#ddd6da'
      // One outline for all of him: up his body, which spreads out below his neck
      // and then runs nearly straight down past his arms, in at the neck, out round the wide flat face, up and over each eye's
      // bulge, and across the top.
      const frog = P('M16 110 C16.1 102 16.3 96 16.6 90 C17 84 17.6 78 18.6 72 C19.6 66.5 22 62 24.6 58.4 C26.2 55.6 27.6 54 27.6 51.7 C27.6 48.5 24 46 22.4 44 C20.6 41.8 20 39.5 20.2 36 C20.5 32.2 19.4 29.8 18.03 27.7 C14.33 21.28 17.16 13.07 24.03 10.29 C30.9 7.51 38.59 11.41 40.42 18.59 C43 20.2 46.5 21.4 50 21.4 C53.5 21.4 57 20.2 59.58 18.59 C61.41 11.41 69.1 7.51 75.97 10.29 C82.84 13.07 85.67 21.28 81.97 27.7 C80.6 29.8 79.5 32.2 79.8 36 C80 39.5 79.4 41.8 77.6 44 C76 46 72.4 48.5 72.4 51.7 C72.4 54 73.8 55.6 75.4 58.4 C78 62 80.4 66.5 81.4 72 C82.4 78 83 84 83.4 90 C83.7 96 83.9 102 84 110 Z')
      // His eyes: big and round, each reaching out to the edge of its bulge, with
      // a big roundish pupil looking very slightly out to the side and one glint,
      // lit from the same side in both.
      const eye = (x, side) => k.part(C(x, 21.6, 10), '#f4f2f3', { shade: [1.4, -1.8], w: 1.8, inside: k.fill(E(x + side * 1.2, 21.8, 6.6, 5.6), INK) })
        + k.fill(C(x + side * 1.2 - 3.6, 19.2, 1.9), WHITE)
      // His head alone, closed under the jaw from where it starts curving in, for
      // the shadow it casts on his body.
      const headD = 'M22.4 44 C20.6 41.8 20 39.5 20.2 36 C20.5 32.2 19.4 29.8 18.03 27.7 C14.33 21.28 17.16 13.07 24.03 10.29 C30.9 7.51 38.59 11.41 40.42 18.59 C43 20.2 46.5 21.4 50 21.4 C53.5 21.4 57 20.2 59.58 18.59 C61.41 11.41 69.1 7.51 75.97 10.29 C82.84 13.07 85.67 21.28 81.97 27.7 C80.6 29.8 79.5 32.2 79.8 36 C80 39.5 79.4 41.8 77.6 44 C68 53 32 53 22.4 44 Z'
      // Everything but his head, so the shadow falls only below it.
      const belowHead = `<path d="M-60 -60 H160 V160 H-60 Z ${headD}" clip-rule="evenodd"/>`
      // The shading on his body down its left side, rounding it; it runs up into
      // the shadow his head casts.
      const bodyShade = k.clip(belowHead, k.fill(P('M0 40 L43.21 40 L43.21 54.48 C37.86 54.05 32.6 57.4 30.6 61.8 C27.4 66 25.9 72 25.3 78 C24.3 87 23.5 96 23 110 L0 110 Z'), shadow(skin)))
      // A little shadow under each eye, on his face.
      const eyeShade = [26.4, 73.6].map((x) => k.fill(C(x, 23.8, 10.6), shadow(skin))).join('')
      // He sits a little low in the disc.
      const down = (art) => `<g transform="translate(0 3)">${art}</g>`
      return k.clip(TOPDISC, down(k.part(frog, skin, { inside: k.clip(belowHead, `<g transform="translate(0 4)">${k.fill(P(headD), shadow(skin))}</g>`) + bodyShade + eyeShade + // his armpits, thinning out at their tops
          ['M24.4 70.5 C23.6 76 22.9 82 22.4 88 C22.2 91 22 94 21.9 98', 'M75.6 70.5 C76.4 76 77.1 82 77.6 88 C77.8 91 78 94 78.1 98'].map((d) => k.taper(d, 2.2, { ends: 0.45, end: false })).join('') })))
        + down(''
        + eye(26.4, -1) + eye(73.6, 1)
        // Two little almond-shaped nostrils, their lower ends leaning in.
        + k.fill(E(46.6, 32, 1.6, 0.7, 35), INK) + k.fill(E(53.4, 32, 1.6, 0.7, -35), INK)
        // The mouth, one long line, its ends just turned down, stopping short of
        // the sides of his face.
        + k.line('M25.4 40.6 C31.5 39.8 68.5 39.8 74.6 40.6', 2)
        // A little curve of cheek at each end of it.
        + k.line('M26.4 39 C25.2 39.7 25.1 41.5 26.3 42.4 M73.6 39 C74.8 39.7 74.9 41.5 73.7 42.4', 1.6))
    },
  },
]

/** Is there a drawing called `id`? */
export const drawn = (id) => ROSTER.some((c) => c.id === id)

/** The character `id` (or the first, for one we don't know) as an <svg>. */
export function character(id, { title = '', bg = null, className = 'character' } = {}) {
  const c = ROSTER.find((r) => r.id === id) ?? ROSTER[0]
  return `<svg class="${className}" viewBox="-1 -1 102 102" aria-hidden="${title ? 'false' : 'true'}">${title ? `<title>${title}</title>` : ''}${RING}${paint(C(50, 57, 41 - DISC_INSET), `fill="${bg ?? c.bg}"`)}${c.draw(kit())}</svg>`
}
