import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initial, fromFen, perft, play, isLegal } from '../games/chess/rules.js'
import connect4 from '../games/connect4/index.js'
import chess from '../games/chess/index.js'

/**
 * Rules must agree on every machine, so they are checked here without a
 * browser. Perft counts every position reachable to a depth and compares
 * with published figures: any mistake in move generation — castling through
 * check, en passant, promotion — changes a number.
 */
test('chess move generation matches the published perft counts', () => {
  assert.deepEqual([1, 2, 3].map((d) => perft(initial(), d)), [20, 400, 8902])
  const kiwipete = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
  assert.deepEqual([1, 2, 3].map((d) => perft(kiwipete, d)), [48, 2039, 97862])
  const promos = fromFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8')
  assert.deepEqual([1, 2].map((d) => perft(promos, d)), [44, 1486])
})

test("fool's mate ends the game for black", () => {
  let s = initial()
  for (const [from, to] of [[13, 21], [52, 36], [14, 30], [59, 31]]) {
    assert.ok(isLegal(s, { from, to }), `illegal ${from}-${to}`)
    s = play(s, { from, to })
  }
  assert.deepEqual(s.result, { winner: 'b' })
  assert.equal(chess.turn(s), null)
  assert.match(chess.status(s, { 0: 'ana', 1: 'tomo' }), /tomo wins/)
})

test('a stalemate is a draw, not a win', () => {
  // Black to move, not in check, and no legal move.
  const s = play(fromFen('7k/8/6Q1/8/8/8/8/K7 w - - 0 1'), { from: 46, to: 53 })
  assert.deepEqual(s.result, { draw: 'stalemate' })
})

test('chess states survive a trip through JSON', () => {
  // A late arrival is sent moves, but tables are merged as JSON too.
  let s = initial()
  s = play(s, { from: 12, to: 28 })
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
})

test('connect four never mutates the state it is given', () => {
  const s = connect4.init()
  const before = JSON.stringify(s)
  connect4.apply(s, { col: 3 }, 0)
  assert.equal(JSON.stringify(s), before)
})

test('connect four refuses a full column and the wrong seat', () => {
  let s = connect4.init()
  for (let i = 0; i < 6; i++) s = connect4.apply(s, { col: 0 }, i % 2)
  assert.equal(connect4.legal(s, { col: 0 }, s.turn), false)
  assert.equal(connect4.legal(s, { col: 1 }, 1 - s.turn), false)
})

import pictionary from '../games/pictionary/index.js'

/** Run intents through decide and apply, as an authority would. */
function act(s, intent, seat, ctx) {
  for (const move of pictionary.decide(s, intent, seat, ctx)) s = pictionary.apply(s, move)
  return s
}

