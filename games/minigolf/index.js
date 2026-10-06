/**
 * Minigolf: take turns putting round the course; fewest strokes wins.
 * Solo, or with up to three friends.
 */
import { defineGame } from '../kit/define.js'
import { board, escape, INK } from '../kit/svg.js'
import { startPanel } from '../kit/lobby.js'
import { int } from '../kit/random.js'
import { HOLES } from './holes.js'
import { roll, clampShot, UNIT, W, H, BALL, CUP, BORDER, MAX_SPEED, MAX_STROKES, TPS } from './physics.js'

// ------------------------------------------------------------------ rules

/** The seats still playing: everyone who started, less whoever forfeited. */
const playing = (s) => s.order.filter((seat) => !s.out.includes(seat))

/** Strokes so far, card by card. A forfeiter's card stops where they left. */
const total = (s, seat) => s.cards.reduce((n, c) => n + (c?.[seat] ?? 0), 0)

/** Par for the holes played so far, or for the whole course. */
const parOf = (s, upTo = s.course.length) => s.course.slice(0, upTo).reduce((n, i) => n + HOLES[i].par, 0)

const holeOf = (s, at = s.hole) => HOLES[s.course[at]]

/** A score against par, the way golfers say it. */
export function called(strokes, par) {
  if (strokes === 1) return 'hole in one!'
  return { [-3]: 'albatross!', [-2]: 'eagle!', [-1]: 'birdie!', 0: 'par', 1: 'bogey', 2: 'double bogey', 3: 'triple bogey' }[strokes - par] ?? `${strokes} strokes`
}

