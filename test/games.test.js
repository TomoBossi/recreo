import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initial, fromFen, perft, play, isLegal } from '../games/chess-rules.js'
import connect4 from '../games/connect4.js'
import chess from '../games/chess.js'

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

import draw from '../games/draw.js'

/** Run intents through decide and apply, as an authority would. */
function act(s, intent, seat, ctx) {
  for (const move of draw.decide(s, intent, seat, ctx)) s = draw.apply(s, move)
  return s
}

test('a round of draw & guess, start to finish', () => {
  const ctx = { now: 1000, seated: [0, 1, 2], here: [0, 1, 2] }
  let s = draw.init({ seed: 42 })
  assert.equal(draw.authority(s, [1, 2]), 1, 'before a drawer, the first seat here runs it')
  s = act(s, { type: 'start' }, 2, ctx)
  assert.equal(s.phase, 'choosing')
  assert.equal(s.drawer, 0)
  assert.equal(draw.authority(s, [0, 1, 2]), 0, 'the drawer runs the round')
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
    s = draw.apply(s, draw.tick(s, { now: s.phaseAt + 6000, here: [0, 1, 2] })[0])
    assert.equal(s.phase, 'choosing')
    s = draw.apply(s, draw.tick(s, { now: s.phaseAt + 16000, here: [0, 1, 2] })[0]) // auto-pick
    s = draw.apply(s, draw.tick(s, { now: s.phaseAt + 81000, here: [0, 1, 2] })[0]) // time up
  }
  s = draw.apply(s, draw.tick(s, { now: s.phaseAt + 6000, here: [0, 1, 2] })[0])
  assert.equal(s.phase, 'over')
  assert.match(draw.status(s, { 0: 'ana', 1: 'tomo', 2: 'lu' }), /wins with/)
})

test('when the drawer leaves, the next player takes over and ends the round', () => {
  const ctx = { now: 0, seated: [0, 1, 2], here: [0, 1, 2] }
  let s = act(draw.init({ seed: 7 }), { type: 'start' }, 0, ctx)
  s = act(s, { type: 'choose', word: s.choices[0] }, 0, ctx)
  assert.equal(draw.authority(s, [1, 2]), 1)
  const moves = draw.tick(s, { now: 10, here: [1, 2] })
  assert.equal(moves[0].type, 'end')
  assert.equal(draw.apply(s, moves[0]).phase, 'reveal')
})

test('draw & guess picks the same words everywhere from the same seed', () => {
  const a = act(draw.init({ seed: 99 }), { type: 'start' }, 0, { now: 0, seated: [0, 1], here: [0, 1] })
  const b = act(draw.init({ seed: 99 }), { type: 'start' }, 0, { now: 0, seated: [0, 1], here: [0, 1] })
  assert.deepEqual(a.choices, b.choices)
})

import golf, { roll, clampShot } from '../games/golf.js'

test('minigolf physics is integer arithmetic, so every machine agrees', () => {
  const hole = { tee: [120, 300], cup: [870, 300], walls: [[400, 200, 40, 200]], water: [] }
  const a = roll(hole, [12000, 30000], [1400, 37])
  const b = roll(JSON.parse(JSON.stringify(hole)), [12000, 30000], [1400, 37])
  assert.deepEqual(a, b)
  for (const [x, y] of a.path) assert.ok(Number.isInteger(x) && Number.isInteger(y), 'a position was not an integer')
  assert.deepEqual(clampShot(3000, 4000), [840, 1120], 'clamped to the strongest shot, keeping direction')
})

test('a straight putt on the first hole drops, and the turn passes', () => {
  let s = golf.init()
  assert.equal(golf.turn(s), 'any')
  assert.ok(golf.legal(s, { type: 'start', order: [1, 0] }, 0))
  s = golf.apply(s, { type: 'start', order: [1, 0] }, 0)
  assert.equal(s.turn, 0)
  // Straight at the cup, firmly; it should sink within a stroke or two.
  for (let i = 0; i < 3 && !s.balls[0].done; i++) {
    const [x, y] = s.balls[0].pos
    s = golf.apply(s, { type: 'shot', dx: Math.trunc((87000 - x) / 60), dy: Math.trunc((30000 - y) / 60) }, 0)
    if (!s.balls[0].done) assert.equal(s.turn, 1, 'the other player is further away and goes next')
    if (!s.balls[0].done) s = golf.apply(s, { type: 'shot', dx: 10, dy: 0 }, 1)
  }
  assert.ok(s.balls[0].done && s.balls[0].strokes <= 3, `ball 0: ${JSON.stringify(s.balls[0])}`)
  assert.equal(golf.legal(s, { type: 'shot', dx: 100, dy: 0 }, 0), false, 'a holed ball does not putt again')
})
