import { test, assert } from './harness.js'
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
  const ctx = { now: 1000, seated: [0, 1, 2], here: [0, 1, 2], options: { rounds: '1' } }
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
  // Strokes are drawn as markup: anything but a colour, a width and a short id is refused or tamed.
  assert.equal(act(s, { type: 'stroke', id: 'c', c: '"/><script>', w: 8, pts: [1, 1] }, 0, ctx).strokes.length, 1, 'not a colour: refused')
  const tamed = act(s, { type: 'stroke', id: 'd"x', c: '#2fa4e6', w: '9" onload="x', pts: [1, 2] }, 0, ctx).strokes.at(-1)
  assert.deepEqual([tamed.id, tamed.w], ['dx', 10])

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

test('pictionary plays the rounds chosen: everyone draws once a round, and each new round is said', () => {
  const ctx = { now: 0, seated: [0, 1, 2], here: [0, 1, 2], options: { rounds: '2' } }
  let s = act(pictionary.init({ seed: 3, options: { rounds: '2' } }), { type: 'start' }, 0, ctx)
  const drawers = []
  while (s.phase !== 'over') {
    drawers.push(s.drawer)
    s = pictionary.apply(s, pictionary.tick(s, { now: s.phaseAt + 16000, here: [0, 1, 2] })[0]) // auto-pick
    s = pictionary.apply(s, pictionary.tick(s, { now: s.phaseAt + 81000, here: [0, 1, 2] })[0]) // time up
    s = pictionary.apply(s, pictionary.tick(s, { now: s.phaseAt + 6000, here: [0, 1, 2] })[0]) // next
    if (drawers.length > 10) break
  }
  assert.deepEqual(drawers, [0, 1, 2, 0, 1, 2])
  assert.ok(s.log.some((l) => l.text === 'round 2 of 2'))
  assert.equal(pictionary.init({ seed: 1 }).rounds, 3, 'three rounds unless chosen otherwise')
})

test('pictionary gives the drawer the time chosen, and the clock ends the turn then', () => {
  const ctx = { now: 0, seated: [0, 1], here: [0, 1], options: { time: '45' } }
  let s = act(pictionary.init({ seed: 5 }), { type: 'start' }, 0, ctx)
  s = act(s, { type: 'choose', word: s.choices[0] }, 0, ctx)
  assert.equal(s.drawMs, 45000)
  assert.deepEqual(pictionary.tick(s, { now: s.phaseAt + 44000, here: [0, 1] }).filter((m) => m.type === 'end'), [], 'not yet')
  assert.equal(pictionary.tick(s, { now: s.phaseAt + 46000, here: [0, 1] })[0].type, 'end', 'time is up at 45s')
  assert.equal(pictionary.init({ seed: 1 }).drawMs, 80000, 'eighty seconds unless chosen otherwise')
})

test('when the drawer leaves, the next player takes over and ends the round once they stay gone', () => {
  const ctx = { now: 0, seated: [0, 1, 2], here: [0, 1, 2] }
  let s = act(pictionary.init({ seed: 7 }), { type: 'start' }, 0, ctx)
  s = act(s, { type: 'choose', word: s.choices[0] }, 0, ctx)
  assert.equal(pictionary.authority(s, [1, 2]), 1)
  let moves = pictionary.tick(s, { now: 10, here: [1, 2] })
  assert.equal(moves[0].type, 'away')
  s = pictionary.apply(s, moves[0])
  assert.deepEqual(pictionary.tick(s, { now: 5000, here: [1, 2] }), [])
  moves = pictionary.tick(s, { now: 25000, here: [1, 2] })
  assert.equal(moves[0].type, 'end')
  assert.equal(pictionary.apply(s, moves[0]).phase, 'reveal')
})

test('a drawer who drops out and comes back keeps drawing, picture and all', () => {
  const ctx = { now: 0, seated: [0, 1], here: [0, 1] }
  let s = act(pictionary.init({ seed: 7 }), { type: 'start' }, 0, ctx)
  s = act(s, { type: 'choose', word: s.choices[0] }, 0, ctx)
  s = act(s, { type: 'stroke', id: 'a1', c: '#123456', w: 10, pts: [1, 2, 3, 4] }, s.drawer, ctx)
  s = pictionary.apply(s, pictionary.tick(s, { now: 10, here: [1 - s.drawer] })[0])
  const moves = pictionary.tick(s, { now: 3000, here: [0, 1] })
  assert.equal(moves[0].type, 'back')
  s = pictionary.apply(s, moves[0])
  assert.equal(s.phase, 'drawing')
  assert.equal(s.strokes.length, 1)
})

