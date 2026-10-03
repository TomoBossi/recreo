/**
 * Pictionary: one player draws a word, everyone else races to guess it.
 *
 * Authoritative, because guesses race: when two people type the word at the
 * same moment, somebody has to decide who was first, and only one peer can.
 * The drawer is the authority — their strokes go straight into the game with
 * no round trip — and the role passes along with the pencil. If the drawer
 * leaves, the next player at the table takes over and ends the round.
 *
 * Only the authority appends moves. Everyone applies them with the rules
 * below, so the state is the same everywhere and a late arrival replays it.
 */
import { WORDS } from './words.js'

const NS = 'http://www.w3.org/2000/svg'
const CHOOSE_MS = 15000
const DRAW_MS = 80000
const REVEAL_MS = 5000
const CYCLES = 1
const GUESS_POINTS = [10, 8, 6, 4]
const DRAWER_POINTS = 3
const COLOURS = ['#241c3a', '#ff5d8f', '#3c7ff0', '#6bd66b', '#ffd23f', '#ff9a3c', '#9a7bf2', '#8b5a2b']
const PAPER = '#fffaf0'

/** A seedable generator whose state lives in the game state. */
function next(rng) {
  let x = rng >>> 0 || 0x9e3779b9
  x ^= x << 13; x >>>= 0
  x ^= x >>> 17
  x ^= x << 5; x >>>= 0
  return x
}

/** Three different words for a drawer to choose from. */
function choices(rng) {
  const out = []
  let r = rng
  while (out.length < 3) {
    r = next(r)
    const word = WORDS[r % WORDS.length]
    if (!out.includes(word)) out.push(word)
  }
  return { words: out, rng: r }
}

const normal = (text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

/** One letter off counts as close: a typo, not a miss. */
function close(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1)
}

function startTurn(s, at) {
  const drawer = s.order[s.turn % s.order.length]
  const picked = choices(s.rng)
  return {
    ...s,
    phase: 'choosing',
    drawer,
    word: null,
    choices: picked.words,
    rng: picked.rng,
    strokes: [],
    guessed: {},
    phaseAt: at,
    log: [...s.log, { kind: 'system', text: `seat:${drawer} is choosing a word` }],
  }
}

