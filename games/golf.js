/**
 * Minigolf: take turns putting round a few small holes; fewest strokes wins.
 *
 * Replicated, so every peer must put a ball in exactly the same place. The
 * physics is integer arithmetic throughout — no Math.sin, no floats — and a
 * shot is the integer vector the player pulled back, so there is nothing
 * for two machines to round differently. The view animates a shot by running
 * the same simulation the rules ran.
 */

const NS = 'http://www.w3.org/2000/svg'
const UNIT = 100           // simulation units per course unit
const W = 1000
const H = 600
const BALL = 11            // radius, course units
const CUP = 17
const MAX_SPEED = 1400     // units per tick; walls are thicker than a tick's travel
const FRICTION = 984       // per mille kept each tick
const BOUNCE = 780         // per mille kept off a wall
const STOP = 18            // below this speed a ball rests
const SINK_SPEED = 900     // faster than this, a ball rides over the cup
const MAX_STROKES = 8
const MAX_TICKS = 2400

/**
 * The course. Walls and water are rectangles [x, y, w, h] in course units;
 * the outer border is always there.
 */
const HOLES = [
  { name: 'straight on', par: 2, tee: [120, 300], cup: [870, 300], walls: [], water: [] },
  { name: 'the dogleg', par: 3, tee: [120, 480], cup: [860, 120],
    walls: [[300, 220, 400, 380]], water: [] },
  { name: 'the pond', par: 3, tee: [110, 120], cup: [880, 470],
    walls: [[440, 0, 30, 380], [600, 220, 30, 380]], water: [[680, 60, 220, 120]] },
  { name: 'the gauntlet', par: 4, tee: [110, 300], cup: [890, 300],
    walls: [[260, 0, 40, 250], [260, 350, 40, 250], [480, 150, 40, 300], [700, 0, 40, 250], [700, 350, 40, 250]],
    water: [[380, 0, 80, 120], [380, 480, 80, 120]] },
]

const BORDER = 24
const outer = [[0, 0, W, BORDER], [0, H - BORDER, W, BORDER], [0, 0, BORDER, H], [W - BORDER, 0, BORDER, H]]

const inRect = (x, y, [rx, ry, rw, rh], pad = 0) => x > (rx - pad) * UNIT && x < (rx + rw + pad) * UNIT && y > (ry - pad) * UNIT && y < (ry + rh + pad) * UNIT

/**
 * Roll a ball from a position with a velocity until it rests, sinks or
 * drowns. Returns every position along the way (for drawing) and the end.
 * Pure integer arithmetic: the same on every machine, always.
 */
export function roll(hole, [x, y], [vx, vy]) {
  const walls = [...outer, ...hole.walls]
  const path = [[x, y]]
  const cx = hole.cup[0] * UNIT
  const cy = hole.cup[1] * UNIT
  for (let t = 0; t < MAX_TICKS; t++) {
    let nx = x + vx
    let ny = y + vy
    for (const wall of walls) {
      if (!inRect(nx, ny, wall, BALL)) continue
      // Bounce off whichever side was crossed this tick.
      if (!inRect(x, ny, wall, BALL)) { vy = -Math.trunc(vy * BOUNCE / 1000); ny = y } else if (!inRect(nx, y, wall, BALL)) { vx = -Math.trunc(vx * BOUNCE / 1000); nx = x } else {
        vx = -Math.trunc(vx * BOUNCE / 1000); vy = -Math.trunc(vy * BOUNCE / 1000); nx = x; ny = y
      }
    }
    x = nx
    y = ny
    vx = Math.trunc(vx * FRICTION / 1000)
    vy = Math.trunc(vy * FRICTION / 1000)
    path.push([x, y])
    const dx = x - cx
    const dy = y - cy
    const speed2 = vx * vx + vy * vy
    if (dx * dx + dy * dy < (CUP * UNIT) ** 2 && speed2 < SINK_SPEED ** 2) return { path, end: [cx, cy], sunk: true }
    for (const pond of hole.water) {
      if (inRect(x, y, pond)) return { path, end: null, drowned: true }
    }
    if (speed2 < STOP * STOP) break
  }
  return { path, end: [x, y] }
}

/** Clamp a pulled-back vector to the strongest shot allowed, in integers. */
export function clampShot(dx, dy) {
  dx = Math.trunc(dx)
  dy = Math.trunc(dy)
  const len2 = dx * dx + dy * dy
  if (len2 <= MAX_SPEED * MAX_SPEED) return [dx, dy]
  // Integer square root, so the length is the same everywhere.
  let len = Math.floor(Math.sqrt(len2))
  while (len * len > len2) len--
  while ((len + 1) * (len + 1) <= len2) len++
  return [Math.trunc(dx * MAX_SPEED / len), Math.trunc(dy * MAX_SPEED / len)]
}

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
  const turn = waiting.sort((a, b) => away(b) - away(a) || a - b)[0]
  return { ...s, turn }
}