test('a round of pictionary, start to finish', () => {
  const ctx = { now: 1000, seated: [0, 1, 2], here: [0, 1, 2] }
  let s = pictionary.init({ seed: 42 })
  assert.equal(pictionary.authority(s, [1, 2]), 1, 'before a drawer, the first seat here runs it')
  s = act(s, { type: 'start' }, 2, ctx)
  assert.equal(s.phase, 'choosing')
  assert.equal(s.drawer, 0)
  assert.equal(pictionary.authority(s, [0, 1, 2]), 0, 'the drawer runs the round')
  assert.equal(s.choices.length, 3)

  // Only the drawer chooses, and only from the choices.
  assert.equal(act(s, { type: 'choose', word: s.choices[0] }, 1, ctx).phase, 'choosing')
  assert.equal(act(s, { type: 'choose', word: 'nonsense' }, 0, ctx).phase, 'choosing')
  const word = s.choices[1]
  s = act(s, { type: 'choose', word }, 0, ctx)
  assert.equal(s.phase, 'drawing')

  s = act(s, { type: 'stroke', id: 'a', c: '#000', w: 8, pts: [1, 2, 3, 4] }, 0, ctx)
  s = act(s, { type: 'stroke', id: 'a', c: '#000', w: 8, pts: [5, 6] }, 0, ctx)
  assert.deepEqual(s.strokes[0].pts, [1, 2, 3, 4, 5, 6], 'a stroke continues across batches')
  assert.equal(act(s, { type: 'stroke', id: 'b', c: '#000', w: 8, pts: [1, 1] }, 1, ctx).strokes.length, 1, 'a guesser cannot draw')

  s = act(s, { type: 'guess', text: 'definitely not it' }, 1, ctx)
  assert.equal(s.log.at(-1).kind, 'guess')
  s = act(s, { type: 'guess', text: word.slice(0, -1) }, 1, ctx)
  assert.equal(s.log.at(-1).kind, 'close', 'one letter off is close')
  s = act(s, { type: 'guess', text: ` ${word.toUpperCase()} ` }, 2, ctx)
  assert.equal(s.scores[2], 10)
  assert.equal(s.scores[0], 3)
  assert.equal(act(s, { type: 'guess', text: word }, 2, ctx).scores[2], 10, 'nobody scores twice')
  s = act(s, { type: 'guess', text: word }, 1, ctx)
  assert.equal(s.phase, 'reveal', 'everyone guessing ends the round')
  assert.equal(s.scores[1], 8)

  // The clock moves things on; three drawers, then it is over.
  for (let i = 0; i < 2; i++) {
    s = pictionary.apply(s, pictionary.tick(s, { now: s.phaseAt + 6000, here: [0, 1, 2] })[0])
    assert.equal(s.phase, 'choosing')
    s = pictionary.apply(s, pictionary.tick(s, { now: s.phaseAt + 16000, here: [0, 1, 2] })[0]) // auto-pick
    s = pictionary.apply(s, pictionary.tick(s, { now: s.phaseAt + 81000, here: [0, 1, 2] })[0]) // time up
  }
  s = pictionary.apply(s, pictionary.tick(s, { now: s.phaseAt + 6000, here: [0, 1, 2] })[0])
  assert.equal(s.phase, 'over')
  assert.match(pictionary.status(s, { 0: 'ana', 1: 'tomo', 2: 'lu' }), /wins — \d+ points/)
})

test('when the drawer leaves, the next player takes over and ends the round', () => {
  const ctx = { now: 0, seated: [0, 1, 2], here: [0, 1, 2] }
  let s = act(pictionary.init({ seed: 7 }), { type: 'start' }, 0, ctx)
  s = act(s, { type: 'choose', word: s.choices[0] }, 0, ctx)
  assert.equal(pictionary.authority(s, [1, 2]), 1)
  const moves = pictionary.tick(s, { now: 10, here: [1, 2] })
  assert.equal(moves[0].type, 'end')
  assert.equal(pictionary.apply(s, moves[0]).phase, 'reveal')
})

test('pictionary picks the same words everywhere from the same seed', () => {
  const a = act(pictionary.init({ seed: 99 }), { type: 'start' }, 0, { now: 0, seated: [0, 1], here: [0, 1] })
  const b = act(pictionary.init({ seed: 99 }), { type: 'start' }, 0, { now: 0, seated: [0, 1], here: [0, 1] })
  assert.deepEqual(a.choices, b.choices)
})

import minigolf from '../games/minigolf/index.js'
import { roll, clampShot } from '../games/minigolf/physics.js'

test('minigolf physics is integer arithmetic, so every machine agrees', () => {
  const hole = { tee: [120, 300], cup: [870, 300], walls: [[400, 200, 40, 200]], water: [] }
  const a = roll(hole, [12000, 30000], [1400, 37])
  const b = roll(JSON.parse(JSON.stringify(hole)), [12000, 30000], [1400, 37])
  assert.deepEqual(a, b)
  for (const [x, y] of a.path) assert.ok(Number.isInteger(x) && Number.isInteger(y), 'a position was not an integer')
  assert.deepEqual(clampShot(3000, 4000), [840, 1120], 'clamped to the strongest shot, keeping direction')
})

