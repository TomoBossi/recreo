import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { defineGame } from '../games/kit/define.js'
import { games } from '../games/index.js'
import { CAPACITY } from '../app/limits.js'
import tictactoe from '../games/tictactoe/index.js'

const noop = () => {}
const turns = { init: () => ({}), turn: () => null, legal: () => true, apply: (s) => s, status: () => '' }
const authority = { init: () => ({}), decide: () => [], apply: (s) => s, status: () => '' }
const spec = (over) => ({ id: 'x', name: 'X', kind: 'turns', seats: 2, rules: turns, view: noop, ...over })

test('every folder under games/ with an index.js is registered, under its folder name', () => {
  const folders = readdirSync(new URL('../games/', import.meta.url))
    .filter((f) => f !== 'kit' && statSync(new URL(`../games/${f}`, import.meta.url)).isDirectory())
  assert.deepEqual(Object.keys(games).sort(), folders.sort())
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
