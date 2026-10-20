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
import { defineGame } from '../kit/define.js'
import { escape, INK } from '../kit/svg.js'
import { pick } from '../kit/random.js'
import { startPanel } from '../kit/lobby.js'
import { countdown, sound } from '../kit/sound.js'
import { colourPicker } from '../kit/colours.js'
import english from './words/en.js'
import spanish from './words/es.js'

const CHOOSE_MS = 15000
const DRAW_MS = 80000
const DRAW_TIMES = ['45', '60', '80', '120', '180'] // seconds a drawer has; the option's choices
/** How long a drawer has, in ms: a choice from DRAW_TIMES, else the usual. */
const drawMsOf = (value) => (DRAW_TIMES.includes(String(value)) ? Number(value) * 1000 : DRAW_MS)
const REVEAL_MS = 5000
/** A curved arrow back, for undo; mirrored, it is redo. */
const ARROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 L4 9 L9 4"/><path d="M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11"/></g></svg>`
const AWAY_MS = 20000 // how long a drawer who drops out (a reload, a blip) has to come back
const ROUNDS = ['1', '2', '3', '5'] // each player draws once a round
const GUESS_POINTS = [10, 8, 6, 4]
const DRAWER_POINTS = 3
const WIDTHS = [5, 10, 22]
const COLOURS = ['#241c3a', '#ff5d8f', '#3c7ff0', '#6bd66b', '#ffd23f', '#ff9a3c', '#9a7bf2', '#8b5a2b']

const PAPER = '#fffaf0'

/** What a stroke may be: any colour as #rgb or #rrggbb, a sane width, a short id. Strokes are drawn as markup. */
const HEX = /^#([0-9a-f]{3}){1,2}$/i
const strokeColour = (c) => (HEX.test(c) ? c : COLOURS[0])
const strokeWidth = (w) => Math.min(40, Math.max(2, Math.round(Number(w) || 10)))
const strokeId = (id) => String(id ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 16)

/** Word pools by language: easy, medium and hard where known, else one pool. */
const POOLS = { en: english, es: spanish }
const LEVELS = ['easy', 'medium', 'hard']

/**
 * Three different words for a drawer to choose from: one of each difficulty
 * when the pool knows them, so a hard word is always optional.
 */
function choices(rng, language) {
  const pools = POOLS[language] ?? POOLS.en
  const out = []
  let r = rng
  while (out.length < 3) {
    const drawn = pick(r, pools[pools.length === 3 ? out.length : 0])
    r = drawn.rng
    if (!out.includes(drawn.value)) out.push(drawn.value)
  }
  return { words: out, levels: pools.length === 3 ? LEVELS : null, rng: r }
}

/** Letters only, lowercase, no accents or spacing: what a guess is compared as. */
const normal = (text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')

/** Positions in a word that hold letters, which hints may reveal. */
const letterAt = (word) => [...word].flatMap((ch, i) => (/[\p{L}\p{N}]/u.test(ch) ? [i] : []))

/** How many letters a word gives away by the end: up to two in five, never all. */
const hintsFor = (word) => Math.min(Math.floor(letterAt(word).length * 0.4), letterAt(word).length - 1)

/** How many hints are due after some time drawing: spread from 30% to 85% of the clock. */
function hintsDue(word, elapsed, drawMs = DRAW_MS) {
  const total = hintsFor(word)
  if (total <= 0) return 0
  const t = elapsed / drawMs
  if (t < 0.3) return 0
  return Math.min(total, 1 + Math.floor(((t - 0.3) / 0.55) * (total - 1 || 1)))
}

/** The word as a guesser sees it: blanks, with any hinted letters filled in. */
export function masked(word, shown = []) {
  return [...word].map((ch, i) => (!/[\p{L}\p{N}]/u.test(ch) ? (ch === ' ' ? ' ' : ch) : shown.includes(i) ? ch : '_')).join(' ')
}

/** One letter off counts as close: a typo, not a miss. */
function close(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1)
}

/** The seats still in the game: everyone who started, less whoever forfeited. */
const playing = (s) => s.order.filter((seat) => !s.out.includes(seat))

