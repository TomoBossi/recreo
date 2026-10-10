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
export const PLAYABLE = ['glorp', 'dingding', 'moai', 'sus', 'skull', 'villager', 'botar', 'capy']

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

  /** An arm, leg, stalk or tentacle: a thick line with an outline. */
  const limb = (d, colour, w = 10) => line(d, w, INK) + line(d, w - 6, colour)
  /** Drawn mirrored, left for right. */
  const mirror = (svg) => `<g transform="matrix(-1 0 0 1 100 0)">${svg}</g>`

  return { limb, mirror, fill, line, clip, part, torso, bust, eye, dot, shut, cross, brow, mouth, grin, tongue, smile, blush, shine }
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
        + k.part(R(43, 20, 51, 32, 13), '#8fdcff', { inside: k.fill(R(55, 25.8, 26, 6.2, 3.1), WHITE, 'opacity="0.9"') + k.fill(C(86.5, 28.9, 2.1), WHITE) })
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
    id: 'botar', name: 'Botar2.0', bg: '#ff9a3c', draw: (k) => {
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
]

/** Is there a drawing called `id`? */
export const drawn = (id) => ROSTER.some((c) => c.id === id)

/** The character `id` (or the first, for one we don't know) as an <svg>. */
export function character(id, { title = '', bg = null, className = 'character' } = {}) {
  const c = ROSTER.find((r) => r.id === id) ?? ROSTER[0]
  return `<svg class="${className}" viewBox="-1 -1 102 102" aria-hidden="${title ? 'false' : 'true'}">${title ? `<title>${title}</title>` : ''}${RING}${paint(C(50, 57, 41 - DISC_INSET), `fill="${bg ?? c.bg}"`)}${c.draw(kit())}</svg>`
}