export default {
  id: 'draw',
  name: 'Pictionary',
  tone: 'berry',
  seats: 4,
  minSeats: 2,
  mode: 'authoritative',
  ownRestart: true,
  playerColours: true,
  seatColours: ['#ff5d8f', '#3c7ff0', '#6bd66b', '#ff9a3c'],

  init({ seed }) {
    return {
      phase: 'waiting', rng: seed >>> 0, order: [], turn: 0, drawer: null, word: null, choices: [],
      strokes: [], guessed: {}, scores: {}, log: [], phaseAt: 0,
    }
  },

  /** Nobody takes turns: the authority decides. */
  turn() { return null },

  legal() { return true },

  /** The drawer runs the game; before there is one, the first seat here does. */
  authority(s, here) {
    if (s.drawer != null && here.includes(s.drawer) && (s.phase === 'choosing' || s.phase === 'drawing')) return s.drawer
    return here.length ? Math.min(...here) : null
  },

  /** As the authority: what an intent from a seat turns into. */
  decide(s, intent, seat, { now, seated }) {
    switch (intent?.type) {
      case 'start':
        if ((s.phase === 'waiting' || s.phase === 'over') && seated.length >= 2) return [{ type: 'start', order: seated, at: now }]
        return []
      case 'choose':
        if (s.phase === 'choosing' && seat === s.drawer && s.choices.includes(intent.word)) return [{ type: 'choose', word: intent.word, at: now }]
        return []
      case 'stroke':
        if (s.phase === 'drawing' && seat === s.drawer && Array.isArray(intent.pts)) {
          return [{ type: 'stroke', id: intent.id, c: intent.c, w: intent.w, pts: intent.pts.slice(0, 400).map((n) => Math.round(n)) }]
        }
        return []
      case 'clear':
        return s.phase === 'drawing' && seat === s.drawer ? [{ type: 'clear' }] : []
      case 'guess': {
        const text = String(intent.text ?? '').slice(0, 60)
        if (!text.trim() || seat === s.drawer || s.guessed[seat] != null) return []
        return [{ type: 'guess', seat, text, at: now }]
      }
      default:
        return []
    }
  },

  /** As the authority: what the clock says should happen now. */
  tick(s, { now, here }) {
    if (s.phase === 'choosing' && (!here.includes(s.drawer) || now - s.phaseAt > CHOOSE_MS)) {
      if (!here.includes(s.drawer)) return [{ type: 'end', why: 'the drawer left', at: now }]
      return [{ type: 'choose', word: s.choices[0], at: now }]
    }
    if (s.phase === 'drawing' && (!here.includes(s.drawer) || now - s.phaseAt > DRAW_MS)) {
      return [{ type: 'end', why: here.includes(s.drawer) ? 'time is up' : 'the drawer left', at: now }]
    }
    if (s.phase === 'reveal' && now - s.phaseAt > REVEAL_MS) return [{ type: 'next', at: now }]
    return []
  },

  apply(s, move) {
    switch (move.type) {
      case 'start':
        return startTurn({ ...this.init({ seed: s.rng }), rng: s.rng, order: move.order, scores: Object.fromEntries(move.order.map((x) => [x, 0])), log: [] }, move.at)
      case 'choose':
        return { ...s, phase: 'drawing', word: move.word, choices: [], phaseAt: move.at, log: [...s.log, { kind: 'system', text: `seat:${s.drawer} is drawing` }] }
      case 'stroke': {
        const strokes = s.strokes.slice()
        const last = strokes[strokes.length - 1]
        if (last && last.id === move.id) strokes[strokes.length - 1] = { ...last, pts: [...last.pts, ...move.pts] }
        else strokes.push({ id: move.id, c: move.c, w: move.w, pts: move.pts })
        return { ...s, strokes }
      }
      case 'clear':
        return { ...s, strokes: [] }
      case 'guess': {
        const right = normal(move.text) === normal(s.word)
        if (!right) {
          const kind = close(normal(move.text), normal(s.word)) ? 'close' : 'guess'
          return { ...s, log: [...s.log, { kind, seat: move.seat, text: move.text }] }
        }
        const order = Object.keys(s.guessed).length
        const points = GUESS_POINTS[order] ?? 2
        const scores = { ...s.scores, [move.seat]: (s.scores[move.seat] ?? 0) + points, [s.drawer]: (s.scores[s.drawer] ?? 0) + DRAWER_POINTS }
        const guessed = { ...s.guessed, [move.seat]: order }
        const next = { ...s, scores, guessed, log: [...s.log, { kind: 'correct', seat: move.seat, text: `+${points}` }] }
        const guessers = s.order.filter((x) => x !== s.drawer)
        if (guessers.every((x) => guessed[x] != null)) {
          return { ...next, phase: 'reveal', phaseAt: move.at, log: [...next.log, { kind: 'system', text: `everyone got it — the word was "${s.word}"` }] }
        }
        return next
      }
      case 'end':
        return { ...s, phase: 'reveal', phaseAt: move.at, log: [...s.log, { kind: 'system', text: `${move.why} — the word was "${s.word ?? '…'}"` }] }
      case 'next': {
        const turn = s.turn + 1
        if (turn >= s.order.length * CYCLES) {
          return { ...s, phase: 'over', turn, drawer: null, phaseAt: move.at, log: [...s.log, { kind: 'system', text: 'game over' }] }
        }
        return startTurn({ ...s, turn }, move.at)
      }
      default:
        return s
    }
  },

  status(s, names) {
    const name = (seat) => names[seat] ?? `player ${seat + 1}`
    switch (s.phase) {
      case 'waiting': return 'press start when everyone is seated'
      case 'choosing': return `${name(s.drawer)} is choosing a word…`
      case 'drawing': return `${name(s.drawer)} is drawing`
      case 'reveal': return `the word was “${s.word ?? '…'}”`
      case 'over': {
        const best = Math.max(...Object.values(s.scores))
        const winners = Object.keys(s.scores).filter((k) => s.scores[k] === best).map((k) => name(Number(k)))
        return `${winners.join(' & ')} ${winners.length > 1 ? 'win' : 'wins'} with ${best}!`
      }
      default: return ''
    }
  },

  view: {
    mount(el, ctx) {
      el.classList.add('draw-stage')
      el.innerHTML = `
        <div class="draw">
          <div class="draw-top">
            <span class="draw-word"></span>
            <span class="draw-clock"></span>
          </div>
          <div class="draw-main">
            <div class="draw-paper">
              <svg class="draw-canvas" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid meet">
                <rect width="1000" height="700" fill="${PAPER}"/>
                <g class="strokes"></g><g class="live"></g>
              </svg>
              <div class="draw-overlay"></div>
            </div>
            <div class="draw-side">
              <div class="draw-scores"></div>
              <div class="draw-log"></div>
              <form class="draw-guess"><input class="input" maxlength="60" placeholder="your guess" aria-label="guess"><button class="btn small sun">guess</button></form>
            </div>
          </div>
          <div class="draw-tools"></div>
        </div>`
      const $ = (sel) => el.querySelector(sel)
      const svg = $('.draw-canvas')
      const strokesG = $('.strokes')
      const liveG = $('.live')
      const overlay = $('.draw-overlay')
      const tools = $('.draw-tools')
      const guessForm = $('.draw-guess')
      const guessInput = guessForm.querySelector('input')

      let state = null
      let info = {}
      let colour = COLOURS[0]
      let width = 8
      let phaseSeenAt = 0
      let lastPhase = null

      const name = (seat) => info.names?.[seat] ?? `player ${seat + 1}`
      const iDraw = () => state?.phase === 'drawing' && info.mySeat === state.drawer

      // Tools: colours, two widths, an eraser, and clear.
      tools.innerHTML = COLOURS.map((c) => `<button class="swatch" data-colour="${c}" style="background:${c}" aria-label="colour"></button>`).join('')
        + '<button class="swatch eraser" data-colour="eraser" aria-label="eraser"></button>'
        + '<button class="btn small" data-width="8">thin</button><button class="btn small" data-width="22">thick</button>'
        + '<button class="btn small berry" data-clear>clear</button>'
      tools.addEventListener('click', (e) => {
        const b = e.target.closest('button')
        if (!b) return
        if (b.dataset.colour) colour = b.dataset.colour === 'eraser' ? PAPER : b.dataset.colour
        if (b.dataset.width) width = Number(b.dataset.width)
        if ('clear' in b.dataset) ctx.intend({ type: 'clear' })
        for (const t of tools.querySelectorAll('.swatch')) t.classList.toggle('on', (t.dataset.colour === 'eraser' ? PAPER : t.dataset.colour) === colour)
        for (const t of tools.querySelectorAll('[data-width]')) t.setAttribute('aria-pressed', String(Number(t.dataset.width) === width))
      })

      // Drawing: points are batched and sent a few times a second, so a
      // stroke appears for everyone while it is still being drawn.
      let current = null
      let pending = []
      let flushTimer = null
      const point = (e) => {
        const box = svg.getBoundingClientRect()
        const scale = Math.max(1000 / box.width, 700 / box.height)
        const ox = (box.width * scale - 1000) / 2
        const oy = (box.height * scale - 700) / 2
        return [Math.round((e.clientX - box.left) * scale - ox), Math.round((e.clientY - box.top) * scale - oy)]
      }
      const flush = () => {
        flushTimer = null
        if (!current || pending.length === 0) return
        ctx.intend({ type: 'stroke', id: current.id, c: current.c, w: current.w, pts: pending })
        pending = []
      }
      svg.addEventListener('pointerdown', (e) => {
        if (!iDraw()) return
        e.preventDefault()
        svg.setPointerCapture(e.pointerId)
        current = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, c: colour, w: width, pts: point(e) }
        pending = [...current.pts]
        drawLive()
        flush()
      })
      svg.addEventListener('pointermove', (e) => {
        if (!current) return
        const p = point(e)
        current.pts.push(...p)
        pending.push(...p)
        drawLive()
        if (!flushTimer) flushTimer = setTimeout(flush, 80)
      })
      const end = () => { if (current) { flush(); current = null; liveG.textContent = '' } }
      svg.addEventListener('pointerup', end)
      svg.addEventListener('pointercancel', end)

      const pathOf = (pts) => {
        if (pts.length < 2) return ''
        let d = `M${pts[0]} ${pts[1]}`
        if (pts.length === 2) d += `l0.1 0`
        for (let i = 2; i < pts.length; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`
        return d
      }
      const strokeEl = (st) => `<path d="${pathOf(st.pts)}" fill="none" stroke="${st.c}" stroke-width="${st.w}" stroke-linecap="round" stroke-linejoin="round"/>`
      function drawLive() { liveG.innerHTML = current ? strokeEl(current) : '' }

      guessForm.addEventListener('submit', (e) => {
        e.preventDefault()
        const text = guessInput.value.trim()
        if (!text) return
        guessInput.value = ''
        ctx.intend({ type: 'guess', text })
      })

      overlay.addEventListener('click', (e) => {
        const b = e.target.closest('button')
        if (!b) return
        if (b.dataset.word) ctx.intend({ type: 'choose', word: b.dataset.word })
        if ('start' in b.dataset) ctx.intend({ type: 'start' })
      })

      // A clock in the corner, counting down from when this peer saw the
      // phase begin — machines' clocks disagree, arrival times do not much.
      const clock = $('.draw-clock')
      const clockTimer = setInterval(() => {
        if (!state) return
        const total = state.phase === 'drawing' ? DRAW_MS : state.phase === 'choosing' ? CHOOSE_MS : 0
        clock.textContent = total ? `${Math.max(0, Math.ceil((total - (Date.now() - phaseSeenAt)) / 1000))}s` : ''
      }, 250)

      function render() {
        const s = state
        if (s.phase !== lastPhase) { phaseSeenAt = Date.now(); lastPhase = s.phase }
        el.classList.toggle('drawing', iDraw())

        // The word: the drawer sees it, guessers see blanks, and those who
        // guessed it — and everyone once it is revealed — see it again.
        const word = $('.draw-word')
        const know = info.mySeat === s.drawer || (info.mySeat != null && s.guessed[info.mySeat] != null) || s.phase === 'reveal'
        if (s.phase === 'drawing' || s.phase === 'reveal') {
          word.textContent = know ? s.word : s.word.replace(/[a-z]/gi, '_ ').trim() + `  (${s.word.replace(/ /g, '').length})`
        } else {
          word.textContent = ''
        }

        strokesG.innerHTML = s.strokes.map(strokeEl).join('')

        // What goes over the paper, when anything does.
        let over = ''
        if (s.phase === 'waiting' || s.phase === 'over') {
          const seated = Object.keys(info.names ?? {}).length
          over = info.mySeat != null && seated >= 2
            ? `<button class="btn sun big" data-start>${s.phase === 'over' ? 'play again' : 'start!'}</button>`
            : `<p>${seated < 2 ? 'need at least two players' : 'waiting for a player to start'}</p>`
        } else if (s.phase === 'choosing') {
          over = info.mySeat === s.drawer
            ? `<p>pick a word to draw</p><div class="choices">${s.choices.map((w) => `<button class="btn grape" data-word="${w}">${w}</button>`).join('')}</div>`
            : `<p>${name(s.drawer)} is choosing a word…</p>`
        }
        overlay.innerHTML = over
        overlay.hidden = !over

        $('.draw-scores').innerHTML = s.order.map((seat) => `
          <div class="score ${seat === s.drawer ? 'drawer' : ''} ${s.guessed[seat] != null ? 'got' : ''}">
            <span class="dot" style="background:${ctx.colours[seat]}"></span>
            <span class="who">${escape(name(seat))}</span><b>${s.scores[seat] ?? 0}</b>
          </div>`).join('')

        const log = $('.draw-log')
        log.innerHTML = s.log.slice(-40).map((line) => {
          const text = escape(line.text.replace(/seat:(\d)/g, (_, n) => name(Number(n))))
          if (line.kind === 'system') return `<div class="line system">${text}</div>`
          if (line.kind === 'correct') return `<div class="line correct"><b>${escape(name(line.seat))}</b> guessed it! ${text}</div>`
          if (line.kind === 'close') return `<div class="line close"><b>${escape(name(line.seat))}</b> ${text} <i>— so close!</i></div>`
          return `<div class="line"><b>${escape(name(line.seat))}</b> ${text}</div>`
        }).join('')
        log.scrollTop = log.scrollHeight

        const canGuess = s.phase === 'drawing' && info.mySeat != null && info.mySeat !== s.drawer && s.guessed[info.mySeat] == null
        guessInput.disabled = !canGuess
        guessForm.querySelector('button').disabled = !canGuess
        guessInput.placeholder = info.mySeat === s.drawer && s.phase === 'drawing' ? 'you are drawing' : canGuess ? 'your guess' : 'not now'
        tools.hidden = !iDraw()
      }

      return {
        update(next, nextInfo) { state = next; info = nextInfo; render() },
        destroy() { clearInterval(clockTimer); el.textContent = '' },
      }
    },
  },
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