function startTurn(s, at) {
  const drawer = s.order[s.turn % s.order.length]
  const picked = choices(s.rng, s.language)
  return {
    ...s,
    phase: 'choosing',
    awayAt: null,
    drawer,
    word: null,
    choices: picked.words,
    levels: picked.levels,
    rng: picked.rng,
    strokes: [],
    hints: [],
    guessed: {},
    phaseAt: at,
    log: [...s.log, { kind: 'system', text: `seat:${drawer} is choosing a word` }],
  }
}

// ------------------------------------------------------------------ rules

/** How many rounds a game plays: a choice from ROUNDS, else three. */
const roundsOf = (value) => (ROUNDS.includes(String(value)) ? Number(value) : 3)

function init({ seed, options }) {
  return {
    phase: 'waiting', rng: seed >>> 0, language: options?.words ?? 'en', rounds: roundsOf(options?.rounds), drawMs: drawMsOf(options?.time), order: [], out: [], turn: 0, drawer: null,
    word: null, choices: [], levels: null, strokes: [], hints: [], guessed: {}, scores: {}, log: [], phaseAt: 0,
  }
}

const rules = {
  init,

  /** The word pool can change between games, not during one. */
  optionsOpen: (s) => s.phase === 'waiting' || s.phase === 'over',

  /** The drawer runs the game; before there is one, the first seat here does. */
  authority(s, here) {
    if (s.drawer != null && here.includes(s.drawer) && (s.phase === 'choosing' || s.phase === 'drawing')) return s.drawer
    return here.length ? Math.min(...here) : null
  },

  /** As the authority: what an intent from a seat turns into. */
  decide(s, intent, seat, { now, seated, options }) {
    switch (intent?.type) {
      case 'start':
        if ((s.phase === 'waiting' || s.phase === 'over') && seated.length >= 2) return [{ type: 'start', order: seated, language: options?.words, rounds: options?.rounds, time: options?.time, at: now }]
        return []
      case 'choose':
        if (s.phase === 'choosing' && seat === s.drawer && s.choices.includes(intent.word)) return [{ type: 'choose', word: intent.word, at: now }]
        return []
      case 'stroke':
        if (s.phase === 'drawing' && seat === s.drawer && Array.isArray(intent.pts) && HEX.test(intent.c) && strokeId(intent.id)) {
          return [{ type: 'stroke', id: strokeId(intent.id), c: intent.c, w: strokeWidth(intent.w), pts: intent.pts.slice(0, 400).map((n) => Math.round(Number(n) || 0)) }]
        }
        return []
      case 'clear':
        return s.phase === 'drawing' && seat === s.drawer ? [{ type: 'clear' }] : []
      case 'picture':
        // The drawer's undo and redo: the whole picture as it should now be.
        if (s.phase !== 'drawing' || seat !== s.drawer || !Array.isArray(intent.strokes)) return []
        return [{ type: 'picture', strokes: intent.strokes.slice(0, 2000).filter((st) => st && Array.isArray(st.pts) && HEX.test(st.c) && strokeId(st.id))
          .map((st) => ({ id: strokeId(st.id), c: st.c, w: strokeWidth(st.w), pts: st.pts.slice(0, 20000).map((n) => Math.round(Number(n) || 0)) })) }]
      case 'guess': {
        const text = String(intent.text ?? '').slice(0, 60)
        if (!text.trim() || seat === s.drawer || s.guessed[seat] != null || s.out.includes(seat)) return []
        return [{ type: 'guess', seat, text, at: now }]
      }
      default:
        return []
    }
  },

  /** As the authority: what the clock says should happen now. */
  tick(s, { now, here }) {
    // A drawer who drops out gets a little while to come back — a reload is a
    // blink — and finds the round as they left it; after that the round ends.
    if (s.phase === 'choosing' || s.phase === 'drawing') {
      if (!here.includes(s.drawer)) {
        if (s.awayAt == null) return [{ type: 'away', at: now }]
        if (now - s.awayAt > AWAY_MS) return [{ type: 'end', why: 'the drawer left', at: now }]
      } else if (s.awayAt != null) return [{ type: 'back' }]
    }
    if (s.phase === 'choosing' && now - s.phaseAt > CHOOSE_MS) return [{ type: 'choose', word: s.choices[0], at: now }]
    if (s.phase === 'drawing' && now - s.phaseAt > (s.drawMs ?? DRAW_MS)) return [{ type: 'end', why: 'time is up', at: now }]
    if (s.phase === 'drawing' && s.hints.length < hintsDue(s.word, now - s.phaseAt, s.drawMs ?? DRAW_MS)) return [{ type: 'hint' }]
    if (s.phase === 'reveal' && now - s.phaseAt > REVEAL_MS) return [{ type: 'next', at: now }]
    return []
  },

  apply(s, move) {
    switch (move.type) {
      case 'start': {
        const fresh = init({ seed: s.rng, options: { words: POOLS[move.language] ? move.language : s.language, rounds: move.rounds ?? s.rounds, time: move.time ?? (s.drawMs ?? DRAW_MS) / 1000 } })
        return startTurn({ ...fresh, order: move.order, scores: Object.fromEntries(move.order.map((x) => [x, 0])) }, move.at)
      }
      case 'choose':
        return { ...s, phase: 'drawing', word: move.word, choices: [], levels: null, phaseAt: move.at, log: [...s.log, { kind: 'system', text: `seat:${s.drawer} is drawing` }] }
      case 'stroke': {
        const strokes = s.strokes.slice()
        const last = strokes[strokes.length - 1]
        if (last && last.id === move.id) strokes[strokes.length - 1] = { ...last, pts: [...last.pts, ...move.pts] }
        else strokes.push({ id: move.id, c: move.c, w: move.w, pts: move.pts })
        return { ...s, strokes }
      }
      case 'clear':
        return { ...s, strokes: [] }
      case 'picture':
        return { ...s, strokes: move.strokes }
      case 'away':
        return { ...s, awayAt: move.at }
      case 'back':
        return { ...s, awayAt: null }
      case 'hint': {
        // A letter not yet shown, drawn from the game's own generator.
        const hidden = letterAt(s.word ?? '').filter((i) => !s.hints.includes(i))
        if (hidden.length <= 1) return s
        const drawn = pick(s.rng, hidden)
        return { ...s, hints: [...s.hints, drawn.value], rng: drawn.rng }
      }
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
        const guessers = playing(s).filter((x) => x !== s.drawer)
        if (guessers.every((x) => guessed[x] != null)) {
          return { ...next, phase: 'reveal', phaseAt: move.at, log: [...next.log, { kind: 'system', text: `everyone got it — the word was "${s.word}"` }] }
        }
        return next
      }
      case 'end':
        return { ...s, phase: 'reveal', awayAt: null, phaseAt: move.at, log: [...s.log, { kind: 'system', text: `${move.why} — the word was "${s.word ?? '…'}"` }] }
      case 'next': {
        // The pencil skips whoever has forfeited.
        const turns = s.order.length * (s.rounds ?? 1)
        let turn = s.turn + 1
        while (turn < turns && s.out.includes(s.order[turn % s.order.length])) turn++
        if (turn >= turns) {
          return { ...s, phase: 'over', turn, drawer: null, phaseAt: move.at, log: [...s.log, { kind: 'system', text: 'game over' }] }
        }
        // A new round, said so — the pencil has been round everyone once more.
        const round = Math.floor(turn / s.order.length)
        const said = round > Math.floor(s.turn / s.order.length) ? [{ kind: 'system', text: `round ${round + 1} of ${s.rounds}` }] : []
        return startTurn({ ...s, turn, log: [...s.log, ...said] }, move.at)
      }
      default:
        return s
    }
  },

  /**
   * Giving up leaves the game with its points frozen and out of the
   * running. A drawer who gives up ends their round; with fewer than two
   * players left, the game ends.
   */
  forfeit(s, seat, { at }) {
    if (s.phase === 'waiting' || s.phase === 'over' || !playing(s).includes(seat)) return s
    const next = { ...s, out: [...s.out, seat], log: [...s.log, { kind: 'system', text: `seat:${seat} forfeited` }] }
    if (playing(next).length < 2) {
      return { ...next, phase: 'over', drawer: null, phaseAt: at, log: [...next.log, { kind: 'system', text: 'game over' }] }
    }
    const reveal = (why) => ({ ...next, phase: 'reveal', phaseAt: at, log: [...next.log, { kind: 'system', text: `${why} — the word was "${s.word ?? '…'}"` }] })
    if (seat === s.drawer && (s.phase === 'choosing' || s.phase === 'drawing')) return reveal('the drawer left')
    // The one guess still missing may have been theirs.
    if (s.phase === 'drawing' && playing(next).every((x) => x === s.drawer || next.guessed[x] != null)) return reveal('everyone left got it')
    return next
  },

  outcome(s, names) {
    if (s.phase !== 'over') return null
    const left = playing(s)
    const quitters = s.out.map((seat) => names[seat] ?? `player ${seat + 1}`)
    if (left.length < 2 && s.out.length) return { winners: left, reason: `${quitters.join(' & ')} forfeited` }
    const best = Math.max(...left.map((seat) => s.scores[seat] ?? 0))
    return { winners: left.filter((seat) => (s.scores[seat] ?? 0) === best), reason: `${best} points` }
  },

  /** Said to whoever reads it: the drawer is told they draw, guessers to guess. */
  status(s, names, { seat = null } = {}) {
    const name = (n) => names[n] ?? `player ${n + 1}`
    const playing = seat != null && s.order.includes(seat) && !s.out.includes(seat)
    switch (s.phase) {
      case 'waiting': return 'press start when everyone is seated'
      case 'choosing': return seat === s.drawer ? 'pick a word to draw' : `${name(s.drawer)} is choosing a word…`
      case 'drawing':
        if (seat === s.drawer) {
          // Named, and only those still at it: the line shortens as they get it.
          const guessing = s.order.filter((n) => n !== s.drawer && !s.out.includes(n) && s.guessed[n] == null).map(name)
          if (!guessing.length) return 'you\'re drawing'
          const list = guessing.length === 1 ? guessing[0] : `${guessing.slice(0, -1).join(', ')} and ${guessing.at(-1)}`
          return `you're drawing — ${list} ${guessing.length === 1 ? 'is' : 'are'} guessing`
        }
        if (playing && s.guessed[seat] != null) return 'you got it! — waiting for the others'
        if (playing) return `guess what ${name(s.drawer)} is drawing`
        return `${name(s.drawer)} is drawing`
      case 'reveal': return `the word was “${s.word ?? '…'}”`
      case 'over': {
        const result = rules.outcome(s, names)
        const who = result.winners.map(name)
        if (!who.length) return result.reason
        return `${who.join(' & ')} ${who.length > 1 ? 'win' : 'wins'} — ${result.reason}`
      }
      default: return ''
    }
  },
}

