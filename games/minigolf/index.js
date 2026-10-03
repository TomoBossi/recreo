/**
 * Minigolf: take turns putting round a few small holes; fewest strokes wins.
 * Solo, or with up to three friends.
 */
import { defineGame } from '../kit/define.js'
import { board, INK } from '../kit/svg.js'
import { startPanel } from '../kit/lobby.js'
import { HOLES, outer, roll, clampShot, UNIT, W, H, BALL, CUP, MAX_SPEED, MAX_STROKES } from './physics.js'

// ------------------------------------------------------------------ rules

function startHole(s, index) {
  const hole = HOLES[index]
  const balls = {}
  for (const seat of s.order) balls[seat] = { pos: [hole.tee[0] * UNIT, hole.tee[1] * UNIT], strokes: 0, done: false }
  return { ...s, hole: index, balls, turn: s.order[0], last: null }
}

function nextTurn(s) {
  const waiting = s.order.filter((seat) => !s.balls[seat].done)
  if (waiting.length === 0) {
    const cards = s.cards.map((c, i) => (i === s.hole ? Object.fromEntries(s.order.map((seat) => [seat, s.balls[seat].strokes])) : c))
    if (s.hole + 1 >= HOLES.length) return { ...s, cards, phase: 'over', turn: null }
    return startHole({ ...s, cards }, s.hole + 1)
  }
  // Furthest from the cup goes next, as in real golf; ties by seat.
  const hole = HOLES[s.hole]
  const away = (seat) => {
    const [x, y] = s.balls[seat].pos
    return (x - hole.cup[0] * UNIT) ** 2 + (y - hole.cup[1] * UNIT) ** 2
  }
  return { ...s, turn: waiting.sort((a, b) => away(b) - away(a) || a - b)[0] }
}

const init = () => ({ phase: 'waiting', order: [], hole: 0, balls: {}, turn: null, cards: HOLES.map(() => null), last: null })

const rules = {
  init,

  /** Before it starts, anyone seated may start it; then whoever is furthest away. */
  turn: (s) => (s.phase === 'playing' ? s.turn : 'any'),

  legal(s, move, seat) {
    if (move?.type === 'start') {
      return (s.phase === 'waiting' || s.phase === 'over') && Array.isArray(move.order)
        && move.order.length >= 1 && move.order.includes(seat) && move.order.every(Number.isInteger)
    }
    return s.phase === 'playing' && s.turn === seat && move?.type === 'shot'
      && Number.isInteger(move.dx) && Number.isInteger(move.dy)
  },

  apply(s, move, seat) {
    if (move.type === 'start') return startHole({ ...init(), phase: 'playing', order: [...move.order].sort((a, b) => a - b) }, 0)
    const hole = HOLES[s.hole]
    const ball = s.balls[seat]
    const shot = clampShot(move.dx, move.dy)
    const result = roll(hole, ball.pos, shot)
    const strokes = ball.strokes + 1 + (result.drowned ? 1 : 0)
    const done = result.sunk || strokes >= MAX_STROKES
    const balls = { ...s.balls, [seat]: { pos: result.end ?? ball.pos, strokes: done && !result.sunk ? MAX_STROKES : strokes, done } }
    return nextTurn({ ...s, balls, last: { seat, from: ball.pos, shot, sunk: !!result.sunk, drowned: !!result.drowned } })
  },

  status(s, names) {
    const name = (seat) => names[seat] ?? `player ${seat + 1}`
    if (s.phase === 'waiting') return 'tee off when everyone is in'
    if (s.phase === 'over') {
      const totals = s.order.map((seat) => [seat, s.cards.reduce((n, c) => n + (c?.[seat] ?? 0), 0)])
      const best = Math.min(...totals.map(([, n]) => n))
      const winners = totals.filter(([, n]) => n === best).map(([seat]) => name(seat))
      if (s.order.length === 1) return `${best} strokes, par ${HOLES.reduce((n, h) => n + h.par, 0)}`
      return `${winners.join(' & ')} ${winners.length > 1 ? 'win' : 'wins'} with ${best} strokes!`
    }
    const hole = HOLES[s.hole]
    const last = s.last
    const note = last?.sunk ? `${name(last.seat)} sank it! · ` : last?.drowned ? `${name(last.seat)} found the water · ` : ''
    return `${note}hole ${s.hole + 1}: ${hole.name} (par ${hole.par}) — ${name(s.turn)} to putt`
  },
}

