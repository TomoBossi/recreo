/**
 * Minigolf: take turns putting round a few small holes; fewest strokes wins.
 * Solo, or with up to three friends.
 */
import { defineGame } from '../kit/define.js'
import { board, escape, INK } from '../kit/svg.js'
import { startPanel } from '../kit/lobby.js'
import { HOLES, roll, clampShot, UNIT, W, H, BALL, CUP, BORDER, MAX_SPEED, MAX_STROKES } from './physics.js'

/** How far, in course units, a pull reaches for the strongest shot. */
const PULL = 260

// ------------------------------------------------------------------ rules

/** The seats still playing: everyone who started, less whoever forfeited. */
const playing = (s) => s.order.filter((seat) => !s.out.includes(seat))

/** Strokes so far, card by card. A forfeiter's card stops where they left. */
const total = (s, seat) => s.cards.reduce((n, c) => n + (c?.[seat] ?? 0), 0)

function startHole(s, index) {
  const hole = HOLES[index]
  const balls = {}
  for (const seat of playing(s)) balls[seat] = { pos: [hole.tee[0] * UNIT, hole.tee[1] * UNIT], strokes: 0, done: false }
  return { ...s, hole: index, balls, turn: s.order[0], last: null }
}

function nextTurn(s) {
  const waiting = playing(s).filter((seat) => !s.balls[seat].done)
  if (waiting.length === 0) {
    const cards = s.cards.map((c, i) => (i === s.hole ? Object.fromEntries(playing(s).map((seat) => [seat, s.balls[seat].strokes])) : c))
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

const init = () => ({ phase: 'waiting', order: [], out: [], hole: 0, balls: {}, turn: null, cards: HOLES.map(() => null), last: null })

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
    const par = HOLES.reduce((n, h) => n + h.par, 0)
    if (left.length === 0) return { winners: [], reason: 'gave up the round' }
    if (s.order.length === 1) return { winners: left, reason: `${total(s, left[0])} strokes, par ${par}` }
    const quitters = s.out.map((seat) => names[seat] ?? `player ${seat + 1}`)
    if (left.length === 1 && s.cards.some((c) => c === null)) return { winners: left, reason: `${quitters.join(' & ')} forfeited` }
    const best = Math.min(...left.map((seat) => total(s, seat)))
    return { winners: left.filter((seat) => total(s, seat) === best), reason: `${best} strokes, par ${par}` }
  },

  status(s, names) {
    const name = (seat) => names[seat] ?? `player ${seat + 1}`
    if (s.phase === 'waiting') return 'tee off when everyone is in'
    if (s.phase === 'over') {
      const result = rules.outcome(s, names)
      if (!result.winners.length) return result.reason
      const who = result.winners.map(name)
      if (s.order.length === 1) return result.reason
      return `${who.join(' & ')} ${who.length > 1 ? 'win' : 'wins'} — ${result.reason}`
    }
    const hole = HOLES[s.hole]
    const last = s.last
    const note = last?.sunk ? `${name(last.seat)} sank it! · ` : last?.drowned ? `${name(last.seat)} found the water · ` : ''
    return `${note}hole ${s.hole + 1}: ${hole.name} (par ${hole.par}) — ${name(s.turn)} to putt`
  },
}

// ------------------------------------------------------------------- view