// ------------------------------------------------------------------- view

function view(el, ctx) {
  el.classList.add('draw-stage')
  el.innerHTML = `
    <div class="draw">
      <div class="draw-main">
        <div class="draw-paper" data-cursor-anchor="paper">
          <span class="draw-word" data-cursor-anchor="word"></span>
          <span class="draw-clock" data-cursor-anchor="clock"></span>
          <svg class="draw-canvas" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid meet">
            <rect width="1000" height="700" fill="${PAPER}"/>
            <g class="strokes"></g><g class="live"></g>
            <circle class="brush" r="4" fill="none" stroke="${INK}" stroke-width="2" visibility="hidden"/>
          </svg>
          <div class="draw-tools"></div>
          <div class="draw-overlay game-panel" data-cursor-anchor="overlay"></div>
        </div>
        <div class="draw-side">
          <div class="draw-scores scrolls" data-cursor-anchor="scores" data-cursor-clip></div>
          <div class="draw-log scrolls" data-cursor-anchor="log" data-cursor-clip></div>
          <form class="draw-guess" data-cursor-anchor="guess-box"><input class="input" maxlength="60" placeholder="your guess" aria-label="guess" data-cursor-anchor="guess"><button class="btn small sun" data-cursor-anchor="guess:send">guess</button></form>
        </div>
      </div>
    </div>`
  const $ = (sel) => el.querySelector(sel)
  const svg = $('.draw-canvas')
  const strokesG = $('.strokes')
  const liveG = $('.live')
  const overlay = $('.draw-overlay')
  const lobby = startPanel($('.draw-paper'), { onStart: () => ctx.intend({ type: 'start' }) })
  const tools = $('.draw-tools')
  const guessForm = $('.draw-guess')
  const guessInput = guessForm.querySelector('input')

  let state = null
  let info = {}
  let colour = COLOURS[0]
  let width = WIDTHS[1]
  let phaseSeenAt = 0
  let lastPhase = null

  const name = (seat) => info.names?.[seat] ?? `player ${seat + 1}`
  const iDraw = () => state?.phase === 'drawing' && info.mySeat === state.drawer

  // Tools: colours and an eraser, three brush sizes, and clear beside them.
  // What is chosen is always marked, from the start.
  const SIZES = ['thin', 'medium', 'thick']
  tools.innerHTML = '<span class="tool-group colours">' + COLOURS.map((c) => `<button class="swatch" data-colour="${c}" style="background:${c}" aria-label="colour"></button>`).join('')
    + '<span class="custom-anchor"><button class="swatch custom" data-colour="custom" aria-label="any colour" aria-expanded="false"></button><div class="draw-picker" hidden></div></span>'
    + '<button class="swatch eraser" data-colour="eraser" aria-label="eraser"></button></span>'
    // The sizes and clear keep together: if the bar wraps, they wrap as one.
    + '<span class="tool-group sizes"><span class="segmented widths">' + WIDTHS.map((w, i) => `<button class="btn small" data-width="${w}">${SIZES[i]}</button>`).join('') + '</span>'
    + `<button class="btn small arrow" data-undo disabled title="undo" aria-label="undo">${ARROW}</button>`
    + `<button class="btn small arrow" data-redo disabled title="redo" aria-label="redo"><span class="flip">${ARROW}</span></button>`
    + '<button class="btn small berry" data-clear>clear</button></span>'
  // Any colour at all: a swatch that opens the picker, from near black to near white.
  let custom = null
  const customButton = tools.querySelector('.swatch.custom')
  const picker = tools.querySelector('.draw-picker')
  const openPicker = (open) => {
    picker.hidden = !open
    customButton.setAttribute('aria-expanded', String(open))
    tools.classList.toggle('open', open)
    if (open) {
      picker.replaceChildren(colourPicker({
        value: custom ?? '#2fa4e6',
        presets: [],
        range: [0, 1],
        saturation: true,
        onPick: (c) => { custom = c; colour = c; markTools() },
      }))
    }
  }
  document.addEventListener('pointerdown', (e) => {
    if (!picker.hidden && !e.target.closest?.('.custom-anchor')) openPicker(false)
  })
  const markTools = () => {
    for (const t of tools.querySelectorAll('.swatch')) {
      const of = t.dataset.colour === 'eraser' ? PAPER : t.dataset.colour === 'custom' ? custom : t.dataset.colour
      t.classList.toggle('on', of === colour)
    }
    customButton.classList.toggle('picked', !!custom)
    if (custom) customButton.style.setProperty('--c', custom)
    for (const t of tools.querySelectorAll('[data-width]')) t.setAttribute('aria-pressed', String(Number(t.dataset.width) === width))
  }
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b || picker.contains(b)) return
    if (b.dataset.colour === 'custom') {
      if (custom) colour = custom
      openPicker(picker.hidden)
    } else if (b.dataset.colour) colour = b.dataset.colour === 'eraser' ? PAPER : b.dataset.colour
    if (b.dataset.width) width = Number(b.dataset.width)
    if ('clear' in b.dataset && state?.strokes.length) { remember(); ctx.intend({ type: 'clear' }) }
    if ('undo' in b.dataset) undo()
    if ('redo' in b.dataset) redo()
    markTools()
  })
  markTools()

  // Undo and redo, for the drawer only and only this turn: each stroke and
  // each clear is one step. The picture before every step is kept here, on
  // the drawer's side; everyone else just gets the picture it leads to.
  let past = []
  let future = []
  let historyOf = null // the turn the history belongs to
  const remember = () => { past.push(state.strokes); future = [] }
  const undo = () => { if (iDraw() && past.length) { future.push(state.strokes); ctx.intend({ type: 'picture', strokes: past.pop() }) } }
  const redo = () => { if (iDraw() && future.length) { past.push(state.strokes); ctx.intend({ type: 'picture', strokes: future.pop() }) } }
  // On a keyboard, Ctrl+Z and Ctrl+Shift+Z (⌘ on a Mac) do the same, while
  // the drawer's last press was on this game rather than somewhere else.
  let engaged = false
  const onPress = (e) => { engaged = el.contains(e.target) }
  const onKey = (e) => {
    if (!engaged || !iDraw() || !(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'z') return
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  }
  document.addEventListener('pointerdown', onPress, true)
  document.addEventListener('keydown', onKey)
  const markHistory = () => {
    const turn = state && state.phase === 'drawing' ? `${state.turn}:${state.drawer}` : null
    if (turn !== historyOf) { past = []; future = []; historyOf = turn }
    tools.querySelector('[data-undo]').disabled = !iDraw() || !past.length
    tools.querySelector('[data-redo]').disabled = !iDraw() || !future.length
  }

  // With a mouse, the brush's size follows the pointer over the paper.
  const brush = svg.querySelector('.brush')
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !iDraw()) { brush.setAttribute('visibility', 'hidden'); return }
    const [x, y] = point(e)
    Object.entries({ cx: x, cy: y, r: width / 2 + 1.5, visibility: 'visible' }).forEach(([k, v]) => brush.setAttribute(k, v))
  })
  svg.addEventListener('pointerleave', () => brush.setAttribute('visibility', 'hidden'))

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
    remember()
    current = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, c: colour, w: width, pts: point(e) }
    el.classList.add('stroking')
    openPicker(false)
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
  const end = () => { el.classList.remove('stroking'); if (current) { flush(); current = null; liveG.textContent = '' } }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)

  const pathOf = (pts) => {
    if (pts.length < 2) return ''
    pts = pts.map((n) => Math.round(Number(n) || 0))
    let d = `M${pts[0]} ${pts[1]}`
    if (pts.length === 2) d += `l0.1 0`
    for (let i = 2; i < pts.length; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`
    return d
  }
  // Checked again here: a move is only as trustworthy as the peer that made it.
  const strokeEl = (st) => `<path d="${pathOf(st.pts)}" fill="none" stroke="${strokeColour(st.c)}" stroke-width="${strokeWidth(st.w)}" stroke-linecap="round" stroke-linejoin="round"/>`
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
    if (b.dataset.pick) ctx.intend({ type: 'choose', word: state.choices[Number(b.dataset.pick)] })
  })

  // A clock in the corner, counting down from when this peer saw the
  // phase begin — machines' clocks disagree, arrival times do not much.
  // It ticks only while a phase is timed, and hurries in its last seconds.
  const clock = $('.draw-clock')
  let clockTimer = null
  // The last five seconds of a timed phase tick aloud.
  const ticks = countdown()
  const tickClock = () => {
    const total = state.phase === 'drawing' ? (state.drawMs ?? DRAW_MS) : state.phase === 'choosing' ? CHOOSE_MS : 0
    const ms = total - (Date.now() - phaseSeenAt)
    const left = Math.max(0, Math.ceil(ms / 1000))
    clock.textContent = total ? `${left}s` : ''
    clock.classList.toggle('hurry', !!total && left <= 10)
    ticks.update(total ? ms : null)
  }
  const keepClock = () => {
    const timed = state?.phase === 'drawing' || state?.phase === 'choosing'
    if (timed && !clockTimer) clockTimer = setInterval(tickClock, 250)
    if (!timed && clockTimer) { clearInterval(clockTimer); clockTimer = null }
    tickClock()
  }

  let heardGuesses = null // `${turn}:${how many got it}` as last seen, for the chime

  function render() {
    const s = state
    if (s.phase !== lastPhase) { phaseSeenAt = Date.now(); lastPhase = s.phase }
    // Someone guessed it: a bright chime, for everyone — once each, and not
    // for guesses made before this view first looked.
    const guesses = `${s.turn}:${Object.keys(s.guessed ?? {}).length}`
    const [turnWas, countWas] = (heardGuesses ?? '').split(':').map(Number)
    if (heardGuesses != null && turnWas === s.turn && Object.keys(s.guessed ?? {}).length > countWas) sound.play('correct', { from: el })
    heardGuesses = guesses
    el.classList.toggle('drawing', iDraw())

    // The word: the drawer sees it, guessers see blanks, and those who
    // guessed it — and everyone once it is revealed — see it again.
    const word = $('.draw-word')
    const know = info.mySeat === s.drawer || (info.mySeat != null && s.guessed[info.mySeat] != null) || s.phase === 'reveal'
    if (s.phase === 'drawing' || s.phase === 'reveal') {
      word.textContent = know ? s.word : masked(s.word, s.hints) // the blanks, and no count: let them count
    } else {
      word.textContent = ''
    }

    // Strokes are added as they come, and only the one being drawn is
    // redrawn — not the whole picture on every point.
    // An undo or redo can change the picture anywhere, so it is redrawn
    // whenever what is shown is no longer the start of what should be.
    const nodes = strokesG.children
    if (s.strokes.length < nodes.length || [...nodes].some((node, i) => node.dataset.id !== s.strokes[i].id)) strokesG.textContent = ''
    s.strokes.forEach((st, i) => {
      const node = nodes[i]
      const d = pathOf(st.pts)
      if (!node) {
        strokesG.insertAdjacentHTML('beforeend', strokeEl(st))
        strokesG.lastElementChild.dataset.id = st.id
      } else if (node.getAttribute('d') !== d) node.setAttribute('d', d)
    })
    markHistory()

    // Starting and playing again are the kit's lobby; choosing a word is ours.
    lobby.update({
      open: s.phase === 'waiting' || s.phase === 'over',
      seated: Object.keys(info.names ?? {}).length,
      min: 2,
      mine: info.mySeat != null,
      again: s.phase === 'over',
    })
    let over = ''
    if (s.phase === 'reveal') {
      // The word, big, and what everyone made of it this round.
      const got = Object.entries(s.guessed).sort((a, b) => a[1] - b[1])
      const lines = got.map(([seat, order]) => `<li data-cursor-anchor="reveal:${seat}"><span class="dot" style="background:${ctx.colours[seat]}"></span>${escape(name(Number(seat)))}<b>+${GUESS_POINTS[order] ?? 2}</b></li>`)
      if (got.length && s.drawer != null) lines.push(`<li data-cursor-anchor="reveal:${s.drawer}"><span class="dot" style="background:${ctx.colours[s.drawer]}"></span>${escape(name(s.drawer))} <i>drew it</i><b>+${got.length * DRAWER_POINTS}</b></li>`)
      over = `<div class="reveal"><p>the word was</p><strong data-cursor-anchor="reveal:word">${escape(s.word ?? '…')}</strong>${lines.length ? `<ul>${lines.join('')}</ul>` : '<p class="nobody">nobody got it</p>'}</div>`
    } else if (s.phase === 'choosing') {
      over = info.mySeat === s.drawer
        ? `<p data-cursor-anchor="overlay:prompt">pick a word to draw</p><div class="choices">${s.choices.map((w, i) => `<button class="btn grape" data-pick="${i}" data-cursor-anchor="pick:${i}">${escape(w)}${s.levels ? `<small>${s.levels[i]}</small>` : ''}</button>`).join('')}</div>`
        : `<p data-cursor-anchor="overlay:prompt">${name(s.drawer)} is choosing a word…</p>`
    }
    overlay.innerHTML = over
    overlay.hidden = !over

    $('.draw-scores').innerHTML = s.order.map((seat) => `
      <div data-cursor-anchor="score:${seat}" class="score ${seat === s.drawer ? 'drawer' : ''} ${s.guessed[seat] != null ? 'got' : ''} ${s.out.includes(seat) ? 'out' : ''}">
        <span class="dot" style="background:${ctx.colours[seat]}"></span>
        <span class="who">${escape(name(seat))}</span>${s.out.includes(seat) ? '<i>out</i>' : ''}<b>${s.scores[seat] ?? 0}</b>
      </div>`).join('')

    const log = $('.draw-log')
    // Lines are named by their place in the whole log, the same for everyone.
    const first = Math.max(0, s.log.length - 40)
    log.innerHTML = s.log.slice(-40).map((line, i) => {
      const at = `data-cursor-anchor="log:${first + i}"`
      const text = escape(line.text.replace(/seat:(\d)/g, (_, n) => name(Number(n))))
      if (line.kind === 'system') return `<div class="line system" ${at}>${text}</div>`
      const who = `<b style="color:${ctx.colours[line.seat]}">${escape(name(line.seat))}</b>`
      if (line.kind === 'correct') return `<div class="line correct" ${at}>${who} guessed it! ${text}</div>`
      if (line.kind === 'close') return `<div class="line close" ${at}>${who} ${text} <i>— so close!</i></div>`
      return `<div class="line" ${at}>${who} ${text}</div>`
    }).join('')
    log.scrollTop = log.scrollHeight

    const canGuess = s.phase === 'drawing' && info.mySeat != null && info.mySeat !== s.drawer && s.guessed[info.mySeat] == null
    guessInput.disabled = !canGuess
    guessForm.querySelector('button').disabled = !canGuess
    // The drawer cannot guess: the box says so, at full width.
    guessForm.querySelector('button').hidden = info.mySeat === s.drawer && s.phase === 'drawing'
    guessInput.placeholder = info.mySeat === s.drawer && s.phase === 'drawing' ? 'you are drawing'
      : canGuess ? 'your guess'
        : s.phase === 'drawing' && info.mySeat != null && s.guessed[info.mySeat] != null ? 'you got it!' : 'not now'
    tools.hidden = !iDraw()
    if (!iDraw()) brush.setAttribute('visibility', 'hidden')
    keepClock()
  }

  return {
    update(next, nextInfo) { state = next; info = nextInfo; render() },
    destroy() { clearInterval(clockTimer); clockTimer = null; document.removeEventListener('pointerdown', onPress, true); document.removeEventListener('keydown', onKey); el.textContent = '' },
  }
}

const ICON = `
  <rect x="5" y="7" width="40" height="32" rx="4" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
  <path d="M11 30 C 16 18, 22 34, 28 22" fill="none" stroke="#ff5d8f" stroke-width="3" stroke-linecap="round"/>
  <g transform="rotate(40 40 18)">
    <rect x="35" y="2" width="9" height="26" rx="2" fill="#ffd23f" stroke="${INK}" stroke-width="2.5"/>
    <path d="M35 28 L39.5 36 L44 28 Z" fill="${PAPER}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
  </g>`

// ------------------------------------------------------------------- game

export default defineGame({
  id: 'pictionary',
  styles: new URL('./style.css', import.meta.url),
  name: 'Pictionary',
  tone: 'berry',
  kind: 'authority',
  seats: { min: 2, max: 4 },
  pieces: 'players',
  // On a phone: the word bar, the paper at its own shape, the scores in a
  // row, a few lines of guesses, the guess box and the drawing tools.
  phoneHeight: (width) => width * 0.7 + 292,
  options: {
    words: { label: 'words', choices: { en: 'English', es: 'Español' }, default: 'en' },
    rounds: { label: 'rounds', choices: Object.fromEntries(ROUNDS.map((n) => [n, n])), default: '3' },
    time: { label: 'time', choices: Object.fromEntries(DRAW_TIMES.map((n) => [n, Number(n) < 120 ? `${n}s` : `${n / 60}m`])), default: '80' },
  },
  rules,
  view,
  icon: ICON,
})
