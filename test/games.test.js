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