test('undo and redo send the whole picture, from the drawer only', () => {
  const ctx = { now: 0, seated: [0, 1], here: [0, 1] }
  let s = act(pictionary.init({ seed: 7 }), { type: 'start' }, 0, ctx)
  s = act(s, { type: 'choose', word: s.choices[0] }, 0, ctx)
  const one = { id: 'a1', c: '#123456', w: 10, pts: [1, 2, 3, 4] }
  s = act(s, { type: 'stroke', ...one }, s.drawer, ctx)
  s = act(s, { type: 'stroke', id: 'b2', c: '#654321', w: 10, pts: [5, 6] }, s.drawer, ctx)
  assert.deepEqual(pictionary.decide(s, { type: 'picture', strokes: [one] }, 1 - s.drawer, ctx), [])
  s = act(s, { type: 'picture', strokes: [one] }, s.drawer, ctx)
  assert.deepEqual(s.strokes, [one])
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

test('minigolf turns: everyone tees off in seat order, then the ball furthest away; a holed ball is done', () => {
  let s = minigolf.init()
  assert.equal(minigolf.turn(s), 'any')
  assert.ok(minigolf.legal(s, { type: 'start', order: [1, 0] }, 0))
  s = minigolf.apply(s, { type: 'start', order: [1, 0] }, 0)
  assert.equal(s.turn, 0)
  s = minigolf.apply(s, { type: 'shot', dx: 200, dy: 120, phase: 0 }, 0) // a soft one, up and away
  assert.equal(s.turn, 1, 'the player who has not putted yet goes next')
  s = minigolf.apply(s, { type: 'shot', dx: 500, dy: -260, phase: 0 }, 1)
  const away = (seat) => Math.hypot(s.balls[seat].pos[0] - 86000, s.balls[seat].pos[1] - 30000)
  assert.equal(s.turn, away(0) > away(1) ? 0 : 1, 'then whoever is furthest from the cup')
  // Put seat 0 beside the cup and tap it in.
  s = { ...s, turn: 0, balls: { ...s.balls, 0: { pos: [83000, 30000], strokes: 2, done: false } } }
  s = minigolf.apply(s, { type: 'shot', dx: 300, dy: 0, phase: 0 }, 0)
  assert.deepEqual(s.balls[0], { pos: [86000, 30000], strokes: 3, done: true })
  assert.equal(s.turn, 1)
  assert.equal(minigolf.legal({ ...s, turn: 0 }, { type: 'shot', dx: 100, dy: 0 }, 0) && !s.balls[0].done, false, 'a holed ball does not putt again')
  assert.equal(minigolf.legal(s, { type: 'shot', dx: 100, dy: 0, phase: -1 }, 1), false, 'the windmill turn is a count')
})

test('minigolf: three holes at random are the same three on every machine, in course order', () => {
  const a = minigolf.apply(minigolf.init({ seed: 7, options: { holes: 'three' } }), { type: 'start', order: [0] }, 0)
  const b = minigolf.apply(minigolf.init({ seed: 7, options: { holes: 'three' } }), { type: 'start', order: [0] }, 0)
  assert.deepEqual(a.course, b.course)
  assert.equal(a.course.length, 3)
  assert.deepEqual([...a.course].sort((x, y) => x - y), a.course)
  assert.equal(a.cards.length, 3)
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

test('the cup takes a ball that is slow and true, and lips out a fast one', () => {
  const hole = { tee: [120, 300], cup: [870, 300], walls: [], water: [] }
  assert.ok(roll(hole, [72000, 30000], [470, 0]).sunk, 'a firm putt straight at it drops')
  assert.ok(roll(hole, [72000, 31100], [470, 0]).sunk, 'eleven off centre still drops')
  assert.ok(roll(hole, [72000, 31400], [440, 0]).sunk, 'fourteen off centre, slowly, the cup draws it in')
  assert.ok(!roll(hole, [72000, 32600], [470, 0]).sunk, 'twenty-six off centre rolls past the edge')
  const fast = roll(hole, [72000, 30000], [800, 0])
  assert.ok(!fast.sunk && fast.end[0] > 87000, 'too fast, it runs over the cup and on')
})

test('a ball driven straight into a wall bounces back off it, and never ends inside one', () => {
  const hole = { tee: [120, 300], cup: [100, 100] }
  const r = roll(hole, [90000, 30000], [1400, 0])
  assert.ok(Math.max(...r.path.map(([x]) => x)) <= (1000 - 24 - 11) * 100, 'it reached into the frame')
  assert.ok(r.end[0] < 90000, 'it came back')
  const again = roll(hole, r.end, [-300, 0])
  assert.ok(again.end[0] < r.end[0], 'and it moves when struck again')
})

test('a rolling ball slows steadily: twice the speed, about four times the distance', () => {
  const hole = { tee: [0, 0], cup: [-100, -100], walls: [], water: [] }
  const far = (v) => roll(hole, [5000, 30000], [v, 0]).end[0] - 5000
  const ratio = far(600) / far(300)
  assert.ok(ratio > 3.2 && ratio < 4.4, `ratio ${ratio}`)
})

test('chess clocks: time and increment count once both sides have moved, and running out loses', () => {
  let s = chess.init({ options: { time: '1m', increment: '+2' } })
  assert.deepEqual(s.clock.left, [60000, 60000])
  const go = (from, to, spent, seat) => { assert.ok(chess.legal(s, { from, to, spent }, seat), `${from}-${to}`); s = chess.apply(s, { from, to, spent }, seat) }
  go(12, 28, 9000, 0) // e4: first moves are free
  go(52, 36, 9000, 1) // e5
  assert.deepEqual(s.clock.left, [60000, 60000], 'the first moves are free')
  go(6, 21, 5000, 0) // Nf3: 5s thought, 2s back
  assert.equal(s.clock.left[0], 57000)
  assert.equal(chess.legal(s, { from: 57, to: 42 }, 1), false, 'with a clock, a move must say how long it took')
  go(57, 42, 70000, 1) // Nc6, far too slowly
  assert.deepEqual(chess.outcome(s, { 0: 'ana', 1: 'tomo' }), { winners: [0], reason: 'tomo ran out of time' })
})

test('chess: running out against a lone king is a draw, and no clock means no timing at all', () => {
  const none = chess.init({ options: { time: 'none', increment: '+0' } })
  assert.equal(none.clock, null)
  assert.ok(chess.legal(none, { from: 12, to: 28 }, 0), 'no time needed without a clock')
  const bare = { ...chess.init({ options: { time: '1m' } }), board: Array(64).fill(null) }
  bare.board[4] = 'wK'; bare.board[60] = 'bK'; bare.board[0] = 'wR'
  bare.clock.moves = 4
  const after = chess.apply({ ...bare, turn: 'w' }, { timeout: true }, 0)
  assert.equal(chess.outcome(after, {}).draw, true, 'black, with a bare king, could never have mated')
})
