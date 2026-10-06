/**
 * Chess. The rules live in rules.js; this is the game's face: a board
 * drawn from shapes, pieces drawn from shapes, and moving by picking a piece
 * and then a square — which works the same with a mouse and a finger.
 */
import { defineGame } from '../kit/define.js'
import { board, shape, escape, INK } from '../kit/svg.js'
import { countdown, sound } from '../kit/sound.js'
import { initial, isLegal, play, legalMoves, cannotMate, file, rank } from './rules.js'

const LIGHT = '#fbefd5'
const DARK = '#b79be8'
const WHITE = '#fffaf0'
const BLACK = '#3b2f5c'

/**
 * Each piece as shapes in a 100×100 box, outlined in ink: a Staunton set,
 * every piece on the same two-tier base and collar, with a waisted stem
 * and its own head. Detail lines use currentColor, which the board sets to
 * a shade that reads on that side's colour.
 */
const BASE = `<path d="M23 86 H77 Q81 86 81 82 V79 Q81 75 77 75 H23 Q19 75 19 79 V82 Q19 86 23 86 Z"/>
  <rect x="29" y="69" width="42" height="7" rx="3"/>`
/** The knight's head and neck, in one outline. */
const HEAD = 'M33 69 C33 60 37 53 44 48 C39 47 33 49 28 47 C22 45 21 38 26 34 L39 22 C41 16 45 12 51 11 L54 4 L58 12 C69 15 75 28 73 44 C72 54 69 62 67 69 Z'
const STEM = (top, half) => `<path d="M${50 - half} ${top} Q${50 - half + 2} ${(top + 69) / 2} ${50 - half - 9} 69 H${50 + half + 9} Q${50 + half - 2} ${(top + 69) / 2} ${50 + half} ${top} Z"/>`
const PIECES = {
  P: `${BASE}${STEM(46, 8)}
      <rect x="37" y="40" width="26" height="7" rx="3.5"/>
      <circle cx="50" cy="28" r="12"/>`,
  R: `${BASE}<path d="M36 36 L38 69 H62 L64 36 Z"/>
      <rect x="31" y="31" width="38" height="7" rx="2"/>
      <path d="M31 14 H39 V20 H46 V14 H54 V20 H61 V14 H69 V31 H31 Z"/>`,
  // The mane runs from the back of the ear, on the outline itself so no
  // sliver shows between them; the head is filled, then the mane drawn,
  // then the outline laid over both, so the mane tucks under the border.
  N: `${BASE}
      <path d="${HEAD}" stroke="none"/>
      <path class="detail" d="M58 12 C66 22 68 36 66 50" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <path d="${HEAD}" fill="none"/>
      <circle class="detail" cx="47" cy="24" r="2.6" fill="currentColor" stroke="none"/>
      <circle class="detail" cx="29.5" cy="40" r="1.6" fill="currentColor" stroke="none"/>`,
  B: `${BASE}${STEM(53, 7)}
      <rect x="38" y="47" width="24" height="7" rx="3.5"/>
      <path d="M50 18 C62 26 64 39 57 47 H43 C36 39 38 26 50 18 Z"/>
      <path class="detail" d="M54 27 L46 37" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <circle cx="50" cy="13" r="5"/>`,
  Q: `${BASE}${STEM(53, 9)}
      <rect x="35" y="47" width="30" height="7" rx="3.5"/>
      <path d="M31 25 L38 43 L43 20 L50 40 L57 20 L62 43 L69 25 L65 48 H35 Z"/>
      <circle cx="31" cy="22" r="4.5"/><circle cx="43" cy="17" r="4.5"/><circle cx="57" cy="17" r="4.5"/><circle cx="69" cy="22" r="4.5"/>`,
  K: `${BASE}${STEM(53, 9)}
      <rect x="35" y="47" width="30" height="7" rx="3.5"/>
      <path d="M38 48 L35 34 Q50 25 65 34 L62 48 Z"/>
      <path d="M46.5 5 H53.5 V10.5 H59 V17.5 H53.5 V27.5 H46.5 V17.5 H41 V10.5 H46.5 Z"/>`,
}

let uid = 0

// ------------------------------------------------------------------ rules

const turn = (s) => (s.result ? null : s.turn === 'w' ? 0 : 1)

/**
 * The clock, when the table chose one: each side's time left, in ms, and
 * the increment. A move says how long its player thought — measured on
 * their own machine, from when the other's move reached them — so peers'
 * clocks never need to agree, and every peer subtracts the same numbers.
 * As on lichess, neither clock runs until each side has made a move.
 */