test('a straight putt on the first hole drops, and the turn passes', () => {
  let s = minigolf.init()
  assert.equal(minigolf.turn(s), 'any')
  assert.ok(minigolf.legal(s, { type: 'start', order: [1, 0] }, 0))
  s = minigolf.apply(s, { type: 'start', order: [1, 0] }, 0)
  assert.equal(s.turn, 0)
  // Straight at the cup, firmly; it should sink within a stroke or two.
  for (let i = 0; i < 3 && !s.balls[0].done; i++) {
    const [x, y] = s.balls[0].pos
    s = minigolf.apply(s, { type: 'shot', dx: Math.trunc((87000 - x) / 60), dy: Math.trunc((30000 - y) / 60) }, 0)
    if (!s.balls[0].done) assert.equal(s.turn, 1, 'the other player is further away and goes next')
    if (!s.balls[0].done) s = minigolf.apply(s, { type: 'shot', dx: 10, dy: 0 }, 1)
  }
  assert.ok(s.balls[0].done && s.balls[0].strokes <= 3, `ball 0: ${JSON.stringify(s.balls[0])}`)
  assert.equal(minigolf.legal(s, { type: 'shot', dx: 100, dy: 0 }, 0), false, 'a holed ball does not putt again')
})

import english from '../games/pictionary/words/en.js'
import spanish from '../games/pictionary/words/es.js'
import { masked } from '../games/pictionary/index.js'

const startIn = (language, seed = 5) => {
  const ctx = { now: 0, seated: [0, 1], here: [0, 1], options: { words: language } }
  let s = pictionary.init({ seed, options: { words: language } })
  for (const move of pictionary.decide(s, { type: 'start' }, 0, ctx)) s = pictionary.apply(s, move)
  return s
}

test('pictionary offers an easy, a medium and a hard English word', () => {
  const s = startIn('en')
  assert.deepEqual(s.levels, ['easy', 'medium', 'hard'])
  s.choices.forEach((word, i) => assert.ok(english[i].includes(word), `${word} is ${s.levels[i]}`))
})

test('pictionary in Spanish draws from the Spanish words, and keeps them for play again', () => {
  let s = startIn('es')
  assert.equal(s.language, 'es')
  assert.equal(s.levels, null)
  for (const word of s.choices) assert.ok(spanish[0].includes(word), word)
  // The language is fixed for the game: a start without one keeps it.
  s = pictionary.apply({ ...s, phase: 'over' }, { type: 'start', order: [0, 1], at: 1 })
  for (const word of s.choices) assert.ok(spanish[0].includes(word), word)
  assert.ok(pictionary.optionsOpen({ phase: 'over' }) && !pictionary.optionsOpen(s))
})

test('hints fill in letters over the round, the same everywhere, never the whole word', () => {
  let s = startIn('en')
  s = pictionary.apply(s, { type: 'choose', word: 'fire hydrant', at: 0 })
  const here = [0, 1]
  for (let t = 0; t <= 80000; t += 400) {
    for (const move of pictionary.tick(s, { now: t, here }) ?? []) if (move.type === 'hint') s = pictionary.apply(s, move)
  }
  assert.equal(s.hints.length, 4, 'two in five of eleven letters')
  assert.ok(s.hints.every((i) => 'fire hydrant'[i] !== ' '))
  assert.equal(masked('fire hydrant', []), '_ _ _ _   _ _ _ _ _ _ _')
  assert.equal(masked('día', [1]), '_ í _')
  assert.equal(pictionary.tick({ ...s, phaseAt: 0, hints: [] }, { now: 1000, here }).length, 0, 'none in the first moments')
})

test('a guess matches ignoring case, accents, spacing and dashes', () => {
  let s = startIn('es')
  s = pictionary.apply(s, { type: 'choose', word: 'T-rex', at: 0 })
  s = pictionary.apply(s, { type: 'guess', seat: 1, text: 't rex', at: 1 })
  assert.equal(s.guessed[1], 0)
})

// ---------------------------------------------------------------- endings

