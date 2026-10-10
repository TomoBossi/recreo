import { test, assert } from './harness.js'
import { randomCharacter } from '../app/avatar.js'
import { PLAYABLE } from '../app/roster.js'

const tally = (current, history, rolls = 40000) => {
  const seen = Object.fromEntries(PLAYABLE.map((id) => [id, 0]))
  for (let i = 0; i < rolls; i++) seen[randomCharacter(current, history)]++
  return seen
}

test('a roll never gives back the character you have now', () => {
  const [current] = PLAYABLE
  assert.equal(tally(current, [current], 2000)[current], 0)
})

test('recent characters are less likely, the more recent the less, but never ruled out', () => {
  const history = PLAYABLE.slice(0, 4)
  const seen = tally(history[0], history)
  const fresh = PLAYABLE.slice(4)
  const freshMean = fresh.reduce((sum, id) => sum + seen[id], 0) / fresh.length
  // Weights 0.5, 0.75 and 0.875 against 1 for a character not had lately.
  for (const [n, expected] of [[1, 0.5], [2, 0.75], [3, 0.875]]) {
    const ratio = seen[history[n]] / freshMean
    assert.ok(Math.abs(ratio - expected) < 0.1, `${n} rolls ago: ${ratio.toFixed(2)}, expected about ${expected}`)
  }
  assert.ok(seen[history[1]] > 0 && seen[history[1]] < seen[history[2]] && seen[history[2]] < seen[history[3]])
})

test('with no history every other character is as likely as the next', () => {
  const [current] = PLAYABLE
  const seen = tally(current, [])
  const others = PLAYABLE.filter((id) => id !== current).map((id) => seen[id])
  const mean = others.reduce((a, b) => a + b, 0) / others.length
  for (const n of others) assert.ok(Math.abs(n / mean - 1) < 0.15, `${n} against a mean of ${mean.toFixed(0)}`)
})