function startClock(options) {
  const minutes = parseInt(options?.time, 10)
  if (!minutes) return null
  return { left: [minutes * 60_000, minutes * 60_000], inc: (parseInt(options?.increment, 10) || 0) * 1000, moves: 0 }
}

/** A side's time ran out on its move: a loss, unless the other side could never mate. */
function timeUp(s, seat) {
  const clock = s.clock && { ...s.clock, left: s.clock.left.map((v, i) => (i === seat ? 0 : v)) }
  const winner = seat === 0 ? 'b' : 'w'
  if (cannotMate(s.board, winner)) return { ...s, clock, result: { draw: 'timeout vs insufficient material' } }
  return { ...s, clock, result: { winner, time: true } }
}

const rules = {
  init: ({ options } = {}) => ({ ...initial(), clock: startClock(options) }),
  turn,

  legal(s, move, seat) {
    if (turn(s) !== seat) return false
    if (move?.timeout) return !!s.clock
    return isLegal(s, move) && (!s.clock || (Number.isFinite(move.spent) && move.spent >= 0))
  },

  apply(s, move, seat) {
    if (move.timeout) return timeUp(s, seat)
    const clock = s.clock && { ...s.clock, left: [...s.clock.left], moves: s.clock.moves + 1 }
    if (clock) {
      // As on lichess, neither thinking time nor the increment counts until
      // both sides have made their first move.
      if (s.clock.moves >= 2) {
        clock.left[seat] -= Math.round(move.spent)
        if (clock.left[seat] <= 0) return timeUp({ ...s, clock: { ...clock, left: clock.left.map((v, i) => (i === seat ? 0 : v)) } }, seat)
        clock.left[seat] += clock.inc
      }
    }
    return { ...play(s, { from: move.from, to: move.to, promo: move.promo }), clock }
  },

  /** Resigning: the other colour wins. */
  forfeit: (s, seat) => (s.result ? s : { ...s, result: { winner: seat === 0 ? 'b' : 'w', forfeited: seat } }),

  outcome(s, names) {
    if (s.result?.winner) {
      const loser = s.result.winner === 'w' ? 1 : 0
      const reason = s.result.forfeited != null ? `${names[loser] ?? 'the other player'} resigned`
        : s.result.time ? `${names[loser] ?? 'the other player'} ran out of time` : 'checkmate'
      return { winners: [1 - loser], reason }
    }
    if (s.result?.draw === 'timeout vs insufficient material') return { winners: [], draw: true, reason: 'out of time, but no mate was possible' }
    if (s.result?.draw) return { winners: [], draw: true, reason: `a draw by ${s.result.draw}` }
    return null
  },


  status(s, names) {
    const name = (seat) => names[seat] ?? (seat === 0 ? 'white' : 'black')
    if (s.result?.forfeited != null) return `${name(s.result.forfeited)} resigned — ${name(1 - s.result.forfeited)} wins!`
    if (s.result?.time) { const loser = s.result.winner === 'w' ? 1 : 0; return `${name(loser)} ran out of time — ${name(1 - loser)} wins!` }
    if (s.result?.draw === 'timeout vs insufficient material') return `time ran out, but ${name(s.turn === 'w' ? 1 : 0)} could never mate — a draw`
    if (s.result?.winner) return `checkmate — ${name(s.result.winner === 'w' ? 0 : 1)} wins!`
    if (s.result?.draw) return `a draw by ${s.result.draw}`
    const mover = name(s.turn === 'w' ? 0 : 1)
    return s.check ? `${mover} is in check!` : `${mover} to move`
  },
}

// ------------------------------------------------------------------- view