// ------------------------------------------------------------------- view

function view(el, ctx) {
  const svg = board(el, { viewBox: `-8 -8 ${W + 16} ${H + 16}`, className: 'golf' })
  const lobby = startPanel(el, {
    onStart: () => ctx.play({ type: 'start', order: Object.keys(info.names ?? {}).map(Number) }),
    startLabel: 'tee off!',
  })

  let state = null
  let info = {}
  let shownHole = -1
  let animating = null   // { seat, path, i }
  let aim = null          // pulled-back vector while dragging

  const myTurn = () => state?.phase === 'playing' && info.mySeat != null && state.turn === info.mySeat
  const toCourse = (e) => {
    const box = svg.getBoundingClientRect()
    const scale = Math.max((W + 16) / box.width, (H + 16) / box.height)
    const ox = (box.width * scale - (W + 16)) / 2
    const oy = (box.height * scale - (H + 16)) / 2
    return [((e.clientX - box.left) * scale - ox - 8) * UNIT, ((e.clientY - box.top) * scale - oy - 8) * UNIT]
  }

  function course(hole) {
    const rect = ([x, y, w, h], cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`
    return `
      <rect x="-8" y="-8" width="${W + 16}" height="${H + 16}" rx="18" fill="var(--ink)"/>
      <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#5fc85f"/>
      <g class="stripes">${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 100}" y="0" width="50" height="${H}" fill="#6bd66b"/>`).join('')}</g>
      ${hole.water.map((r) => rect(r, 'water')).join('')}
      ${[...outer, ...hole.walls].map((r) => rect(r, 'wall')).join('')}
      <circle cx="${hole.tee[0]}" cy="${hole.tee[1]}" r="16" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 5" opacity="0.8"/>
      <circle cx="${hole.cup[0]}" cy="${hole.cup[1]}" r="${CUP}" fill="var(--ink)"/>
      <line x1="${hole.cup[0]}" y1="${hole.cup[1]}" x2="${hole.cup[0]}" y2="${hole.cup[1] - 62}" stroke="var(--ink)" stroke-width="4"/>
      <path d="M${hole.cup[0]} ${hole.cup[1] - 62} l34 11 l-34 11 z" fill="var(--berry)" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
      <g class="aim"></g><g class="balls"></g>`
  }

  function drawBalls() {
    const g = svg.querySelector('.balls')
    let html = ''
    for (const seat of state.order) {
      const b = state.balls[seat]
      if (!b) continue
      let [x, y] = b.pos
      if (animating && animating.seat === seat) [x, y] = animating.path[Math.min(animating.i, animating.path.length - 1)]
      else if (b.done) continue
      html += `<circle cx="${x / UNIT}" cy="${y / UNIT}" r="${BALL}" fill="${ctx.colours[seat]}" stroke="var(--ink)" stroke-width="3"/>
        <circle cx="${x / UNIT - 3.5}" cy="${y / UNIT - 3.5}" r="3" fill="#fff" opacity="0.7"/>`
      if (seat === state.turn && !animating) html += `<circle cx="${x / UNIT}" cy="${y / UNIT}" r="${BALL + 8}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="5 4" class="spin"/>`
    }
    g.innerHTML = html
  }

  function drawAim() {
    const g = svg.querySelector('.aim')
    if (!aim || !myTurn()) { g.innerHTML = ''; return }
    const [bx, by] = state.balls[state.turn].pos
    const [dx, dy] = clampShot(aim[0], aim[1])
    const power = Math.round(Math.hypot(dx, dy) / MAX_SPEED * 100)
    const ex = bx / UNIT + dx / 6
    const ey = by / UNIT + dy / 6
    g.innerHTML = `
      <line x1="${bx / UNIT}" y1="${by / UNIT}" x2="${ex}" y2="${ey}" stroke="var(--ink)" stroke-width="9" stroke-linecap="round"/>
      <line x1="${bx / UNIT}" y1="${by / UNIT}" x2="${ex}" y2="${ey}" stroke="${power > 80 ? 'var(--berry)' : 'var(--sun)'}" stroke-width="5" stroke-linecap="round"/>
      <text x="${ex + 10}" y="${ey - 10}" class="power">${power}%</text>`
  }

  // Pull back from the ball like a slingshot and let go to putt.
  svg.addEventListener('pointerdown', (e) => {
    if (!myTurn() || animating) return
    e.preventDefault()
    svg.setPointerCapture(e.pointerId)
    const start = toCourse(e)
    const move = (ev) => {
      const p = toCourse(ev)
      // A slingshot: the shot goes opposite the pull, scaled up.
      aim = [(start[0] - p[0]) * 1.6 / UNIT * 10, (start[1] - p[1]) * 1.6 / UNIT * 10]
      drawAim()
    }
    const up = () => {
      svg.removeEventListener('pointermove', move)
      svg.removeEventListener('pointerup', up)
      svg.removeEventListener('pointercancel', up)
      if (aim) {
        const [dx, dy] = clampShot(aim[0], aim[1])
        if (dx * dx + dy * dy > 40 * 40) ctx.play({ type: 'shot', dx, dy })
      }
      aim = null
      drawAim()
    }
    svg.addEventListener('pointermove', move)
    svg.addEventListener('pointerup', up)
    svg.addEventListener('pointercancel', up)
  })

  function animate(last) {
    const result = roll(HOLES[last.hole ?? state.hole], last.from, last.shot)
    animating = { seat: last.seat, path: result.path, i: 0 }
    const step = () => {
      if (!animating) return
      animating.i += 3
      drawBalls()
      if (animating.i >= animating.path.length) { animating = null; drawBalls(); return }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  return {
    update(next, nextInfo) {
      const previous = state
      state = next
      info = nextInfo
      svg.classList.toggle('my-turn', myTurn())
      if (state.phase === 'waiting' || !state.order.length) {
        svg.innerHTML = course(HOLES[0])
        shownHole = -1
        overlay()
        return
      }
      // A new shot since we last looked is played out rather than jumped to.
      const fresh = previous && state.last && state.last !== previous.last && previous.phase === 'playing'
      const holeOfShot = fresh ? previous.hole : state.hole
      if (shownHole !== holeOfShot) { svg.innerHTML = course(HOLES[holeOfShot]); shownHole = holeOfShot }
      if (fresh) {
        animate({ ...state.last, hole: previous.hole })
        if (state.hole !== previous.hole) setTimeout(() => { svg.innerHTML = course(HOLES[state.hole]); shownHole = state.hole; drawBalls() }, 1600)
      }
      drawBalls()
      overlay()
    },
    destroy() { svg.remove() },
  }

  // The start button, and the scorecard at the end, over the course.
  function overlay() {
    lobby.update({
      open: state.phase !== 'playing',
      seated: Object.keys(info.names ?? {}).length,
      min: 1,
      mine: info.mySeat != null,
      again: state.phase === 'over',
      extra: state.phase === 'over' ? scorecard() : '',
    })
  }

  function scorecard() {
    const name = (seat) => info.names?.[seat] ?? `player ${seat + 1}`
    const rows = state.order.map((seat) => {
      const cells = state.cards.map((c) => `<td>${c?.[seat] ?? '–'}</td>`).join('')
      const total = state.cards.reduce((n, c) => n + (c?.[seat] ?? 0), 0)
      return `<tr><th><span class="dot" style="background:${ctx.colours[seat]}"></span>${name(seat)}</th>${cells}<td><b>${total}</b></td></tr>`
    }).join('')
    return `<table class="golf-card"><tr><th></th>${HOLES.map((_, i) => `<th>${i + 1}</th>`).join('')}<th>total</th></tr>
      <tr class="par"><th>par</th>${HOLES.map((h) => `<td>${h.par}</td>`).join('')}<td>${HOLES.reduce((n, h) => n + h.par, 0)}</td></tr>${rows}</table>`
  }
}

// ------------------------------------------------------------------- game

export default defineGame({
  id: 'minigolf',
  name: 'Minigolf',
  tone: 'leaf',
  kind: 'turns',
  seats: { min: 1, max: 4 },
  pieces: 'players',
  rules,
  view,
  icon: `
    <ellipse cx="28" cy="36" rx="22" ry="7" fill="#6bd66b" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="33" cy="36" rx="5" ry="2" fill="${INK}"/>
    <line x1="33" y1="36" x2="33" y2="6" stroke="${INK}" stroke-width="2.5"/>
    <path d="M33 6 L48 11 L33 16 Z" fill="#ff5d8f" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="16" cy="33" r="3.5" fill="#fff" stroke="${INK}" stroke-width="2"/>`,
})
