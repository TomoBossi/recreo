/**
 * Tic-tac-toe: three in a row on a three-by-three grid.
 *
 * The smallest complete game, and the one to copy when writing a new one:
 * rules first, then the view, then one defineGame call that ties them
 * together. See games/README.md.
 */
import { defineGame } from '../kit/define.js'
import { shape, board, INK, PAPER } from '../kit/svg.js'

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
const PINK = '#ff5d8f'
const BLUE = '#2fa4e6'

// ------------------------------------------------------------------ rules

// Rules are plain functions of plain JSON. Every peer runs them on the same
// moves in the same order, so they must agree everywhere: no Math.random(),
// no clocks, and never change the state passed in.

const turn = (s) => (s.winner !== null || s.draw ? null : s.turn)

const rules = {
  init: () => ({ cells: Array(9).fill(-1), turn: 0, winner: null, line: null, draw: false, forfeited: null }),

  /** Whose move it is: a seat, or null once the game is over. */
  turn,

  /** May this seat make this move now? Moves come from other peers, so check everything. */
  legal: (s, move, seat) => turn(s) === seat
    && Number.isInteger(move?.cell) && move.cell >= 0 && move.cell < 9
    && s.cells[move.cell] === -1,

  /** The next state. Only ever called with a legal move. */
  apply(s, move, seat) {
    const cells = s.cells.slice()
    cells[move.cell] = seat
    const line = LINES.find((l) => l.every((i) => cells[i] === seat)) ?? null
    return { ...s, cells, turn: 1 - seat, winner: line ? seat : null, line, draw: !line && cells.every((c) => c !== -1) }
  },

  /** The state after a seat gives up: in a duel, the other player wins. */
  forfeit: (s, seat) => (turn(s) === null ? s : { ...s, winner: 1 - seat, forfeited: seat }),

  /** null while playing; then who won, and why — the room shows it to each player. */
  outcome(s, names) {
    if (s.winner !== null) return { winners: [s.winner], reason: s.forfeited !== null ? `${names[s.forfeited] ?? 'the other player'} forfeited` : 'three in a row' }
    if (s.draw) return { winners: [], draw: true, reason: 'nobody got three' }
    return null
  },

  /** One line for the bar under the board. */
  status(s, names) {
    const name = (seat) => names[seat] ?? `player ${seat + 1}`
    if (s.forfeited !== null) return `${name(s.forfeited)} forfeited — ${name(s.winner)} wins!`
    if (s.winner !== null) return `${name(s.winner)} wins!`
    if (s.draw) return 'a draw'
    return `${name(s.turn)}'s turn`
  },
}

// ------------------------------------------------------------------- view

// The view draws the state and turns clicks into moves. It is told about
// every change through update(); it never changes the state itself.

const X = (i) => 30 + (i % 3) * 100 + 50
const Y = (i) => 30 + Math.floor(i / 3) * 100 + 50

/**
 * A mark, flat in its player's colour like the icon's. pathLength="1" lets
 * CSS draw it in — the X stroke by stroke, the O round — when it is new.
 */
function mark(seat, colour, { fresh = false, ghost = false } = {}) {
  const line = { fill: 'none', stroke: colour, 'stroke-width': 13, 'stroke-linecap': 'round', pathLength: 1 }
  const cls = `mark${fresh ? ' fresh' : ''}${ghost ? ' ghost' : ''}`
  return seat === 0
    ? shape('g', { class: cls }, [
      shape('path', { d: 'M-23 -23 L23 23', ...line }),
      shape('path', { d: 'M23 -23 L-23 23', ...line, class: 'second' }),
    ])
    : shape('g', { class: cls }, [
      // A path rather than a circle, so it draws from the top, clockwise.
      shape('path', { d: 'M0 -25 A25 25 0 1 1 -0.01 -25', ...line }),
    ])
}

