/**
 * Chess. The rules live in rules.js; this is the game's face: a board
 * drawn from shapes, pieces drawn from shapes, and moving by picking a piece
 * and then a square — which works the same with a mouse and a finger.
 */
import { defineGame } from '../kit/define.js'
import { board, escape, INK } from '../kit/svg.js'
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
const STEM = (top, half) => `<path d="M${50 - half} ${top} Q${50 - half + 2} ${(top + 69) / 2} ${50 - half - 9} 69 H${50 + half + 9} Q${50 + half - 2} ${(top + 69) / 2} ${50 + half} ${top} Z"/>`
const PIECES = {
  P: `${BASE}${STEM(46, 8)}
      <rect x="37" y="40" width="26" height="7" rx="3.5"/>
      <circle cx="50" cy="28" r="12"/>`,
  R: `${BASE}<path d="M36 36 L38 69 H62 L64 36 Z"/>
      <rect x="31" y="31" width="38" height="7" rx="2"/>
      <path d="M31 14 H39 V20 H46 V14 H54 V20 H61 V14 H69 V31 H31 Z"/>`,
  N: `${BASE}
      <path d="M33 69 C33 60 37 53 44 48 C39 47 33 49 28 47 C22 45 21 38 26 34 L39 22 C41 16 45 12 51 11 L54 4 L58 12 C69 15 75 28 73 44 C72 54 69 62 67 69 Z"/>
      <path class="detail" d="M59 15 C66 24 68 36 66 50" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
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
      // Thinking time counts once both sides have moved; the increment always.
      const spent = s.clock.moves >= 2 ? Math.round(move.spent) : 0
      clock.left[seat] -= spent
      if (clock.left[seat] <= 0) return timeUp({ ...s, clock: { ...clock, left: clock.left.map((v, i) => (i === seat ? 0 : v)) } }, seat)
      clock.left[seat] += clock.inc
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
  const svg = board(el, { viewBox: '-6 -6 812 812', className: 'chess' })

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
  const flipped = () => info.mySeat === 1
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
  function frame() {
    layout = clockLayout()
    svg.setAttribute('viewBox', layout === 'side' ? '-6 -6 1086 812' : layout === 'stack' ? '-6 -112 812 1036' : '-6 -6 812 812')
  }
  new ResizeObserver(() => { if (state && clockLayout() !== layout) { frame(); draw() } }).observe(el)

  /** The two clocks: the other side's at the top, ours (or white's, watching) at the bottom. */
  function drawClocks() {
    const g = svg.querySelector('.clocks')
    if (!g) return
    if (!layout) { g.innerHTML = ''; return }
    const bottom = info.mySeat ?? 0
    const top = 1 - bottom
    const box = (seat, x, y, w, h) => {
      const ms = timeLeft(seat)
      const running = !state.result && turn(state) === seat
      const low = ms < 10_000
      const fill = running ? (low ? 'var(--berry)' : 'var(--sun)') : '#fffaf0'
      const name = info.names?.[seat] ?? (seat === 0 ? 'white' : 'black')
      return `<g class="clock ${running ? 'running' : ''}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="var(--ink)" stroke-width="5"/>
        <circle cx="${x + 30}" cy="${y + h / 2}" r="12" fill="${seat === 0 ? WHITE : BLACK}" stroke="var(--ink)" stroke-width="4"/>
        <text x="${x + w - 20}" y="${y + h / 2 + 18}" text-anchor="end" class="clock-time">${format(ms)}</text>
        <text x="${x + 52}" y="${y + h / 2 + 8}" class="clock-name">${escape(name).slice(0, 12)}</text>
      </g>`
    }
    g.innerHTML = layout === 'side'
      ? box(top, 830, 0, 250, 110) + box(bottom, 830, 690, 250, 110)
      : box(top, 0, -106, 800, 96) + box(bottom, 0, 822, 800, 96)
  }

  // The running clock ticks; at zero on our own move, we say so.
  const ticker = setInterval(() => {
    if (!state?.clock || state.result) return
    drawClocks()
    if (myTurn() && state.clock.moves >= 2 && timeLeft(info.mySeat) <= 0 && flagged !== state.clock.moves) {
      flagged = state.clock.moves
      ctx.play({ timeout: true })
    }
  }, 100)

  /** Make a move, saying how long we thought about it. */
  const send = (move) => ctx.play({ ...move, spent: Math.round(performance.now() - receivedAt) })

  function draw() {
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
      const upright = flipped() ? ' rotate(180 50 50)' : ''
      html += `<g transform="translate(${x} ${y})${upright}" pointer-events="none" class="piece"
        fill="${fill}" stroke="${line}" color="${detail}" stroke-width="4" stroke-linejoin="round">${PIECES[p[1]]}</g>`
    }
    for (const sq of targets) {
      const { x, y } = at(sq)
      html += state.board[sq]
        ? `<circle cx="${x + 50}" cy="${y + 50}" r="44" fill="none" stroke="var(--ink)" stroke-width="6" opacity="0.5" pointer-events="none"/>`
        : `<circle cx="${x + 50}" cy="${y + 50}" r="14" fill="var(--ink)" opacity="0.4" pointer-events="none"/>`
    }
    html = `<rect x="-6" y="-6" width="812" height="812" rx="14" fill="var(--ink)"/>
      <g data-cursor-space transform="${flipped() ? 'rotate(180 400 400)' : ''}">${html}</g><g class="clocks"></g>`
    if (promoting) {
      html += `<rect x="150" y="300" width="500" height="200" rx="18" fill="#fffaf0" stroke="var(--ink)" stroke-width="6"/>`
      ;['Q', 'R', 'B', 'N'].forEach((kind, i) => {
        const colour = state.turn === 'w' ? WHITE : BLACK
        html += `<g transform="translate(${180 + i * 115} 345)" class="piece promo" data-promo="${kind}"
          fill="${colour}" stroke="var(--ink)" color="${state.turn === 'w' ? 'var(--ink)' : '#c9bdf0'}" stroke-width="4" stroke-linejoin="round">
          <rect width="100" height="100" fill="transparent" stroke="none"/>${PIECES[kind]}</g>`
      })
    }
    svg.innerHTML = `<defs><clipPath id="chess-clip-${id}"><rect width="800" height="800" rx="8"/></clipPath></defs>${html}`
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
      draw()
      return
    }
    if (picked != null && sq !== picked) {
      const candidates = legalMoves(state).filter((m) => m.from === picked && m.to === sq)
      if (candidates.length > 1) { promoting = { from: picked, to: sq }; draw(); return }
      if (candidates.length === 1) { send(candidates[0]); picked = null; draw(); return }
    }
    picked = mine && sq !== picked ? sq : null
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
      state = next
      info = nextInfo
      const count = state.clock?.moves ?? Object.keys(state.seen ?? {}).length
      if (count !== seenMoves) { seenMoves = count; receivedAt = performance.now() }
      if (!state.result && info.turn === null) premove = null
      if (wasMyTurn && !myTurn()) { picked = null; promoting = null }
      svg.classList.toggle('my-turn', myTurn())
      frame()
      // Our turn came round with a premove queued: play it if it is still legal.
      if (myTurn() && premove) {
        const queued = premove
        premove = null
        picked = null
        if (isLegal(state, queued)) { send(queued); return }
      }
      draw()
    },
    destroy() { clearInterval(ticker); svg.remove() },
  }
}

// ------------------------------------------------------------------- game

export default defineGame({
  id: 'chess',
  name: 'Chess',
  tone: 'grape',
  kind: 'turns',
  seats: 2,
  pieces: [WHITE, BLACK],
  options: {
    time: { label: 'clock', choices: { '1m': '1m', '3m': '3m', '5m': '5m', '10m': '10m', '15m': '15m', '30m': '30m', none: 'none' }, default: '10m' },
    increment: { label: 'per move', choices: { '+0': '+0s', '+1': '+1', '+2': '+2', '+3': '+3', '+5': '+5', '+10': '+10', '+20': '+20' }, default: '+0' },
  },
  rules,
  view,
  icon: `
    <rect x="6" y="8" width="44" height="32" rx="4" fill="#fffaf0" stroke="${INK}" stroke-width="2.5"/>
    ${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5].map((c) => (r + c) % 2
      ? `<rect x="${8 + c * 6.7}" y="${10 + r * 7}" width="6.7" height="7" fill="#9a7bf2" opacity="0.55"/>` : '').join('')).join('')}
    <circle cx="28" cy="15" r="5" fill="#fffaf0" stroke="${INK}" stroke-width="2.5"/>
    <path d="M22 34 L25 21 H31 L34 34 Z" fill="#fffaf0" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="19" y="33" width="18" height="5" rx="2" fill="#fffaf0" stroke="${INK}" stroke-width="2.5"/>`,
})