function view(el, ctx) {
  const id = uid++
  const b = board(el, { width: 800, height: 800, pad: 6, className: 'chess' })
  const { svg, space } = b
  // The clocks and the promotion choice never turn with the board.
  const over = shape('g')
  svg.append(over)

  let state = null
  let info = {}
  let picked = null
  let promoting = null
  let premove = null      // { from, to, promo } queued while the other side thinks
  let receivedAt = performance.now() // when the last move reached us: our thinking starts here
  let seenMoves = -1
  let flagged = -1        // the move count at which we last reported running out

  // Black sees the board turned round. The whole board is rotated as one
  // group, pieces turned back upright, so a square sits at the same place
  // in the board's own coordinates for both players — which is what lets
  // a cursor over e4 land on e4 for everyone.
  // Which way up follows the seat you hold, started or not (info.mySeat is
  // only set once the game can begin): black sees black at the bottom from
  // the moment they sit; watchers see white at the bottom.
  const seat = () => ctx.mySeat
  const flipped = () => seat() === 1
  const at = (sq) => ({ x: file(sq) * 100, y: (7 - rank(sq)) * 100 })
  const myTurn = () => info.mySeat != null && info.turn === info.mySeat
  const myColour = () => (info.mySeat === 0 ? 'w' : 'b')
  const playing = () => info.mySeat != null && !state.result && info.turn != null
  /** My legal moves as if it were my turn now: where a premove may go. */
  const premoves = () => legalMoves({ ...state, turn: myColour(), ep: null })

  /** Time left on a side's clock right now, counting the running one down. */
  function timeLeft(seat) {
    const c = state.clock
    if (!c) return null
    const running = !state.result && turn(state) === seat && c.moves >= 2
    return Math.max(0, c.left[seat] - (running ? performance.now() - receivedAt : 0))
  }
  const format = (ms) => {
    if (ms < 10_000) return `${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`
    const total = Math.ceil(ms / 1000)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  // Clocks sit beside the board in a wide window, above and below in a tall one.
  let layout = null
  function clockLayout() {
    if (!state?.clock) return null
    const box = el.getBoundingClientRect()
    return box.width >= box.height * 1.2 ? 'side' : 'stack'
  }
  // Clock cards, in board units (a square is 100): beside the board, top
  // and bottom edges level with it; or above and below it in a tall window.
  const CARD = { w: 250, h: 112, gap: 22 }
  const STACK = CARD.h + 20 // room above and below the board for a card and its gap
  function frame() {
    layout = clockLayout()
    b.margin(layout === 'side' ? { right: CARD.gap + CARD.w } : layout === 'stack' ? { top: STACK, bottom: STACK } : {})
  }
  new ResizeObserver(() => { if (state && clockLayout() !== layout) { frame(); draw() } }).observe(el)

  /** The two clocks: the other side's at the top, ours (or white's, watching) at the bottom. */
  function drawClocks() {
    const g = svg.querySelector('.clocks')
    if (!g) return
    if (!layout) { g.innerHTML = ''; return }
    const bottom = seat() ?? 0
    const top = 1 - bottom
    // A clock is only "running" once the game is: both seated, not over.
    const started = !state.result && Object.keys(info.names ?? {}).length === 2
    const card = (seat, x, y) => {
      const ms = timeLeft(seat)
      const running = started && turn(state) === seat
      const low = running && ms < 10_000
      const fill = low ? 'var(--berry)' : running ? 'var(--sun)' : 'var(--panel)'
      const ink = low ? '#fff' : running ? 'var(--on-accent)' : 'var(--text)'
      const name = info.names?.[seat] ?? (seat === 0 ? 'white' : 'black')
      const short = name.length > 15 ? `${name.slice(0, 14)}…` : name
      // Two rows: whose clock — their colour and name — and under it, big, the time.
      return `<g class="clock">
        <rect x="${x}" y="${y}" width="${CARD.w}" height="${CARD.h}" rx="12" fill="${fill}" stroke="var(--seat-line)" stroke-width="4"/>
        <rect x="${x + 16}" y="${y + 16}" width="22" height="22" rx="5" fill="${seat === 0 ? WHITE : BLACK}" stroke="var(--seat-line)" stroke-width="3"/>
        <text x="${x + 48}" y="${y + 34}" class="clock-name" fill="${ink}">${escape(short)}</text>
        <text x="${x + 16}" y="${y + CARD.h - 18}" class="clock-time" fill="${ink}">${format(ms)}</text>
      </g>`
    }
    // Beside the board both stack in one column; above and below it the
    // other side's clock sits at the left and yours at the right, across
    // the board from each other.
    g.innerHTML = layout === 'side'
      ? card(top, 800 + CARD.gap, 0) + card(bottom, 800 + CARD.gap, 800 - CARD.h)
      : card(top, 0, -STACK) + card(bottom, 800 - CARD.w, 800 + STACK - CARD.h)
  }

  // The running clock ticks; at zero on our own move, we say so.
  // Redrawn only when what they show changes: a still clock costs nothing.
  // It runs only while a clock is counting down: a waiting game, a game
  // with no clock and a finished game wake nothing.
  let shown = ''
  let ticker = null
  // Each side's last five seconds tick aloud, for players and watchers alike.
  const ticks = [countdown(), countdown()]
  const tick = () => {
    const now = [0, 1].map((seat) => format(timeLeft(seat))).join() + turn(state) + Object.keys(info.names ?? {}).length
    if (now !== shown) { shown = now; drawClocks() }
    const running = turn(state)
    if (running === 0 || running === 1) ticks[running].update(timeLeft(running))
    if (myTurn() && state.clock.moves >= 2 && timeLeft(info.mySeat) <= 0 && flagged !== state.clock.moves) {
      flagged = state.clock.moves
      ctx.play({ timeout: true })
    }
  }
  const counting = () => !!state?.clock && !state.result && state.clock.moves >= 2 && Object.keys(info.names ?? {}).length === 2
  const keepTime = () => {
    if (counting() && !ticker) ticker = setInterval(tick, 100)
    if (!counting() && ticker) { clearInterval(ticker); ticker = null }
  }

  /** Make a move, saying how long we thought about it. */
  const send = (move) => ctx.play({ ...move, spent: Math.round(performance.now() - receivedAt) })

  function draw() {
    b.turn(flipped() ? 180 : 0)
    const ahead = !myTurn()
    const moves = picked != null ? (ahead ? premoves() : legalMoves(state)).filter((m) => m.from === picked) : []
    const targets = new Set(moves.map((m) => m.to))
    let html = ''
    for (let sq = 0; sq < 64; sq++) {
      const { x, y } = at(sq)
      const dark = (file(sq) + rank(sq)) % 2 === 0
      html += `<rect x="${x}" y="${y}" width="100" height="100" fill="${dark ? DARK : LIGHT}" data-sq="${sq}"/>`
      if (state.last && (state.last.from === sq || state.last.to === sq)) {
        html += `<rect x="${x}" y="${y}" width="100" height="100" fill="var(--sun)" opacity="0.45" pointer-events="none"/>`
      }
      if (premove && (premove.from === sq || premove.to === sq)) {
        html += `<rect x="${x}" y="${y}" width="100" height="100" fill="#2fa4e6" opacity="0.45" pointer-events="none"/>`
      }
      if (sq === picked) {
        html += `<rect x="${x + 3}" y="${y + 3}" width="94" height="94" fill="none" stroke="var(--ink)" stroke-width="6" rx="6" pointer-events="none"/>`
      }
    }
    // A king in check glows.
    if (state.check) {
      const king = state.board.indexOf(`${state.turn}K`)
      const { x, y } = at(king)
      html += `<circle cx="${x + 50}" cy="${y + 50}" r="46" fill="var(--berry)" opacity="0.55" pointer-events="none"/>`
    }
    for (let sq = 0; sq < 64; sq++) {
      const p = state.board[sq]
      if (!p) continue
      const { x, y } = at(sq)
      const fill = p[0] === 'w' ? WHITE : BLACK
      const line = p[0] === 'w' ? 'var(--ink)' : '#120d22'
      const detail = p[0] === 'w' ? 'var(--ink)' : '#c9bdf0'
      const upright = ` ${b.upright(50, 50)}`
      html += `<g transform="translate(${x} ${y})${upright}" pointer-events="none" class="piece"
        fill="${fill}" stroke="${line}" color="${detail}" stroke-width="4" stroke-linejoin="round">${PIECES[p[1]]}</g>`
    }
    for (const sq of targets) {
      const { x, y } = at(sq)
      html += state.board[sq]
        ? `<circle cx="${x + 50}" cy="${y + 50}" r="44" fill="none" stroke="var(--ink)" stroke-width="6" opacity="0.5" pointer-events="none"/>`
        : `<circle cx="${x + 50}" cy="${y + 50}" r="14" fill="var(--ink)" opacity="0.4" pointer-events="none"/>`
    }
    space.innerHTML = `<defs><clipPath id="chess-clip-${id}"><rect width="800" height="800" rx="8"/></clipPath></defs>
      <rect x="-6" y="-6" width="812" height="812" rx="14" fill="var(--ink)"/><g clip-path="url(#chess-clip-${id})">${html}</g>`
    let top = '<g class="clocks"></g>'
    if (promoting) {
      top += `<rect x="150" y="300" width="500" height="200" rx="18" fill="#fffaf0" stroke="var(--ink)" stroke-width="6"/>`
      ;['Q', 'R', 'B', 'N'].forEach((kind, i) => {
        const colour = state.turn === 'w' ? WHITE : BLACK
        top += `<g transform="translate(${180 + i * 115} 345)" class="piece promo" data-promo="${kind}"
          fill="${colour}" stroke="var(--ink)" color="${state.turn === 'w' ? 'var(--ink)' : '#c9bdf0'}" stroke-width="4" stroke-linejoin="round">
          <rect width="100" height="100" fill="transparent" stroke="none"/>${PIECES[kind]}</g>`
      })
    }
    over.innerHTML = top
    drawClocks()
  }

  svg.addEventListener('click', (e) => {
    if (!state || !playing()) return
    const promo = e.target.closest('[data-promo]')?.dataset.promo
    if (promoting) {
      if (promo) send({ ...promoting, promo })
      promoting = null
      picked = null
      draw()
      return
    }
    const sq = Number(e.target.dataset?.sq)
    if (!Number.isInteger(sq)) return
    const mine = state.board[sq]?.[0] === myColour()
    if (!myTurn()) {
      // The other side is thinking: queue a premove, as on lichess. A
      // promotion premove becomes a queen; anything else clears it.
      if (picked != null && sq !== picked) {
        const options = premoves().filter((m) => m.from === picked && m.to === sq)
        if (options.length) { premove = options.find((m) => m.promo === 'Q') ?? options[0]; picked = null; draw(); return }
      }
      premove = null
      picked = mine && sq !== picked ? sq : null
      if (picked != null) sound.play('pick', { from: el })
      draw()
      return
    }
    if (picked != null && sq !== picked) {
      const candidates = legalMoves(state).filter((m) => m.from === picked && m.to === sq)
      if (candidates.length > 1) { promoting = { from: picked, to: sq }; draw(); return }
      if (candidates.length === 1) { send(candidates[0]); picked = null; draw(); return }
    }
    picked = mine && sq !== picked ? sq : null
    if (picked != null) sound.play('pick', { from: el })
    draw()
  })
  // A right click clears a queued premove.
  svg.addEventListener('contextmenu', (e) => {
    if (!premove && picked == null) return
    e.preventDefault()
    premove = null
    picked = null
    draw()
  })

  return {
    update(next, nextInfo) {
      const wasMyTurn = state && myTurn()
      const before = state
      state = next
      info = nextInfo
      // A move, anyone's, is heard: a piece set down, or one knocked off.
      if (before && before.board.join() !== state.board.join()) {
        const pieces = (b) => b.filter(Boolean).length
        const lost = pieces(before.board) - pieces(state.board)
        if (lost >= 0) sound.play(lost > 0 ? 'capture' : 'place', { from: el })
      }
      const count = state.clock?.moves ?? Object.keys(state.seen ?? {}).length
      if (count !== seenMoves) { seenMoves = count; receivedAt = performance.now() }
      if (!state.result && info.turn === null) premove = null
      if (wasMyTurn && !myTurn()) { picked = null; promoting = null }
      svg.classList.toggle('my-turn', myTurn())
      frame()
      keepTime()
      // Our turn came round with a premove queued: play it if it is still legal.
      if (myTurn() && premove) {
        const queued = premove
        premove = null
        picked = null
        if (isLegal(state, queued)) { send(queued); return }
      }
      draw()
    },
    destroy() { clearInterval(ticker); ticker = null; svg.remove() },
  }
}

/**
 * The shelf icon, from the set itself: a white knight on a corner of the
 * board, its squares clipped to the rounded frame, the knight's outline
 * drawn heavier to match the icons' line weight at this size.
 */
const ICON = `
  <defs><clipPath id="chess-icon-board"><rect x="8" y="17" width="40" height="24" rx="4"/></clipPath></defs>
  <g clip-path="url(#chess-icon-board)">
    <rect x="8" y="17" width="40" height="24" fill="${LIGHT}"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((c) => ((r + c) % 2
      ? `<rect x="${8 + c * 8}" y="${17 + r * 8}" width="8" height="8" fill="${DARK}"/>` : '')).join('')).join('')}
  </g>
  <rect x="8" y="17" width="40" height="24" rx="4" fill="none" stroke="${INK}" stroke-width="2.5"/>
  <g transform="translate(10 0.8) scale(0.36)" fill="${WHITE}" stroke="${INK}" color="${INK}" stroke-width="5.6" stroke-linejoin="round">${PIECES.N}</g>`

// ------------------------------------------------------------------- game

export default defineGame({
  id: 'chess',
  styles: new URL('./style.css', import.meta.url),
  name: 'Chess',
  tone: 'grape',
  kind: 'turns',
  seats: 2,
  pieces: [WHITE, BLACK],
  options: {
    time: { label: 'clock', choices: { '1m': '1m', '3m': '3m', '5m': '5m', '10m': '10m', '15m': '15m', '30m': '30m', none: 'none' }, default: '10m' },
    increment: { label: 'per move', choices: { '+0': '+0s', '+1': '+1s', '+2': '+2s', '+3': '+3s', '+5': '+5s', '+10': '+10s', '+20': '+20s' }, default: '+0' },
  },
  rules,
  view,
  icon: ICON,
})
