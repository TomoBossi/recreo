/**
 * defineGame: the one function a game calls to describe itself.
 *
 * A game says what it is in its own terms — how many seats, which kind of
 * game it is, its rules, its picture — and gets back exactly what the room
 * needs to run it: tables, seats, spectators, keeping every peer in step,
 * bringing back whoever drops. Nothing about networking, ever.
 *
 *   export default defineGame({
 *     id: 'tictactoe', name: 'Tic-tac-toe', tone: 'tang', icon,
 *     kind: 'turns',
 *     seats: 2,
 *     pieces: ['#ff5d8f', '#2fa4e6'],
 *     rules: { init, turn, legal, apply, status },
 *     view,
 *     options: { ... },         // optional, see below
 *   })
 *
 * Two kinds of game:
 *
 *   'turns'      Every peer runs the whole game and applies every move. For
 *                anything where only one seat acts at a time — whoever's turn
 *                it is — or where actions commute. Rules: init, turn, legal,
 *                apply, status.
 *
 *   'authority'  One peer runs the game, turning everyone's intents into
 *                moves; everyone applies the moves. For games where
 *                simultaneous actions race. Rules: init, decide, apply,
 *                status, and optionally authority and tick. The role passes
 *                to the next player if the authority leaves.
 *
 * Options are choices made at the table before a game starts, next to the
 * seats, by anyone seated — a language, a board size:
 *
 *   options: {
 *     words: { label: 'words', choices: { en: 'English', es: 'Español' }, default: 'en' },
 *   }
 *
 * The rules get the chosen values as init({ seed, seats, options }), and an
 * authority game also as decide(…, { options }) and tick({ options }).
 * Options can be changed until the first move, unless the rules say
 * otherwise with optionsOpen(state) — a game that plays round after round
 * can open them between rounds, and must then read them in decide.
 *
 * Mistakes are caught here, when the game loads, with a message naming the
 * game and what is missing — not later, mid-match, as a desync.
 */

import { CAPACITY } from '../../app/limits.js'

const KINDS = {
  turns: { needs: ['init', 'turn', 'legal', 'apply', 'status'], mode: 'replicated' },
  authority: { needs: ['init', 'decide', 'apply', 'status'], mode: 'authoritative' },
}
const TONES = ['sun', 'berry', 'leaf', 'grape', 'tang', 'sky']

export function defineGame(spec) {
  const where = `game "${spec?.id ?? '?'}"`
  const fail = (what) => { throw new Error(`recreo: ${where}: ${what}`) }

  if (!spec || typeof spec !== 'object') fail('defineGame needs a description')
  if (!/^[a-z][a-z0-9-]*$/.test(spec.id ?? '')) fail('id must be lowercase letters, digits and dashes — it travels between peers')
  if (!spec.name) fail('needs a name')
  const kind = KINDS[spec.kind]
  if (!kind) fail(`kind must be one of ${Object.keys(KINDS).join(', ')}`)
  if (spec.tone && !TONES.includes(spec.tone)) fail(`tone must be one of ${TONES.join(', ')}`)

  const rules = spec.rules ?? fail('needs rules')
  for (const fn of kind.needs) {
    if (typeof rules[fn] !== 'function') fail(`a '${spec.kind}' game's rules need ${fn}()`)
  }

  const seats = typeof spec.seats === 'number' ? { min: spec.seats, max: spec.seats } : spec.seats
  if (!Number.isInteger(seats?.min) || !Number.isInteger(seats?.max) || seats.min < 1 || seats.max < seats.min || seats.max > CAPACITY) {
    fail(`seats must be a number, or { min, max }, from 1 to ${CAPACITY} — the most a room holds`)
  }

  const playerColours = spec.pieces === 'players'
  const pieces = playerColours ? DEFAULT_PIECES.slice(0, seats.max) : spec.pieces ?? DEFAULT_PIECES.slice(0, seats.max)
  if (pieces.length < seats.max) fail(`needs a piece colour for each of its ${seats.max} seats`)

  const options = Object.entries(spec.options ?? {}).map(([id, o]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`option "${id}" needs an id of lowercase letters, digits and dashes`)
    const choices = Object.entries(o?.choices ?? {}).map(([value, label]) => ({ value, label: String(label) }))
    if (choices.length < 2) fail(`option "${id}" needs at least two choices`)
    const fallback = o.default ?? choices[0].value
    if (!choices.some((c) => c.value === fallback)) fail(`option "${id}" defaults to "${fallback}", which is not one of its choices`)
    return { id, label: String(o.label ?? id), choices, default: fallback }
  })
  if (rules.optionsOpen && typeof rules.optionsOpen !== 'function') fail('optionsOpen must be a function of the state')

  const view = typeof spec.view === 'function' ? { mount: spec.view } : spec.view
  if (typeof view?.mount !== 'function') fail('needs a view: a function (el, ctx) returning { update, destroy }')

  return {
    id: spec.id,
    name: spec.name,
    tone: spec.tone ?? 'sun',
    icon: spec.icon ?? '',
    seats: seats.max,
    minSeats: seats.min,
    mode: kind.mode,
    seatColours: pieces,
    playerColours,
    // A game with a range of seats starts itself and offers its own "again";
    // a fixed two-seat game gets the room's rematch button.
    ownRestart: spec.restart === 'own' || (spec.restart !== 'rematch' && seats.min !== seats.max),

    init: rules.init,
    status: rules.status,
    apply: rules.apply,
    turn: rules.turn ?? (() => null),
    legal: rules.legal ?? (() => true),
    decide: rules.decide,
    tick: rules.tick,
    // By default the authority is the lowest seat still here.
    authority: rules.authority ?? ((state, here) => (here.length ? Math.min(...here) : null)),
    options,
    optionsOpen: rules.optionsOpen ?? null,
    view,
  }
}

/** Piece colours for games that do not choose their own. */
export const DEFAULT_PIECES = ['#ff5d8f', '#2fa4e6', '#ffd23f', '#5cbc3c']
