/**
 * Chess. The rules live in rules.js; this is the game's face: a board
 * drawn from shapes, pieces drawn from shapes, and moving by picking a piece
 * and then a square — which works the same with a mouse and a finger.
 */
import { defineGame } from '../kit/define.js'
import { board, INK } from '../kit/svg.js'
import { initial, isLegal, play, legalMoves, file, rank } from './rules.js'

const LIGHT = '#fbefd5'
const DARK = '#b79be8'
const WHITE = '#fffaf0'
const BLACK = '#3b2f5c'

/** Each piece as shapes in a 100×100 box, outlined in ink. */
const PIECES = {
  P: `<circle cx="50" cy="33" r="13"/>
      <path d="M38 48 Q50 42 62 48 L66 72 H34 Z"/>
      <rect x="26" y="72" width="48" height="12" rx="4"/>`,
  R: `<path d="M30 20 H38 V28 H46 V20 H54 V28 H62 V20 H70 V36 H30 Z"/>
      <rect x="35" y="36" width="30" height="34"/>
      <rect x="26" y="70" width="48" height="14" rx="4"/>`,
  N: `<path d="M32 84 L33 66 C34 54 44 50 46 42 L36 46 C30 48 26 44 27 39 L36 28 C40 18 50 14 60 16 C72 19 76 34 74 52 L72 84 Z"/>
`,
  B: `<circle cx="50" cy="17" r="6"/>
      <path d="M50 24 C64 34 66 50 58 62 H42 C34 50 36 34 50 24 Z"/>
      <rect x="36" y="62" width="28" height="9" rx="3"/>
      <rect x="26" y="71" width="48" height="13" rx="4"/>`,
  Q: `<circle cx="24" cy="24" r="5"/><circle cx="37" cy="17" r="5"/><circle cx="50" cy="14" r="5"/><circle cx="63" cy="17" r="5"/><circle cx="76" cy="24" r="5"/>
      <path d="M24 28 L34 58 L37 22 L45 56 L50 19 L55 56 L63 22 L66 58 L76 28 L70 68 H30 Z"/>
      <rect x="26" y="68" width="48" height="16" rx="4"/>`,
  K: `<path d="M46 8 H54 V16 H62 V24 H54 V32 H46 V24 H38 V16 H46 Z"/>
      <path d="M30 40 C30 30 44 30 50 38 C56 30 70 30 70 40 C70 52 62 60 62 66 H38 C38 60 30 52 30 40 Z"/>
      <rect x="26" y="66" width="48" height="18" rx="4"/>`,
}

let uid = 0

// ------------------------------------------------------------------ rules

const turn = (s) => (s.result ? null : s.turn === 'w' ? 0 : 1)

const rules = {
  init: () => initial(),
  turn,
  legal: (s, move, seat) => turn(s) === seat && isLegal(s, move),
  apply: (s, move) => play(s, move),

  /** Resigning: the other colour wins. */
  forfeit: (s, seat) => (s.result ? s : { ...s, result: { winner: seat === 0 ? 'b' : 'w', forfeited: seat } }),

  outcome(s, names) {
    if (s.result?.winner) {
      const loser = s.result.winner === 'w' ? 1 : 0
      return { winners: [1 - loser], reason: s.result.forfeited != null ? `${names[loser] ?? 'the other player'} resigned` : 'checkmate' }
    }
    if (s.result?.draw) return { winners: [], draw: true, reason: `a draw by ${s.result.draw}` }
    return null
  },

  status(s, names) {
    const name = (seat) => names[seat] ?? (seat === 0 ? 'white' : 'black')
    if (s.result?.forfeited != null) return `${name(s.result.forfeited)} resigned — ${name(1 - s.result.forfeited)} wins!`
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

  // Black sees the board turned round. The whole board is rotated as one
  // group, pieces turned back upright, so a square sits at the same place
  // in the board's own coordinates for both players — which is what lets
  // a cursor over e4 land on e4 for everyone.
  const flipped = () => info.mySeat === 1
  const at = (sq) => ({ x: file(sq) * 100, y: (7 - rank(sq)) * 100 })
  const myTurn = () => info.mySeat != null && info.turn === info.mySeat

  function draw() {
    const moves = picked != null ? legalMoves(state).filter((m) => m.from === picked) : []
    const targets = new Set(moves.map((m) => m.to))
    let html = ''
    for (let sq = 0; sq < 64; sq++) {
      const { x, y } = at(sq)
      const dark = (file(sq) + rank(sq)) % 2 === 0
      html += `<rect x="${x}" y="${y}" width="100" height="100" fill="${dark ? DARK : LIGHT}" data-sq="${sq}"/>`
      if (state.last && (state.last.from === sq || state.last.to === sq)) {
        html += `<rect x="${x}" y="${y}" width="100" height="100" fill="var(--sun)" opacity="0.45" pointer-events="none"/>`
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
      const upright = flipped() ? ' rotate(180 50 50)' : ''
      html += `<g transform="translate(${x} ${y})${upright}" pointer-events="none" class="piece"
        fill="${fill}" stroke="${line}" stroke-width="4" stroke-linejoin="round">${PIECES[p[1]]}</g>`
    }
    for (const sq of targets) {
      const { x, y } = at(sq)
      html += state.board[sq]
        ? `<circle cx="${x + 50}" cy="${y + 50}" r="44" fill="none" stroke="var(--ink)" stroke-width="6" opacity="0.5" pointer-events="none"/>`
        : `<circle cx="${x + 50}" cy="${y + 50}" r="14" fill="var(--ink)" opacity="0.4" pointer-events="none"/>`
    }
    html = `<rect x="-6" y="-6" width="812" height="812" rx="14" fill="var(--ink)"/>
      <g data-cursor-space transform="${flipped() ? 'rotate(180 400 400)' : ''}">${html}</g>`
    if (promoting) {
      html += `<rect x="150" y="300" width="500" height="200" rx="18" fill="#fffaf0" stroke="var(--ink)" stroke-width="6"/>`
      ;['Q', 'R', 'B', 'N'].forEach((kind, i) => {
        const colour = state.turn === 'w' ? WHITE : BLACK
        html += `<g transform="translate(${180 + i * 115} 345)" class="piece promo" data-promo="${kind}"
          fill="${colour}" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round">
          <rect width="100" height="100" fill="transparent" stroke="none"/>${PIECES[kind]}</g>`
      })
    }
    svg.innerHTML = `<defs><clipPath id="chess-clip-${id}"><rect width="800" height="800" rx="8"/></clipPath></defs>${html}`
  }

  svg.addEventListener('click', (e) => {
    if (!state || !myTurn()) return
    const promo = e.target.closest('[data-promo]')?.dataset.promo
    if (promoting) {
      if (promo) ctx.play({ ...promoting, promo })
      promoting = null
      picked = null
      draw()
      return
    }
    const sq = Number(e.target.dataset?.sq)
    if (!Number.isInteger(sq)) return
    const mine = state.board[sq]?.[0] === state.turn
    if (picked != null && sq !== picked) {
      const candidates = legalMoves(state).filter((m) => m.from === picked && m.to === sq)
      if (candidates.length > 1) { promoting = { from: picked, to: sq }; draw(); return }
      if (candidates.length === 1) { ctx.play(candidates[0]); picked = null; draw(); return }
    }
    picked = mine && sq !== picked ? sq : null
    draw()
  })

  return {
    update(next, nextInfo) {
      state = next
      info = nextInfo
      if (!myTurn()) { picked = null; promoting = null }
      svg.classList.toggle('my-turn', myTurn())
      draw()
    },
    destroy() { svg.remove() },
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