export default {
  id: 'golf',
  name: 'Minigolf',
  tone: 'leaf',
  seats: 4,
  minSeats: 2,
  mode: 'replicated',
  ownRestart: true,
  seatColours: ['#ff5d8f', '#3c7ff0', '#ffd23f', '#ff9a3c'],

  init() {
    return { phase: 'waiting', order: [], hole: 0, balls: {}, turn: null, cards: HOLES.map(() => null), last: null }
  },

  /** Before it starts, anyone seated may start it; then whoever is away. */
  turn(s) { return s.phase === 'playing' ? s.turn : 'any' },

  legal(s, move, seat) {
    if (move?.type === 'start') {
      return (s.phase === 'waiting' || s.phase === 'over') && Array.isArray(move.order)
        && move.order.length >= 2 && move.order.includes(seat) && move.order.every(Number.isInteger)
    }
    return s.phase === 'playing' && s.turn === seat && move?.type === 'shot'
      && Number.isInteger(move.dx) && Number.isInteger(move.dy)
  },

  apply(s, move, seat) {
    if (move.type === 'start') {
      return startHole({ ...this.init(), phase: 'playing', order: [...move.order].sort((a, b) => a - b) }, 0)
    }
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
    if (s.phase === 'waiting') return 'press start when everyone is seated'
    if (s.phase === 'over') {
      const totals = s.order.map((seat) => [seat, s.cards.reduce((n, c) => n + (c?.[seat] ?? 0), 0)])
      const best = Math.min(...totals.map(([, n]) => n))
      const winners = totals.filter(([, n]) => n === best).map(([seat]) => name(seat))
      return `${winners.join(' & ')} ${winners.length > 1 ? 'win' : 'wins'} with ${best} strokes!`
    }
    const hole = HOLES[s.hole]
    const last = s.last
    const note = last?.sunk ? `${name(last.seat)} sank it! · ` : last?.drowned ? `${name(last.seat)} found the water · ` : ''
    return `${note}hole ${s.hole + 1}: ${hole.name} (par ${hole.par}) — ${name(s.turn)} to putt`
  },

  view: {
    mount(el, ctx) {
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', `-8 -8 ${W + 16} ${H + 16}`)
      svg.setAttribute('class', 'golf')
      el.append(svg)

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

      // The start button and the scorecard sit over the course when needed.
      function overlay() {
        let box = el.querySelector('.golf-over')
        if (!box) {
          box = document.createElement('div')
          box.className = 'golf-over'
          el.append(box)
          box.addEventListener('click', (e) => {
            if (!e.target.closest('[data-start]')) return
            ctx.play({ type: 'start', order: Object.keys(info.names ?? {}).map(Number) })
          })
        }
        const seated = Object.keys(info.names ?? {}).length
        if (state.phase === 'waiting' || state.phase === 'over') {
          const card = state.phase === 'over' ? scorecard() : ''
          box.innerHTML = `${card}${info.mySeat != null && seated >= 2
            ? `<button class="btn sun big" data-start>${state.phase === 'over' ? 'play again' : 'tee off!'}</button>`
            : `<p>${seated < 2 ? 'need at least two at the table' : 'waiting for a player to start'}</p>`}`
          box.hidden = false
        } else {
          box.hidden = true
        }
      }

      function scorecard() {
        const name = (seat) => info.names?.[seat] ?? `player ${seat + 1}`
        const rows = state.order.map((seat) => {
          const cells = state.cards.map((c) => `<td>${c?.[seat] ?? '–'}</td>`).join('')
          const total = state.cards.reduce((n, c) => n + (c?.[seat] ?? 0), 0)
          return `<tr><th><span class="dot" style="background:${ctx.colours[seat]}"></span>${name(seat)}</th>${cells}<td><b>${total}</b></td></tr>`
        }).join('')
        return `<table class="card"><tr><th></th>${HOLES.map((_, i) => `<th>${i + 1}</th>`).join('')}<th>total</th></tr>
          <tr class="par"><th>par</th>${HOLES.map((h) => `<td>${h.par}</td>`).join('')}<td>${HOLES.reduce((n, h) => n + h.par, 0)}</td></tr>${rows}</table>`
      }
    },
  },
}