function view(el, ctx) {
  const svg = board(el, { viewBox: `-2 -2 ${W + 4} ${H + 4}`, className: 'golf' })
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
  /** A pointer's position in course units, through the board's own transform. */
  const toCourse = (e) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse())
    return [p.x, p.y]
  }

  function course(hole) {
    const rect = ([x, y, w, h], cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`
    // The border is one wooden frame round the green, outlined once inside
    // and once out, so its lines are as thin as every other line.
    const B = BORDER
    return `
      <rect x="${B}" y="${B}" width="${W - 2 * B}" height="${H - 2 * B}" fill="#5fc85f"/>
      <g class="stripes">${Array.from({ length: 10 }, (_, i) => [Math.max(B, i * 100), Math.min(W - B, i * 100 + 50)])
        .filter(([a, b]) => b > a).map(([a, b]) => `<rect x="${a}" y="${B}" width="${b - a}" height="${H - 2 * B}" fill="#6bd66b"/>`).join('')}</g>
      ${hole.water.map((r) => rect(r, 'water')).join('')}
      ${hole.walls.map((r) => rect(r, 'wall')).join('')}
      <path class="wall" fill-rule="evenodd" d="M12 0 H${W - 12} Q${W} 0 ${W} 12 V${H - 12} Q${W} ${H} ${W - 12} ${H} H12 Q0 ${H} 0 ${H - 12} V12 Q0 0 12 0 Z
        M${B} ${B} V${H - B} H${W - B} V${B} Z"/>
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
      let r = BALL
      if (animating && animating.seat === seat) {
        [x, y] = animating.path[animating.i]
        if (animating.sinking !== null) {
          const hole = HOLES[shownHole]
          x += (hole.cup[0] * UNIT - x) * animating.sinking
          y += (hole.cup[1] * UNIT - y) * animating.sinking
          r = BALL * (1 - 0.55 * animating.sinking)
        }
      } else if (b.done) continue
      html += `<circle cx="${x / UNIT}" cy="${y / UNIT}" r="${r}" fill="${ctx.colours[seat]}" stroke="var(--ink)" stroke-width="3"/>
        <circle cx="${x / UNIT - r * 0.32}" cy="${y / UNIT - r * 0.32}" r="${r * 0.27}" fill="#fff" opacity="0.7"/>`
      if (seat === state.turn && !animating) html += `<circle cx="${x / UNIT}" cy="${y / UNIT}" r="${BALL + 8}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="5 4" class="spin"/>`
    }
    g.innerHTML = html
  }

  /** The pull, drawn from the ball to the pointer — as far as the strongest shot reaches. */
  function drawAim() {
    const g = svg.querySelector('.aim')
    if (!aim || !myTurn()) { g.innerHTML = ''; return }
    const [bx, by] = state.balls[state.turn].pos.map((v) => v / UNIT)
    const [px, py] = aim.pointer
    const len = Math.hypot(px - bx, py - by)
    const k = len > PULL ? PULL / len : 1
    const ex = bx + (px - bx) * k
    const ey = by + (py - by) * k
    const power = Math.round(Math.min(1, len / PULL) * 100)
    g.innerHTML = `
      <line x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" stroke="var(--ink)" stroke-width="9" stroke-linecap="round"/>
      <line x1="${bx}" y1="${by}" x2="${ex}" y2="${ey}" stroke="${power > 80 ? 'var(--berry)' : 'var(--sun)'}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="${ex}" cy="${ey}" r="7" fill="#fff" stroke="var(--ink)" stroke-width="3"/>
      <text x="${ex + 14}" y="${ey - 12}" class="power">${power}%</text>`
  }

  /** The shot a pull makes: away from the pointer, as hard as the pull is long. */
  function shotOf(pointer) {
    const [bx, by] = state.balls[state.turn].pos.map((v) => v / UNIT)
    const dx = bx - pointer[0]
    const dy = by - pointer[1]
    const len = Math.hypot(dx, dy)
    if (len < 12) return null
    const speed = Math.min(1, len / PULL) * MAX_SPEED
    return clampShot((dx / len) * speed, (dy / len) * speed)
  }

  // Pull back from the ball like a slingshot and let go to putt.
  svg.addEventListener('pointerdown', (e) => {
    if (!myTurn() || animating) return
    e.preventDefault()
    svg.setPointerCapture(e.pointerId)
    // A slingshot: the line runs from the ball to the pointer, and the
    // ball goes the other way, harder the further it is pulled.
    const move = (ev) => {
      aim = { pointer: toCourse(ev) }
      drawAim()
    }
    move(e)
    const up = (ev) => {
      svg.removeEventListener('pointermove', move)
      svg.removeEventListener('pointerup', up)
      svg.removeEventListener('pointercancel', up)
      const shot = ev.type === 'pointerup' && aim ? shotOf(aim.pointer) : null
      if (shot) ctx.play({ type: 'shot', dx: shot[0], dy: shot[1] })
      aim = null
      drawAim()
    }
    svg.addEventListener('pointermove', move)
    svg.addEventListener('pointerup', up)
    svg.addEventListener('pointercancel', up)
  })

  function animate(last, done) {
    const result = roll(HOLES[last.hole ?? state.hole], last.from, last.shot)
    animating = { seat: last.seat, path: result.path, i: 0, sinking: result.sunk ? 0 : null }
    const step = () => {
      if (!animating) return
      if (animating.i < animating.path.length - 1) animating.i = Math.min(animating.path.length - 1, animating.i + 3)
      // A sunk ball drops into the cup before it disappears.
      else if (animating.sinking !== null && animating.sinking < 1) animating.sinking = Math.min(1, animating.sinking + 0.08)
      else { animating = null; done?.(); return }
      drawBalls()
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
        // Play the shot out in full on its own hole; only then move on to
        // the next hole, or show the end of the round.
        animate({ ...state.last, hole: previous.hole }, () => {
          if (shownHole !== state.hole && state.phase === 'playing') { svg.innerHTML = course(HOLES[state.hole]); shownHole = state.hole }
          drawBalls()
          overlay()
        })
      }
      drawBalls()
      overlay()
    },
    destroy() { svg.remove() },
  }

  // The start button, and the scorecard at the end, over the course.
  function overlay() {
    lobby.update({
      open: state.phase !== 'playing' && !animating,
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
      const out = state.out.includes(seat)
      return `<tr class="${out ? 'out' : ''}"><th><span class="dot" style="background:${ctx.colours[seat]}"></span>${escape(name(seat))}</th>${cells}<td><b>${out ? 'out' : total(state, seat)}</b></td></tr>`
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
