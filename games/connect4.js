/**
 * Connect four: drop discs into a seven-by-six grid; four in a line wins.
 *
 * The smallest real game, and the one that proves the machinery underneath:
 * two seats, turns, spectators, and a board that must come out the same on
 * every machine.
 */

const COLS = 7
const ROWS = 6
const NS = 'http://www.w3.org/2000/svg'

/** Cell index for a column and a row counted from the top. */
const at = (col, row) => row * COLS + col

function winningLine(cells, col, row, seat) {
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [[col, row]]
    for (const sign of [1, -1]) {
      let c = col + dc * sign
      let r = row + dr * sign
      while (c >= 0 && c < COLS && r >= 0 && r < ROWS && cells[at(c, r)] === seat) {
        line.push([c, r])
        c += dc * sign
        r += dr * sign
      }
    }
    if (line.length >= 4) return line
  }
  return null
}

export default {
  id: 'connect4',
  name: 'Connect four',
  tone: 'sky',
  seats: 2,
  mode: 'replicated',
  seatColours: ['var(--berry)', 'var(--sun)'],

  init() {
    return { cells: Array(COLS * ROWS).fill(-1), turn: 0, winner: null, line: null, draw: false }
  },

  turn(s) {
    return s.winner !== null || s.draw ? null : s.turn
  },

  legal(s, move, seat) {
    return this.turn(s) === seat
      && Number.isInteger(move?.col) && move.col >= 0 && move.col < COLS
      && s.cells[at(move.col, 0)] === -1
  },

  apply(s, move, seat) {
    const cells = s.cells.slice()
    let row = ROWS - 1
    while (cells[at(move.col, row)] !== -1) row--
    cells[at(move.col, row)] = seat
    const line = winningLine(cells, move.col, row, seat)
    return {
      cells,
      turn: 1 - seat,
      winner: line ? seat : null,
      line,
      draw: !line && cells.every((c) => c !== -1),
    }
  },

  status(s, names) {
    const name = (seat) => names[seat] ?? `player ${seat + 1}`
    if (s.winner !== null) return `${name(s.winner)} wins!`
    if (s.draw) return 'a draw — the board is full'
    return `${name(s.turn)}'s turn`
  },

  view: {
    mount(el, ctx) {
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 380 360')
      svg.setAttribute('class', 'c4')
      svg.innerHTML = `
        <defs>
          <mask id="c4-holes-${uid}"><rect x="0" y="40" width="380" height="320" fill="#fff"/></mask>
        </defs>
        <g class="ghost"><circle r="18" stroke="var(--ink)" stroke-width="2.5"/></g>
        <g class="discs"></g>
        <rect class="board" x="6" y="46" width="368" height="308" rx="12" fill="var(--sea)" mask="url(#c4-holes-${uid})"/>
        <rect x="6" y="46" width="368" height="308" rx="12" fill="none" stroke="var(--ink)" stroke-width="2.5"/>
        <g class="rims"></g>
        <rect x="0" y="348" width="380" height="12" rx="4" fill="var(--sky-deep)" stroke="var(--ink)" stroke-width="2.5"/>
        <g class="hits"></g>`
      const mask = svg.querySelector('mask')
      const discs = svg.querySelector('.discs')
      const rims = svg.querySelector('.rims')
      const hits = svg.querySelector('.hits')
      const ghost = svg.querySelector('.ghost')
      const ghostDisc = ghost.querySelector('circle')
      uid++

      const cx = (c) => 38 + c * 50.6
      const cy = (r) => 76 + r * 49
      const shape = (tag, attrs) => {
        const node = document.createElementNS(NS, tag)
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
        return node
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          mask.append(shape('circle', { cx: cx(c), cy: cy(r), r: 19, fill: '#000' }))
          rims.append(shape('circle', { cx: cx(c), cy: cy(r), r: 19, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2.5 }))
        }
      }
      // A tall invisible strip per column takes the clicks and the hover.
      for (let c = 0; c < COLS; c++) {
        const strip = shape('rect', { x: cx(c) - 25, y: 0, width: 50.6, height: 360, fill: 'transparent', 'data-col': c })
        hits.append(strip)
      }

      let state = null
      let info = {}
      let hover = null

      const myTurn = () => info.mySeat != null && info.turn === info.mySeat
      const drawGhost = () => {
        const show = myTurn() && hover != null && state.cells[at(hover, 0)] === -1
        ghost.style.display = show ? '' : 'none'
        if (!show) return
        ghost.setAttribute('transform', `translate(${cx(hover)}, 20)`)
        ghostDisc.setAttribute('fill', ctx.colours[info.mySeat])
      }

      hits.addEventListener('pointermove', (e) => {
        const col = e.target.dataset?.col
        hover = col == null ? null : Number(col)
        drawGhost()
      })
      hits.addEventListener('pointerleave', () => { hover = null; drawGhost() })
      hits.addEventListener('click', (e) => {
        const col = e.target.dataset?.col
        if (col != null) ctx.play({ col: Number(col) })
      })
      svg.style.cursor = 'default'

      el.append(svg)

      return {
        update(next, nextInfo) {
          const previous = state
          state = next
          info = nextInfo
          svg.classList.toggle('my-turn', myTurn())
          discs.textContent = ''
          const winning = new Set((state.line ?? []).map(([c, r]) => at(c, r)))
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const seat = state.cells[at(c, r)]
              if (seat === -1) continue
              const g = shape('g', { transform: `translate(${cx(c)}, ${cy(r)})` })
              const inner = shape('g', { class: 'disc' })
              inner.append(
                shape('circle', { r: 19, fill: ctx.colours[seat] }),
                shape('circle', { cx: -5, cy: -6, r: 5, fill: 'rgb(255 255 255 / 0.45)' }),
                shape('circle', { class: 'ring', r: 11, fill: 'none', stroke: '#fff', 'stroke-width': 4 }),
                shape('circle', { class: 'ring', r: 13.5, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2 }),
              )
              if (winning.has(at(c, r))) inner.classList.add('winning')
              // The newest disc falls into place.
              const isNew = previous && previous.cells[at(c, r)] === -1
              if (isNew) {
                inner.style.setProperty('--fall', `${-(cy(r) - 20)}px`)
                inner.classList.add('falling')
              }
              g.append(inner)
              discs.append(g)
            }
          }
          drawGhost()
        },
        destroy() { svg.remove() },
      }
    },
  },
}

let uid = 0
