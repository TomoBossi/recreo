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
  init: () => ({ cells: Array(9).fill(-1), turn: 0, winner: null, line: null, draw: false }),

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
    return { cells, turn: 1 - seat, winner: line ? seat : null, line, draw: !line && cells.every((c) => c !== -1) }
  },

  /** One line for the bar under the board. */
  status(s, names) {
    const name = (seat) => names[seat] ?? `player ${seat + 1}`
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

function mark(seat, colour) {
  const stroke = { fill: 'none', stroke: colour, 'stroke-width': 14, 'stroke-linecap': 'round' }
  const outline = { fill: 'none', stroke: INK, 'stroke-width': 20, 'stroke-linecap': 'round' }
  return seat === 0
    ? shape('g', {}, [
      shape('path', { d: 'M-26 -26 L26 26 M26 -26 L-26 26', ...outline }),
      shape('path', { d: 'M-26 -26 L26 26 M26 -26 L-26 26', ...stroke }),
    ])
    : shape('g', {}, [
      shape('circle', { r: 28, ...outline }),
      shape('circle', { r: 28, ...stroke }),
    ])
}

function view(el, ctx) {
  const svg = board(el, { viewBox: '0 0 360 360', className: 'ttt' })
  svg.innerHTML = `
    <rect x="10" y="10" width="340" height="340" rx="16" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M130 40 V320 M230 40 V320 M40 130 H320 M40 230 H320" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <g class="marks"></g>
    <g class="hits"></g>`
  const marks = svg.querySelector('.marks')
  const hits = svg.querySelector('.hits')
  for (let i = 0; i < 9; i++) {
    hits.append(shape('rect', { x: X(i) - 50, y: Y(i) - 50, width: 100, height: 100, fill: 'transparent', 'data-cell': i }))
  }
  hits.addEventListener('click', (e) => {
    const cell = e.target.dataset?.cell
    if (cell != null) ctx.play({ cell: Number(cell) })
  })

  return {
    update(state, info) {
      svg.classList.toggle('my-turn', info.mySeat != null && info.turn === info.mySeat)
      marks.textContent = ''
      state.cells.forEach((seat, i) => {
        if (seat === -1) return
        const g = shape('g', { transform: `translate(${X(i)}, ${Y(i)})` }, [mark(seat, ctx.colours[seat])])
        if (state.line?.includes(i)) g.classList.add('winning')
        marks.append(g)
      })
    },
    destroy() { svg.remove() },
  }
}

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
  icon: `
    <rect x="8" y="4" width="40" height="36" rx="5" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M22 9 V35 M34 9 V35 M13 16 H43 M13 28 H43" stroke="${INK}" stroke-width="2"/>
    <path d="M14 9 L20 15 M20 9 L14 15" stroke="${PINK}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="28" cy="22" r="3.4" fill="none" stroke="${BLUE}" stroke-width="2.5"/>
    <path d="M37 29 L41 33 M41 29 L37 33" stroke="${PINK}" stroke-width="2.5" stroke-linecap="round"/>`,
})