import tictactoe from '../games/tictactoe/index.js'

const names = { 0: 'ana', 1: 'tomo', 2: 'lu', 3: 'kim' }

test('in a duel, forfeiting hands the game over, and only while it is on', () => {
  for (const game of [connect4, chess, tictactoe]) {
    const s = game.init({ seed: 1 })
    assert.equal(game.outcome(s, names), null, game.id)
    const after = game.forfeit(s, 0, { at: 1 })
    const result = game.outcome(after, names)
    assert.deepEqual(result.winners, [1], game.id)
    assert.match(result.reason, /ana (forfeited|resigned)/, game.id)
    assert.equal(game.turn(after), null, `${game.id}: nobody moves after`)
    assert.equal(game.forfeit(after, 1, { at: 2 }), after, `${game.id}: a finished game stays finished`)
  }
})

test('connect four and chess say how a game was won', () => {
  let s = connect4.init()
  for (const col of [0, 1, 0, 1, 0, 1, 0]) s = connect4.apply(s, { col }, connect4.turn(s))
  assert.deepEqual(connect4.outcome(s, names), { winners: [0], reason: 'four in a row' })
  let c = chess.init()
  for (const m of [[13, 21], [52, 36], [14, 30], [59, 31]]) c = chess.apply(c, { from: m[0], to: m[1] })
  assert.deepEqual(chess.outcome(c, names), { winners: [1], reason: 'checkmate' })
})

test('minigolf: a forfeiter leaves the course with a frozen card, and the rest play on', () => {
  let s = minigolf.apply(minigolf.init(), { type: 'start', order: [0, 1, 2] }, 0)
  const first = s.turn
  s = minigolf.forfeit(s, first, { at: 1 })
  assert.ok(s.out.includes(first) && s.phase === 'playing')
  assert.notEqual(s.turn, first, 'the turn moves on')
  assert.equal(minigolf.legal(s, { type: 'shot', dx: 10, dy: 0 }, first), false)
  // A second forfeit leaves one player, who wins there and then.
  const other = [0, 1, 2].find((x) => x !== first && x !== s.turn)
  s = minigolf.forfeit(s, other, { at: 2 })
  const result = minigolf.outcome(s, names)
  assert.equal(s.phase, 'over')
  assert.equal(result.winners.length, 1)
  assert.match(result.reason, /forfeited/)
})

test('minigolf alone: giving up ends the round with nobody winning', () => {
  let s = minigolf.apply(minigolf.init(), { type: 'start', order: [2] }, 2)
  s = minigolf.forfeit(s, 2, { at: 1 })
  assert.deepEqual(minigolf.outcome(s, names), { winners: [], reason: 'gave up the round' })
})

test('pictionary: a drawer who forfeits ends the round, keeps their points, and is skipped', () => {
  const ctx = { now: 0, seated: [0, 1, 2], here: [0, 1, 2], options: { words: 'en' } }
  let s = pictionary.init({ seed: 3, options: { words: 'en' } })
  for (const move of pictionary.decide(s, { type: 'start' }, 0, ctx)) s = pictionary.apply(s, move)
  s = pictionary.apply(s, { type: 'choose', word: s.choices[0], at: 0 })
  s = pictionary.apply(s, { type: 'guess', seat: 1, text: s.word, at: 1 })
  const drawerPoints = s.scores[0]
  s = pictionary.forfeit(s, 0, { at: 2 })
  assert.equal(s.phase, 'reveal')
  assert.equal(s.scores[0], drawerPoints, 'points frozen')
  assert.deepEqual(pictionary.decide(s, { type: 'guess', text: 'x' }, 0, ctx), [], 'no more guesses')
  s = pictionary.apply(s, { type: 'next', at: 3 })
  assert.equal(s.drawer, 1)
  s = pictionary.forfeit(s, 2, { at: 4 })
  const result = pictionary.outcome(s, names)
  assert.equal(s.phase, 'over')
  assert.deepEqual(result.winners, [1], 'the forfeiter with more points still cannot win')
})
