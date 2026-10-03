/**
 * Randomness every peer agrees on.
 *
 * A game's state carries a number; each draw returns the next number and a
 * value, and the game keeps the new number in its state. Same seed, same
 * draws, on every machine — so a game with dice or shuffles can still be
 * one where everyone runs the rules.
 */

/** The next state of an xorshift32 generator. */
export function next(rng) {
  let x = rng >>> 0 || 0x9e3779b9
  x ^= x << 13; x >>>= 0
  x ^= x >>> 17
  x ^= x << 5; x >>>= 0
  return x
}

/** An integer in [0, n), and the generator's next state. */
export function int(rng, n) {
  const r = next(rng)
  return { value: r % n, rng: r }
}

/** One element of a list, and the generator's next state. */
export function pick(rng, list) {
  const { value, rng: r } = int(rng, list.length)
  return { value: list[value], rng: r }
}
