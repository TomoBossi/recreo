import { test, assert } from './harness.js'
import { defineGame } from '../games/kit/define.js'
import { games } from '../games/index.js'
import { CAPACITY } from '../app/limits.js'
import tictactoe from '../games/tictactoe/index.js'

const noop = () => {}
const turns = { init: () => ({}), turn: () => null, legal: () => true, apply: (s) => s, status: () => '', outcome: () => null, forfeit: (s) => s }
const authority = { init: () => ({}), decide: () => [], apply: (s) => s, status: () => '', outcome: () => null, forfeit: (s) => s }
const spec = (over) => ({ id: 'x', name: 'X', kind: 'turns', seats: 2, rules: turns, view: noop, ...over })

test('every game folder is registered, under its folder name', async () => {
  // Each registered game lives in the folder named after it.
  for (const game of Object.values(games)) assert.ok(game.styles?.includes(`/games/${game.id}/`), `${game.id} lives in games/${game.id}/`)
  // And no folder is left out: read from the directory listing the
  // development server gives (tools/serve.py). A host without listings
  // skips this half.
  const listing = await fetch(new URL('../games/', import.meta.url)).then((r) => (r.ok ? r.text() : '')).catch(() => '')
  const folders = [...listing.matchAll(/href="([a-z0-9-]+)\/"/g)].map((m) => m[1]).filter((f) => f !== 'kit')
  if (folders.length) assert.deepEqual(Object.keys(games).sort(), folders.sort())
})

test('every registered game is a defineGame result within the room capacity', () => {
  for (const game of Object.values(games)) {
    assert.ok(['replicated', 'authoritative'].includes(game.mode), game.id)
    assert.ok(game.minSeats >= 1 && game.seats <= CAPACITY && game.minSeats <= game.seats, game.id)
    assert.equal(game.seatColours.length >= game.seats, true, game.id)
    assert.equal(typeof game.view.mount, 'function', game.id)
    assert.ok(game.icon.includes('<'), `${game.id} has an icon`)
    // A starting state is plain JSON, so a late arrival can be sent it.
    const s = game.init({ seed: 42, seats: game.seats })
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s, game.id)
  }
})

test('seats go from 1 up to the room capacity, and no further', () => {
  assert.equal(defineGame(spec({ seats: 1 })).seats, 1)
  const range = defineGame(spec({ seats: { min: 1, max: CAPACITY } }))
  assert.equal(range.minSeats, 1)
  assert.equal(range.seats, CAPACITY)
  assert.throws(() => defineGame(spec({ seats: CAPACITY + 1 })), /seats/)
  assert.throws(() => defineGame(spec({ seats: 0 })), /seats/)
  assert.throws(() => defineGame(spec({ seats: { min: 3, max: 2 } })), /seats/)
})

test('defineGame names what is missing, for each kind', () => {
  assert.throws(() => defineGame(spec({ rules: { ...turns, legal: undefined } })), /x.*legal\(\)/)
  assert.throws(() => defineGame(spec({ kind: 'authority', rules: { ...authority, decide: undefined } })), /decide\(\)/)
  assert.throws(() => defineGame(spec({ rules: { ...turns, outcome: undefined } })), /outcome\(\)/)
  assert.throws(() => defineGame(spec({ kind: 'authority', rules: { ...authority, forfeit: undefined } })), /forfeit\(\)/)
  assert.throws(() => defineGame(spec({ kind: 'magic' })), /kind/)
  assert.throws(() => defineGame(spec({ id: 'Bad Id' })), /id/)
  assert.throws(() => defineGame(spec({ view: undefined })), /view/)
  assert.throws(() => defineGame(spec({ seats: 3, pieces: ['#000', '#fff'] })), /colour/)
  assert.equal(defineGame(spec({ kind: 'authority', rules: authority })).mode, 'authoritative')
})

test('a range of seats gets its own start and play again; a fixed pair gets the rematch button', () => {
  assert.equal(defineGame(spec({ seats: { min: 1, max: 4 }, pieces: 'players' })).ownRestart, true)
  assert.equal(defineGame(spec({ seats: 2 })).ownRestart, false)
  assert.equal(defineGame(spec({ seats: { min: 2, max: 4 }, restart: 'rematch' })).ownRestart, false)
})