/** Strokes against par: "E", "+2", "−1". */
const versus = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`)

function startHole(s, index) {
  const hole = holeOf(s, index)
  const balls = {}
  for (const seat of playing(s)) balls[seat] = { pos: [hole.tee[0] * UNIT, hole.tee[1] * UNIT], strokes: 0, done: false }
  return { ...s, hole: index, balls, turn: playing(s)[0] }
}

function nextTurn(s) {
  const waiting = playing(s).filter((seat) => !s.balls[seat].done)
  if (waiting.length === 0) {
    const cards = s.cards.map((c, i) => (i === s.hole ? Object.fromEntries(playing(s).map((seat) => [seat, s.balls[seat].strokes])) : c))
    if (s.hole + 1 >= s.course.length) return { ...s, cards, phase: 'over', turn: null }
    return startHole({ ...s, cards }, s.hole + 1)
  }
  // Whoever has not putted yet goes first, in seat order; after that the
  // ball furthest from the cup, as in real golf; ties by seat.
  const fresh = waiting.filter((seat) => s.balls[seat].strokes === 0)
  if (fresh.length) return { ...s, turn: fresh[0] }
  const hole = holeOf(s)
  const away = (seat) => {
    const [x, y] = s.balls[seat].pos
    return (x - hole.cup[0] * UNIT) ** 2 + (y - hole.cup[1] * UNIT) ** 2
  }
  return { ...s, turn: waiting.sort((a, b) => away(b) - away(a) || a - b)[0] }
}

/** Which holes a round plays: all of them in order, or three drawn at random. */
function chooseCourse(length, rng) {
  if (length !== 'three') return { course: HOLES.map((_, i) => i), rng }
  const left = HOLES.map((_, i) => i)
  const course = []
  for (let k = 0; k < 3; k++) {
    const draw = int(rng, left.length)
    rng = draw.rng
    course.push(left.splice(draw.value, 1)[0])
  }
  return { course: course.sort((a, b) => a - b), rng }
}

const init = ({ seed = 1, options } = {}) => ({
  phase: 'waiting', length: options?.holes ?? 'all', rng: seed >>> 0,
  order: [], out: [], course: HOLES.map((_, i) => i), hole: 0, balls: {}, turn: null, cards: [], last: null,
})

const rules = {
  init,

  /** Before it starts, anyone seated may start it; then whoever's putt it is. */
  turn: (s) => (s.phase === 'playing' ? s.turn : 'any'),

  legal(s, move, seat) {
    if (move?.type === 'start') {
      return (s.phase === 'waiting' || s.phase === 'over') && Array.isArray(move.order)
        && move.order.length >= 1 && move.order.includes(seat) && move.order.every(Number.isInteger)
    }
    return s.phase === 'playing' && s.turn === seat && move?.type === 'shot'
      && Number.isInteger(move.dx) && Number.isInteger(move.dy)
      && (move.phase === undefined || (Number.isInteger(move.phase) && move.phase >= 0 && move.phase < 1e9))
  },

  apply(s, move, seat) {
    if (move.type === 'start') {
      const { course, rng } = chooseCourse(s.length, s.rng)
      const order = [...new Set(move.order)].sort((a, b) => a - b)
      return startHole({ ...s, phase: 'playing', order, out: [], course, rng, cards: course.map(() => null), last: null }, 0)
    }
    const ball = s.balls[seat]
    const shot = clampShot(move.dx, move.dy)
    const phase = move.phase ?? 0
    const result = roll(holeOf(s), ball.pos, shot, phase)
    const taken = ball.strokes + 1 + (result.drowned ? 1 : 0)
    const done = result.sunk || taken >= MAX_STROKES
    const strokes = done && !result.sunk ? MAX_STROKES : taken
    const balls = { ...s.balls, [seat]: { pos: result.end ?? ball.pos, strokes, done } }
    const last = { seat, hole: s.hole, from: ball.pos, shot, phase, sunk: !!result.sunk, drowned: !!result.drowned, strokes, gaveUp: done && !result.sunk }
    return nextTurn({ ...s, balls, last })
  },

  /**
   * Giving up leaves the course: the card stops where it stood and the
   * others play on. When only one player is left, they win there and then;
   * a solo player who gives up just ends the round.
   */
  forfeit(s, seat) {
    if (s.phase !== 'playing' || !playing(s).includes(seat)) return s
    const next = { ...s, out: [...s.out, seat], last: null }
    const left = playing(next)
    if (left.length === 0 || (left.length === 1 && s.order.length > 1)) return { ...next, phase: 'over', turn: null }
    const balls = { ...next.balls }
    delete balls[seat]
    return s.turn === seat ? nextTurn({ ...next, balls }) : { ...next, balls }
  },

  outcome(s, names) {
    if (s.phase !== 'over') return null
    const left = playing(s)
    const par = parOf(s)
    if (left.length === 0) return { winners: [], reason: 'gave up the round' }
    if (s.order.length === 1) return { winners: left, reason: `${total(s, left[0])} strokes, par ${par}` }
    const quitters = s.out.map((seat) => names[seat] ?? `player ${seat + 1}`)
    if (left.length === 1 && s.cards.some((c) => c === null)) return { winners: left, reason: `${quitters.join(' & ')} forfeited` }
    const best = Math.min(...left.map((seat) => total(s, seat)))
    return { winners: left.filter((seat) => total(s, seat) === best), reason: `${best} strokes, par ${par}` }
  },

  status(s, names, { seat: viewer = null } = {}) {
    const name = (seat) => names[seat] ?? `player ${seat + 1}`
    if (s.phase === 'waiting') return 'tee off when everyone is in'
    if (s.phase === 'over') {
      const result = rules.outcome(s, names)
      if (!result.winners.length) return result.reason
      const who = result.winners.map(name)
      if (s.order.length === 1) return result.reason
      return `${who.join(' & ')} ${who.length > 1 ? 'win' : 'wins'} — ${result.reason}`
    }
    const hole = holeOf(s)
    const last = s.last
    const note = !last ? ''
      : last.sunk ? `${name(last.seat)}: ${called(last.strokes, holeOf(s, last.hole).par)} · `
      : last.drowned ? `${name(last.seat)} found the water · `
      : last.gaveUp ? `${name(last.seat)} picked up · ` : ''
    const who = s.turn === viewer ? 'your putt!' : `${name(s.turn)} to putt`
    return `${note}hole ${s.hole + 1} of ${s.course.length}: ${hole.name}, par ${hole.par} — ${who}`
  },
}

// ------------------------------------------------------------------- view

/** How far, in screen pixels, a drag reaches for the strongest shot. */
const PULL_PX = 180
/** Below this a drag is a change of mind, and letting go putts nothing. */
const DEAD_PX = 12
/** Power to speed: a gentle curve, so short putts get the most room. */
const speedOf = (power) => MAX_SPEED * power ** 0.85
const powerOf = (speed) => (speed / MAX_SPEED) ** (1 / 0.85)

/** The windmill's turn now: the same clock on every screen, near enough. */
const millClock = () => Math.floor(Date.now() * TPS / 1000) % 1e8

const WOOD = '#d39a5c'
const WOOD_DARK = '#a8703d'
const GREEN = '#62c65e'
const GREEN_LIGHT = '#6dd168'
const WATER = '#5cc6f2'
const SAND = '#f2d48c'
const RUBBER = '#ff5d8f'
const TUNNEL = '#9b6cf0'

let uid = 0

function view(el, ctx) {
  const id = uid++
  const b = board(el, { width: W, height: H, pad: 6, className: 'golf', fit: true, onTurn: turned })
  const { svg, space } = b
  space.innerHTML = `<g class="course"></g><g class="trail"></g><g class="aims"></g><g class="balls"></g>
    <g class="over"></g><g class="fx"></g><g class="labels"></g>`
  const layer = (name) => space.querySelector(`.${name}`)
  /** The course turned to suit the stage: what stands upright stands up again. */
  function turned() {
    const pole = space.querySelector('.flagpole')
    if (pole && shownHole != null) pole.setAttribute('transform', b.upright(...HOLES[shownHole].cup))
    if (state) drawLabels()
  }

  const lobby = startPanel(el, {
    onStart: () => ctx.play({ type: 'start', order: Object.keys(info.names ?? {}).map(Number) }),
    startLabel: 'tee off!',
  })
  const banner = document.createElement('div')
  banner.className = 'golf-banner'
  banner.hidden = true
  const toast = document.createElement('div')
  toast.className = 'golf-toast'
  toast.hidden = true
  el.append(banner, toast)

  let state = null
  let info = {}
  let shownHole = null    // the hole drawn, as an index into HOLES
  let shownAt = -1        // and its place in the round
  let round = 0           // rounds begun since this view opened
  let announced = null    // the round and hole last announced
  let rolling = null      // the shot being played out
  let drag = null         // the pointer pulling back, while it does
  let aim = null          // my pull while dragging: { shot, power }
  const heard = new Map() // seat -> another player's aim, as they pull

  const myTurn = () => state?.phase === 'playing' && info.mySeat != null && state.turn === info.mySeat && !rolling
  const name = (seat) => info.names?.[seat] ?? `player ${seat + 1}`

  // ------------------------------------------------------------ the course

  function drawCourse(index) {
    const hole = HOLES[index]
    shownHole = index
    const B = BORDER
    const rect = ([x, y, w, h], r = 5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`
    const area = (a) => (a.length === 4 ? rect(a, 14) : `<circle cx="${a[0]}" cy="${a[1]}" r="${a[2]}"/>`)
    // Shapes that overlap read as one: every outline first, then every fill on top.
    const merged = (shapes, fill, line, cls = '') => shapes.length
      ? `<g class="${cls}" fill="${fill}" stroke="${INK}" stroke-width="${line * 2}" stroke-linejoin="round">${shapes.join('')}</g>
         <g fill="${fill}">${shapes.join('')}</g>` : ''
    const shadow = (shapes) => (shapes.length ? `<g transform="translate(4 5)" fill="#000" opacity="0.16">${shapes.join('')}</g>` : '')

    const walls = (hole.walls ?? []).map((r) => rect(r))
    const posts = (hole.posts ?? []).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`)
    const rails = (hole.rails ?? []).map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`)
    const water = (hole.water ?? []).map(area)
    const sand = (hole.sand ?? []).map(area)
    const stripes = Array.from({ length: Math.ceil(W / 100) }, (_, i) => `<rect x="${i * 100 + 50}" y="0" width="50" height="${H}"/>`).join('')

    // Slopes: chevrons pointing downhill.
    const slopes = (hole.slopes ?? []).map(({ at: [x, y, w, h], push: [px, py] }) => {
      const angle = Math.atan2(py, px) * 180 / Math.PI
      let marks = ''
      for (let gx = x + 40; gx < x + w - 20; gx += 80) {
        for (let gy = y + 40; gy < y + h - 20; gy += 80) {
          marks += `<path d="M-12 -14 L4 0 L-12 14" transform="translate(${gx} ${gy}) rotate(${angle})"/>`
        }
      }
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000" opacity="0.06"/>
        <g fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">${marks}</g>`
    }).join('')

    const tunnels = (hole.tunnels ?? []).map(([ax, ay, bx, by], i) => `
      <g class="tunnel-in" data-tunnel="${i}"><circle cx="${ax}" cy="${ay}" r="22" fill="${TUNNEL}" stroke="${INK}" stroke-width="3"/>
        <circle cx="${ax}" cy="${ay}" r="14" fill="${INK}"/>
        <path d="M${ax - 7} ${ay} a7 7 0 0 1 7 -7 a10 10 0 0 1 10 10" fill="none" stroke="${TUNNEL}" stroke-width="3" stroke-linecap="round" opacity="0.8"/></g>
      <g class="tunnel-out" data-tunnel="${i}"><circle cx="${bx}" cy="${by}" r="20" fill="none" stroke="${TUNNEL}" stroke-width="5" opacity="0.7"/>
        <circle cx="${bx}" cy="${by}" r="6" fill="${TUNNEL}"/></g>`).join('')

    const bumpers = (hole.bumpers ?? []).map(([x, y, r], i) => `
      <g class="bumper" data-bumper="${i}">
        <circle cx="${x}" cy="${y}" r="${r}" fill="${RUBBER}" stroke="${INK}" stroke-width="3"/>
        <circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="none" stroke="#fff" stroke-width="4" opacity="0.85"/>
        <circle cx="${x}" cy="${y}" r="${r * 0.25}" fill="${INK}"/></g>`).join('')

    const [tx, ty] = hole.tee
    const [cx, cy] = hole.cup
    layer('course').innerHTML = `
      <defs><clipPath id="golf-green-${id}"><rect x="${B}" y="${B}" width="${W - 2 * B}" height="${H - 2 * B}"/></clipPath>
        <pattern id="golf-planks-${id}" width="120" height="44" patternUnits="userSpaceOnUse">
          <path d="M0 1 H120 M30 0 V22 M90 22 V44 M0 23 H120" stroke="${WOOD_DARK}" stroke-width="2" opacity="0.28"/></pattern>
        <pattern id="golf-sand-${id}" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="1.4" fill="${WOOD_DARK}" opacity="0.35"/><circle cx="10" cy="10" r="1.2" fill="${WOOD_DARK}" opacity="0.3"/></pattern></defs>
      <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="${WOOD}" stroke="${INK}" stroke-width="4"/>
      <rect x="5" y="5" width="${W - 10}" height="${H - 10}" rx="12" fill="none" stroke="#fff" stroke-width="2" opacity="0.25"/>
      <g clip-path="url(#golf-green-${id})">
        <rect x="${B}" y="${B}" width="${W - 2 * B}" height="${H - 2 * B}" fill="${GREEN}"/>
        <g fill="${GREEN_LIGHT}">${stripes}</g>
        ${slopes}
        ${shadow(walls)}${shadow(posts)}
        <g transform="translate(4 5)" stroke="#000" stroke-width="14" stroke-linecap="round" opacity="0.16">${rails.join('')}</g>
        <g transform="translate(3 4)" fill="#000" opacity="0.14">${(hole.bumpers ?? []).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
        <g class="water">${merged(water, WATER, 3)}</g>
        <g class="ripples" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.45">${(hole.water ?? []).map((a) => {
          const [x, y] = a.length === 4 ? [a[0] + a[2] / 2, a[1] + a[3] / 2] : a
          return `<path d="M${x - 26} ${y - 8} q13 -8 26 0 t26 0"/><path d="M${x - 10} ${y + 16} q10 -6 20 0"/>`
        }).join('')}</g>
        ${merged(sand, SAND, 2)}${sand.length ? `<g fill="url(#golf-sand-${id})">${sand.join('')}</g>` : ''}
        <rect x="${tx - 22}" y="${ty - 30}" width="44" height="60" rx="9" fill="#3f9b40" stroke="${INK}" stroke-width="2.5" opacity="0.9"/>
        <circle cx="${tx}" cy="${ty}" r="4" fill="#fff" opacity="0.8"/>
        ${tunnels}
        <circle cx="${cx}" cy="${cy}" r="${CUP + 3}" fill="#000" opacity="0.12"/>
        <circle cx="${cx}" cy="${cy}" r="${CUP}" fill="${INK}"/>
        <path d="M${cx - CUP + 4} ${cy + 3} a${CUP - 4} ${CUP - 4} 0 0 0 ${2 * CUP - 8} 0" fill="none" stroke="#fff" stroke-width="2" opacity="0.25"/>
      </g>
      ${merged(walls, WOOD, 2)}
      <g fill="url(#golf-planks-${id})">${(hole.walls ?? []).filter(([, , w, h]) => w > 60 && h > 60).map(([x, y, w, h]) => `<rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="3"/>`).join('')}</g>
      <g fill="none" stroke="#fff" stroke-width="2.5" opacity="0.3">${(hole.walls ?? []).map(([x, y, w, h]) => `<rect x="${x + 5}" y="${y + 5}" width="${Math.max(0, w - 10)}" height="${Math.max(0, h - 10)}" rx="3"/>`).join('')}</g>
      ${merged(posts, WOOD, 2)}
      <g fill="none" stroke="#fff" stroke-width="3" opacity="0.3">${(hole.posts ?? []).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r * 0.62}"/>`).join('')}</g>
      ${rails.length ? `<g stroke="${INK}" stroke-width="17" stroke-linecap="round">${rails.join('')}</g><g stroke="${WOOD}" stroke-width="11" stroke-linecap="round">${rails.join('')}</g>` : ''}
      ${bumpers}
      <text class="frame-text" x="${B + 8}" y="${B - 7}">${escape(`${shownAt + 1}  ·  ${hole.name}  ·  par ${hole.par}`)}</text>`

    // Above the balls: the flag, and the windmill's roof and sails.
    // The flag stands up however the course is turned.
    let over = `<g class="flagpole" transform="${b.upright(cx, cy)}"><g class="flag">
        <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 66}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <path class="cloth" d="M${cx} ${cy - 66} l36 12 l-36 12 z" fill="${RUBBER}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/></g></g>`
    if (hole.mill) over += millMarkup(hole.mill)
    layer('over').innerHTML = over
    syncMill(millClock())
  }

  /**
   * The windmill: a roof over the tunnel and four sails turning above it.
   * A sail points straight at the gate in the middle of each stretch the
   * physics keeps the gate shut, so what blocks is what is seen to.
   */
  function millMarkup(mill) {
    const [hx, hy] = mill.hub
    const [gx, gy, gw, gh] = mill.gate
    const facing = Math.atan2(gy + gh / 2 - hy, gx + gw / 2 - hx) * 180 / Math.PI
    const middle = (mill.open + mill.quarter) / 2
    const base = facing - 90 * middle / mill.quarter
    const sail = (k) => `<g transform="rotate(${k * 90})">
        <rect x="14" y="-5" width="150" height="10" rx="4" fill="${WOOD_DARK}" stroke="${INK}" stroke-width="3"/>
        <rect x="52" y="-19" width="112" height="38" rx="5" fill="#fffaf0" stroke="${INK}" stroke-width="3" opacity="0.94"/>
        <path d="M80 -19 V19 M108 -19 V19 M136 -19 V19 M52 0 H164" stroke="${INK}" stroke-width="2" opacity="0.5"/></g>`
    return `<g transform="translate(${hx} ${hy})">
        <rect x="-62" y="-62" width="124" height="124" rx="14" fill="#000" opacity="0.15" transform="translate(5 6)"/>
        <rect x="-62" y="-62" width="124" height="124" rx="14" fill="${RUBBER}" stroke="${INK}" stroke-width="3"/>
        <path d="M-62 -62 L0 0 L62 -62 M-62 62 L0 0 L62 62" stroke="${INK}" stroke-width="2.5" opacity="0.35" fill="none"/>
        <g class="sails essential" style="--turn: ${4 * mill.quarter / TPS}s"><g transform="rotate(${base})">${[0, 1, 2, 3].map(sail).join('')}</g></g>
        <circle r="14" fill="${WOOD}" stroke="${INK}" stroke-width="3"/><circle r="5" fill="${INK}"/></g>`
  }

  /** Turn the sails to where they stand at a tick of the windmill's clock. */
  function syncMill(tick) {
    const sails = space.querySelector('.sails')
    const mill = HOLES[shownHole]?.mill
    if (!sails || !mill) return
    const period = 4 * mill.quarter
    // A delay counts from when the animation began, so begin it again now.
    sails.style.animationName = 'none'
    void sails.getBBox()
    sails.style.animationName = ''
    sails.style.animationDelay = `${-((tick % period) / TPS)}s`
  }

  // ------------------------------------------------------------- the balls

  function ballMarkup(seat, x, y, { r = BALL, ring = false } = {}) {
    return `<g class="ball" transform="translate(${x} ${y})">
      <ellipse cx="2.5" cy="4" rx="${r}" ry="${r * 0.8}" fill="#000" opacity="0.22"/>
      <circle r="${r}" fill="${ctx.colours[seat]}" stroke="${INK}" stroke-width="3"/>
      <circle cx="${-r * 0.32}" cy="${-r * 0.34}" r="${r * 0.3}" fill="#fff" opacity="0.75"/>
      ${ring ? `<circle class="turn-ring" r="${BALL + 9}" fill="none" stroke="#fff" stroke-width="3"/>` : ''}</g>`
  }

  /** Every ball still in play that has left the tee, and the one about to. */
  function drawBalls() {
    let html = ''
    for (const seat of state.order) {
      const ball = state.balls[seat]
      if (!ball) continue
      if (rolling?.seat === seat) {
        const [x, y] = rolling.at
        if (!rolling.hidden) html += ballMarkup(seat, x / UNIT, y / UNIT, { r: BALL * rolling.scale })
        continue
      }
      if (ball.done || (ball.strokes === 0 && seat !== state.turn)) continue
      html += ballMarkup(seat, ball.pos[0] / UNIT, ball.pos[1] / UNIT, { ring: seat === state.turn && !rolling })
    }
    layer('balls').innerHTML = html
  }

  /** Names over the ball whose putt it is, and a hint on a first putt; always upright. */
  function drawLabels() {
    let html = ''
    if (state?.phase === 'playing' && !rolling && state.turn != null && state.balls[state.turn]) {
      const [x, y] = state.balls[state.turn].pos.map((v) => v / UNIT)
      const mine = state.turn === info.mySeat
      const first = mine && state.hole === 0 && state.balls[state.turn].strokes === 0 && !drag
      // Another player's name, until their aim shows whose ball it is.
      const text = mine ? (first ? 'drag back anywhere to aim' : '') : heard.has(state.turn) ? '' : name(state.turn)
      if (text) {
        // Above the ball as the viewer sees it, whichever way the course is turned.
        const [ox, oy] = { 0: [0, -1], 90: [-1, 0], 180: [0, 1], 270: [1, 0] }[b.angle].map((v) => v * 34)
        html += `<text class="ball-label${first ? ' hint' : ''}" x="${x + ox}" y="${y + oy}" transform="${b.upright(x + ox, y + oy)}">${escape(text)}</text>`
      }
    }
    layer('labels').innerHTML = html
  }

  // --------------------------------------------------------------- aiming

  /** An aim, drawn at a ball: dots ahead the way it will go, the pull behind, and a ring for power. */
  function aimMarkup(seat, shot, faint) {
    const ball = state.balls[seat]
    if (!ball) return ''
    const [bx, by] = ball.pos.map((v) => v / UNIT)
    const speed = Math.hypot(shot[0], shot[1])
    if (!speed) return ''
    const power = Math.min(1, powerOf(speed))
    const [ux, uy] = [shot[0] / speed, shot[1] / speed]
    const reach = 30 + power * 230
    const hue = power < 0.5 ? '#5cbc3c' : power < 0.8 ? '#ffd23f' : RUBBER
    let dots = ''
    for (let d = 22; d < reach; d += 17) {
      const k = 1 - d / (reach + 40)
      dots += `<circle cx="${bx + ux * d}" cy="${by + uy * d}" r="${2.5 + 2.5 * k}"/>`
    }
    const tipX = bx + ux * reach
    const tipY = by + uy * reach
    const angle = Math.atan2(uy, ux) * 180 / Math.PI
    const back = 18 + power * 70
    const arc = 2 * Math.PI * 25
    return `<g class="aim${faint ? ' faint' : ''}">
      <line x1="${bx}" y1="${by}" x2="${bx - ux * back}" y2="${by - uy * back}" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
      <line x1="${bx}" y1="${by}" x2="${bx - ux * back}" y2="${by - uy * back}" stroke="${ctx.colours[seat]}" stroke-width="5" stroke-linecap="round"/>
      <g fill="#fff" stroke="${INK}" stroke-width="2">${dots}</g>
      <path d="M-9 -9 L5 0 L-9 9" transform="translate(${tipX} ${tipY}) rotate(${angle})" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-9 -9 L5 0 L-9 9" transform="translate(${tipX} ${tipY}) rotate(${angle})" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${bx}" cy="${by}" r="25" fill="none" stroke="${INK}" stroke-width="8" opacity="0.25"/>
      <circle cx="${bx}" cy="${by}" r="25" fill="none" stroke="${hue}" stroke-width="5" stroke-linecap="round"
        stroke-dasharray="${arc * power} ${arc}" transform="rotate(-90 ${bx} ${by})"/></g>`
  }

  function drawAims() {
    let html = ''
    if (state?.phase === 'playing' && !rolling) {
      for (const [seat, shot] of heard) if (seat === state.turn && seat !== info.mySeat) html += aimMarkup(seat, shot, true)
      if (aim && myTurn()) html += aimMarkup(info.mySeat, aim.shot, false)
    }
    layer('aims').innerHTML = html
  }

  /**
   * Pull back from anywhere and let go: the ball goes the other way, harder
   * the further the pull. Measured on the screen, so it feels the same on
   * a phone and on a big monitor, whichever way the course is turned.
   */
  svg.addEventListener('pointerdown', (e) => {
    if (!myTurn() || drag || e.button > 0) return
    e.preventDefault()
    svg.setPointerCapture(e.pointerId)
    drag = { id: e.pointerId, from: b.point(e), x: e.clientX, y: e.clientY }
    aim = null
    drawLabels()
  })
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const pixels = Math.hypot(e.clientX - drag.x, e.clientY - drag.y)
    const at = b.point(e)
    const dx = drag.from.x - at.x
    const dy = drag.from.y - at.y
    const len = Math.hypot(dx, dy)
    if (pixels < DEAD_PX || !len) {
      if (aim) { aim = null; ctx.share(null); drawAims() }
      return
    }
    const power = Math.min(1, (pixels - DEAD_PX) / (PULL_PX - DEAD_PX))
    const speed = speedOf(Math.max(0.01, power))
    aim = { shot: clampShot(dx / len * speed, dy / len * speed), power }
    ctx.share(aim.shot)
    drawAims()
  })
  const release = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return
    drag = null
    const shot = !cancel && aim && myTurn() ? aim.shot : null
    aim = null
    ctx.share(null)
    drawAims()
    drawLabels()
    if (shot) ctx.play({ type: 'shot', dx: shot[0], dy: shot[1], phase: millClock() })
  }
  svg.addEventListener('pointerup', (e) => release(e, false))
  svg.addEventListener('pointercancel', (e) => release(e, true))
  // A right click, or Escape, puts the putter down.
  svg.addEventListener('contextmenu', (e) => { if (drag) { e.preventDefault(); release({ pointerId: drag.id }, true) } })
  const onKey = (e) => { if (e.key === 'Escape' && drag) release({ pointerId: drag.id }, true) }
  document.addEventListener('keydown', onKey)

  // ---------------------------------------------------------- playing out

  /** Play a shot out on screen, tick by tick at the course's own pace, then call done. */
  function playOut(last, holeIndex, done) {
    const hole = HOLES[holeIndex]
    const result = roll(hole, last.from, last.shot, last.phase ?? 0)
    if (hole.mill) syncMill(last.phase ?? 0)
    const events = [...result.events]
    const start = performance.now()
    const trail = []
    rolling = { seat: last.seat, at: last.from, scale: 1, hidden: false, result }
    drawAims()
    drawLabels()
    const finish = () => {
      if (!rolling) return
      cancelAnimationFrame(rolling.frame)
      clearTimeout(rolling.timer)
      rolling = null
      layer('trail').innerHTML = ''
      done()
    }
    rolling.finish = finish
    const end = result.path.length - 1
    const frame = (now) => {
      if (!rolling) return
      // A frame's time can be a touch before the moment the roll began.
      const tick = Math.max(0, Math.min(end, Math.floor((now - start) * TPS / 1000)))
      rolling.at = result.path[tick]
      while (events.length && events[0].t <= tick) happen(events.shift())
      trail.push(rolling.at)
      if (trail.length > 16) trail.shift()
      layer('trail').innerHTML = trail.length > 1
        ? `<polyline points="${trail.map(([x, y]) => `${x / UNIT},${y / UNIT}`).join(' ')}" fill="none" stroke="${ctx.colours[last.seat]}" stroke-width="${BALL * 1.3}" stroke-linecap="round" stroke-linejoin="round" opacity="0.28"/>`
        : ''
      drawBalls()
      if (tick < end) { rolling.frame = requestAnimationFrame(frame); return }
      // At rest — or in: the ball drops into the cup before it goes.
      if (result.sunk) return sink(last, hole, finish)
      if (result.drowned) return splash(last, finish)
      rolling.timer = setTimeout(finish, 120)
    }
    rolling.frame = requestAnimationFrame(frame)
  }

  /** Something happening mid-roll: a bumper's kick, a tunnel's swallow. */
  function happen(event) {
    if (event.kind === 'bumper') kick(space.querySelector(`[data-bumper="${event.i}"]`), 'hit')
    if (event.kind === 'tunnel') {
      kick(space.querySelector(`.tunnel-in[data-tunnel="${event.i}"]`), 'gulp')
      kick(space.querySelector(`.tunnel-out[data-tunnel="${event.i}"]`), 'gulp')
    }
  }

  /** Restart a one-off CSS animation on an element. */
  function kick(node, cls) {
    if (!node) return
    node.classList.remove(cls)
    void node.getBBox?.()
    node.classList.add(cls)
  }

  function sink(last, hole, finish) {
    const [cx, cy] = hole.cup.map((v) => v * UNIT)
    const [x0, y0] = rolling.at
    const start = performance.now()
    const drop = (now) => {
      if (!rolling) return
      const k = Math.max(0, Math.min(1, (now - start) / 260))
      rolling.at = [x0 + (cx - x0) * k, y0 + (cy - y0) * k]
      rolling.scale = 1 - 0.6 * k
      drawBalls()
      if (k < 1) { rolling.frame = requestAnimationFrame(drop); return }
      rolling.hidden = true
      drawBalls()
      kick(space.querySelector('.flag'), 'cheer')
      confetti(hole.cup, ctx.colours[last.seat], last.strokes === 1 ? 34 : 16)
      say(last.seat, called(last.strokes, hole.par), last.strokes <= hole.par - 1 ? 'great' : last.strokes <= hole.par ? 'good' : 'meh')
      rolling.timer = setTimeout(finish, 650)
    }
    rolling.frame = requestAnimationFrame(drop)
  }

  function splash(last, finish) {
    const [x, y] = rolling.at.map((v) => v / UNIT)
    rolling.hidden = true
    drawBalls()
    layer('fx').insertAdjacentHTML('beforeend', `<g class="splash" transform="translate(${x} ${y})">
      ${[0, 1, 2].map((i) => `<circle r="10" style="animation-delay: ${i * 120}ms" fill="none" stroke="#fff" stroke-width="4"/>`).join('')}</g>`)
    const node = layer('fx').lastElementChild
    setTimeout(() => node.remove(), 1100)
    say(last.seat, 'splash! +1', 'meh')
    rolling.timer = setTimeout(finish, 750)
  }

  function confetti([x, y], colour, count) {
    const colours = [colour, '#ffd23f', '#fff', RUBBER, '#5cbc3c', '#2fa4e6']
    let bits = ''
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4
      const d = 40 + Math.random() * 60
      bits += `<rect x="-4" y="-2.5" width="8" height="5" rx="1.5" fill="${colours[i % colours.length]}" stroke="${INK}" stroke-width="1"
        style="--dx: ${Math.cos(a) * d}px; --dy: ${Math.sin(a) * d - 20}px; --spin: ${Math.round(Math.random() * 720 - 360)}deg"/>`
    }
    layer('fx').insertAdjacentHTML('beforeend', `<g class="confetti" transform="translate(${x} ${y})">${bits}</g>`)
    const node = layer('fx').lastElementChild
    setTimeout(() => node.remove(), 1200)
  }

  /** A word over the course: "birdie!", "splash! +1". */
  function say(seat, text, mood) {
    const who = seat === info.mySeat ? '' : `<span class="who"><i style="background:${ctx.colours[seat]}"></i>${escape(name(seat))}</span>`
    toast.innerHTML = `${who}<b>${escape(text)}</b>`
    toast.className = `golf-toast ${mood}`
    toast.hidden = false
    void toast.offsetWidth
    toast.classList.add('show')
    clearTimeout(say.timer)
    say.timer = setTimeout(() => { toast.hidden = true }, 1700)
  }

  /** The new hole's name, its par, and how everyone stands. */
  function announce() {
    const hole = holeOf(state)
    const chips = state.order.length > 1 || state.hole > 0
      ? `<div class="standing">${state.order.filter((seat) => !state.out.includes(seat)).map((seat) => {
        const strokes = total(state, seat)
        return `<span><i style="background:${ctx.colours[seat]}"></i>${escape(name(seat))} <b>${state.hole ? versus(strokes - parOf(state, state.hole)) : ''}</b></span>`
      }).join('')}</div>` : ''
    banner.innerHTML = `<small>hole ${state.hole + 1} of ${state.course.length}</small><strong>${escape(hole.name)}</strong><span class="par">par ${hole.par}</span>${chips}`
    banner.hidden = false
    banner.classList.remove('show')
    void banner.offsetWidth
    banner.classList.add('show')
    clearTimeout(announce.timer)
    announce.timer = setTimeout(() => { banner.hidden = true }, 2400)
  }

  // ------------------------------------------------------------ updating

  /** Draw the hole the round is on, announcing it if it is new. */
  function settle() {
    if (state.phase === 'playing') {
      if (shownAt !== state.hole || shownHole !== state.course[state.hole]) {
        shownAt = state.hole
        drawCourse(state.course[state.hole])
      }
      if (announced !== `${round}:${state.hole}`) {
        announced = `${round}:${state.hole}`
        announce()
      }
    }
    drawBalls()
    drawAims()
    drawLabels()
    overlay()
  }

  return {
    update(next, nextInfo) {
      const previous = state
      state = next
      info = nextInfo
      if (state.phase === 'playing' && previous?.phase !== 'playing') round++
      svg.classList.toggle('my-turn', myTurn())
      if (state.phase === 'waiting' || !state.order.length) {
        if (rolling) rolling.finish()
        if (shownHole !== state.course[0] || shownAt !== 0) { shownAt = 0; drawCourse(state.course[0]) }
        layer('balls').innerHTML = ''
        drawLabels()
        overlay()
        return
      }
      // A new shot since we last looked is played out rather than jumped
      // to, on its own hole; only then does the round move on.
      const fresh = previous?.phase === 'playing' && state.last && state.last !== previous.last
      if (fresh) {
        if (rolling) rolling.finish()
        const holeIndex = previous.course[state.last.hole]
        heard.delete(state.last.seat)
        if (shownHole !== holeIndex) { shownAt = state.last.hole; drawCourse(holeIndex) }
        // The ball the shot moved is drawn from where it was until it rolls.
        state = { ...state, balls: { ...state.balls, [state.last.seat]: { ...previous.balls[state.last.seat] } } }
        const real = next
        playOut(next.last, holeIndex, () => {
          state = real
          svg.classList.toggle('my-turn', myTurn())
          settle()
        })
        overlay()
        return
      }
      if (rolling) return
      settle()
    },
    hear(shot, seat) {
      if (Array.isArray(shot) && shot.length === 2 && shot.every(Number.isFinite)) heard.set(seat, shot)
      else heard.delete(seat)
      drawAims()
      drawLabels()
    },
    destroy() {
      if (rolling) { cancelAnimationFrame(rolling.frame); clearTimeout(rolling.timer) }
      document.removeEventListener('keydown', onKey)
      svg.remove()
    },
  }

  // The start button, and the scorecard at the end, over the course.
  function overlay() {
    lobby.update({
      open: state.phase !== 'playing' && !rolling,
      seated: Object.keys(info.names ?? {}).length,
      min: 1,
      mine: info.mySeat != null,
      again: state.phase === 'over',
      extra: state.phase === 'over' ? scorecard() : '',
    })
  }

  function scorecard() {
    const rows = state.order.map((seat) => {
      const cells = state.cards.map((c, i) => {
        const n = c?.[seat]
        const par = holeOf(state, i).par
        return `<td class="${n == null ? '' : n < par ? 'under' : n > par ? 'over' : ''}">${n ?? '–'}</td>`
      }).join('')
      const out = state.out.includes(seat)
      return `<tr class="${out ? 'out' : ''}"><th><span class="dot" style="background:${ctx.colours[seat]}"></span>${escape(name(seat))}</th>${cells}<td class="sum"><b>${out ? 'out' : total(state, seat)}</b></td></tr>`
    }).join('')
    return `<div class="golf-card-wrap"><table class="golf-card">
      <tr><th></th>${state.course.map((_, i) => `<th>${i + 1}</th>`).join('')}<th class="sum">total</th></tr>
      <tr class="par"><th>par</th>${state.course.map((i) => `<td>${HOLES[i].par}</td>`).join('')}<td class="sum">${parOf(state)}</td></tr>${rows}</table></div>`
  }
}

// ------------------------------------------------------------------- game

export default defineGame({
  id: 'minigolf',
  styles: new URL('./style.css', import.meta.url),
  name: 'Minigolf',
  tone: 'leaf',
  kind: 'turns',
  seats: { min: 1, max: 4 },
  pieces: 'players',
  options: {
    holes: { label: 'holes', choices: { all: 'all 9', three: '3 at random' }, default: 'all' },
  },
  rules,
  view,
  // On a phone the course stands on end, filling the column's width.
  phoneHeight: (width) => width * (W + 12) / (H + 12),
  icon: `
    <ellipse cx="28" cy="36" rx="22" ry="7" fill="#6bd66b" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="33" cy="36" rx="5" ry="2" fill="${INK}"/>
    <line x1="33" y1="36" x2="33" y2="6" stroke="${INK}" stroke-width="2.5"/>
    <path d="M33 6 L48 11 L33 16 Z" fill="#ff5d8f" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="16" cy="33" r="3.5" fill="#fff" stroke="${INK}" stroke-width="2"/>`,
})