function view(el, ctx) {
  const svg = board(el, { viewBox: '0 0 360 360', className: 'ttt' })
  svg.innerHTML = `
    <rect x="10" y="10" width="340" height="340" rx="16" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M130 40 V320 M230 40 V320 M40 130 H320 M40 230 H320" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <g class="strike"></g>
    <g class="marks"></g>
    <g class="ghost"></g>
    <g class="hits"></g>`
  const marks = svg.querySelector('.marks')
  const ghost = svg.querySelector('.ghost')
  const strike = svg.querySelector('.strike')
  const hits = svg.querySelector('.hits')
  for (let i = 0; i < 9; i++) {
    hits.append(shape('rect', { x: X(i) - 50, y: Y(i) - 50, width: 100, height: 100, fill: 'transparent', 'data-cell': i }))
  }

  let state = null
  let info = {}
  let drawn = Array(9).fill(-1) // what is already on the paper, so only new marks draw in
  const myTurn = () => info.mySeat != null && info.turn === info.mySeat

  // On your turn, a faint mark follows the mouse over the empty cells.
  const preview = (cell) => {
    ghost.textContent = ''
    if (cell == null || !myTurn() || state.cells[cell] !== -1) return
    ghost.append(shape('g', { transform: `translate(${X(cell)}, ${Y(cell)})` }, [mark(info.mySeat, ctx.colours[info.mySeat], { ghost: true })]))
  }
  hits.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') preview(e.target.dataset?.cell == null ? null : Number(e.target.dataset.cell)) })
  hits.addEventListener('pointerleave', () => preview(null))
  hits.addEventListener('click', (e) => {
    const cell = e.target.dataset?.cell
    if (cell == null) return
    ctx.play({ cell: Number(cell) })
    preview(null)
  })

  return {
    update(next, nextInfo) {
      state = next
      info = nextInfo
      svg.classList.toggle('my-turn', myTurn())
      // A new game (a rematch) starts a clean sheet.
      if (state.cells.every((c) => c === -1)) drawn = Array(9).fill(-1)
      marks.textContent = ''
      state.cells.forEach((seat, i) => {
        if (seat === -1) return
        const g = shape('g', { transform: `translate(${X(i)}, ${Y(i)})` }, [mark(seat, ctx.colours[seat], { fresh: drawn[i] !== seat })])
        // Once there is a winner, everything but the winning three steps back.
        if (state.line && !state.line.includes(i)) g.classList.add('spent')
        marks.append(g)
      })
      drawn = state.cells.slice()
      // Three in a row: a stroke through them, drawn beneath the marks so
      // they stay crisp and it shows in the gaps between them.
      strike.textContent = ''
      if (state.line) {
        const [a, , c] = state.line
        const dx = Math.sign(X(c) - X(a)) * 34
        const dy = Math.sign(Y(c) - Y(a)) * 34
        strike.append(shape('path', {
          d: `M${X(a) - dx} ${Y(a) - dy} L${X(c) + dx} ${Y(c) + dy}`,
          fill: 'none', stroke: INK, 'stroke-width': 9, 'stroke-linecap': 'round', pathLength: 1, class: 'win-line',
        }))
      }
      ghost.textContent = ''
    },
    destroy() { svg.remove() },
  }
}

/**
 * The shelf icon: a paper square, a bold rounded grid and flat marks,
 * mid-win on a diagonal.
 */
const icon = () => {
  const cx = [16.5, 28, 39.5]
  const cy = [10.5, 22, 33.5]
  // Flat marks, colour only, small enough to keep clear of the grid.
  const x = (c, r) => `<path d="M${cx[c] - 2.4} ${cy[r] - 2.4} L${cx[c] + 2.4} ${cy[r] + 2.4} M${cx[c] + 2.4} ${cy[r] - 2.4} L${cx[c] - 2.4} ${cy[r] + 2.4}"
      fill="none" stroke="${PINK}" stroke-width="2.6" stroke-linecap="round"/>`
  const o = (c, r) => `<circle cx="${cx[c]}" cy="${cy[r]}" r="2.6" fill="none" stroke="${BLUE}" stroke-width="2.4"/>`
  return `
    <rect x="9.5" y="3.5" width="37" height="37" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M22.25 7.5 V36.5 M33.75 7.5 V36.5 M13.5 16.25 H42.5 M13.5 27.75 H42.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
    ${o(2, 0)}${o(0, 2)}${x(0, 0)}${x(1, 1)}${x(2, 2)}`
}
const ICON = icon()

// ------------------------------------------------------------------- game

export default defineGame({
  id: 'tictactoe',
  name: 'Tic-tac-toe',
  tone: 'tang',
  kind: 'turns',
  seats: 2,
  pieces: [PINK, BLUE],
  rules,
  view,
  icon: ICON,
})