test('tic-tac-toe: a win along the diagonal, and the wrong seat refused', () => {
  let s = tictactoe.init({ seed: 1 })
  for (const [cell, seat] of [[0, 0], [1, 1], [4, 0], [2, 1]]) {
    assert.ok(tictactoe.legal(s, { cell }, seat))
    s = tictactoe.apply(s, { cell }, seat)
  }
  assert.equal(tictactoe.legal(s, { cell: 8 }, 1), false, 'not their turn')
  assert.equal(tictactoe.legal(s, { cell: 4 }, 0), false, 'taken')
  s = tictactoe.apply(s, { cell: 8 }, 0)
  assert.equal(s.winner, 0)
  assert.deepEqual(s.line, [0, 4, 8])
  assert.equal(tictactoe.turn(s), null)
})

test('options: choices with a default, checked when the game loads', () => {
  const game = defineGame(spec({ options: { size: { label: 'board', choices: { s: 'small', l: 'large' }, default: 'l' } } }))
  assert.deepEqual(game.options, [{ id: 'size', label: 'board', choices: [{ value: 's', label: 'small' }, { value: 'l', label: 'large' }], default: 'l' }])
  assert.equal(defineGame(spec()).options.length, 0)
  assert.throws(() => defineGame(spec({ options: { size: { choices: { s: 'small' } } } })), /two choices/)
  assert.throws(() => defineGame(spec({ options: { size: { choices: { s: 'a', l: 'b' }, default: 'x' } } })), /not one of its choices/)
  assert.throws(() => defineGame(spec({ options: { Size: { choices: { s: 'a', l: 'b' } } } })), /option "Size"/)
})

import { bandColour, oklch } from '../games/kit/colours.js'

test('every colour on the custom pad is already inside the readable band', () => {
  for (let hue = 0; hue < 360; hue += 5) {
    for (const L of [0, 0.62, 0.68, 0.74, 1]) {
      const c = oklch(bandColour(hue, L))
      assert.ok(c.L > 0.615 && c.L < 0.745, `lightness ${c.L} at hue ${hue}`)
      assert.ok(c.C > 0.08, `chroma ${c.C} at hue ${hue}: not a grey`)
    }
  }
})

import { sound, countdown } from '../games/kit/sound.js'

test('a clock ticks its last five seconds, once each, and starts over when wound back up', () => {
  const heard = []
  const play = sound.play
  sound.play = (name) => heard.push(name)
  try {
    const ticks = countdown()
    for (let ms = 9000; ms > 0; ms -= 100) ticks.update(ms)
    assert.deepEqual(heard, ['tick', 'tock', 'tick', 'tock', 'last'], 'five, four, three, two, one')
    heard.length = 0
    ticks.update(0)
    ticks.update(30000) // a new turn, with a full clock
    for (let ms = 5600; ms > 3500; ms -= 100) ticks.update(ms)
    assert.deepEqual(heard, ['tick', 'tock'], 'counted again from five')
    heard.length = 0
    const sleepy = countdown()
    sleepy.update(5000)
    sleepy.update(1800) // a tab woken from the background: no burst of catching up
    sleepy.update(900)
    assert.deepEqual(heard, ['tick', 'last'])
  } finally {
    sound.play = play
  }
})

test('every module of the room loads: no import points at a file that is not there', async () => {
  // The room itself (main.js) runs on import; every module it is built from must at least load.
  const listing = await fetch(new URL('../app/', import.meta.url)).then((r) => (r.ok ? r.text() : '')).catch(() => '')
  const files = [...listing.matchAll(/href="([a-z0-9-]+\.js)"/g)].map((m) => m[1]).filter((f) => f !== 'main.js')
  if (!files.length) return // a host without listings
  for (const file of files) {
    try { await import(new URL(`../app/${file}`, import.meta.url)) } catch (err) { assert.ok(false, `app/${file}: ${err.message}`) }
  }
})
