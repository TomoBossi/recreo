/**
 * How a player looks when their camera is off: their character from the
 * roster, on a disc in their colour. Everything that draws a player without
 * video asks this module.
 *
 * The disc takes its colour from the CSS variable --who on any ancestor, so
 * a new colour shows at once without drawing anything again.
 */
import { PLAYABLE, character, drawn } from './roster.js'
import { store } from './store.js'

const pick = (list) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length]
const chance = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32

/**
 * How many of your past characters are remembered, and how quickly one wins
 * back its chances: one you had `n` characters ago is rolled with weight
 * 1 − RECOVERY^n, against 1 for a character you have not had lately.
 */
const MEMORY = 8
const RECOVERY = 0.5

/** The characters you have had, the one you have now first. */
const recent = () => {
  const list = store.get('recent-characters', [])
  return Array.isArray(list) ? list : []
}

/** Note that you now have `id`, so the next rolls go easier on it. */
export function remember(id) {
  store.set('recent-characters', [id, ...recent().filter((c) => c !== id)].slice(0, MEMORY))
}

/**
 * A character at random. Given the one you have now, it picks among the
 * others, so asking again always changes something. The ones you had lately
 * are less likely than the rest, the more so the more recent, but never
 * ruled out: there is no order to learn.
 */
export function randomCharacter(current = null, history = recent()) {
  const others = PLAYABLE.filter((id) => id !== current)
  if (!others.length) return pick(PLAYABLE)
  const weights = others.map((id) => {
    const n = history.indexOf(id)
    return n < 0 ? 1 : 1 - RECOVERY ** n
  })
  const total = weights.reduce((a, b) => a + b, 0)
  if (!total) return pick(others)
  let roll = chance() * total
  for (const [i, w] of weights.entries()) {
    roll -= w
    if (roll < 0) return others[i]
  }
  return others.at(-1)
}

/** A character you can be: the one asked for if it is playable, else one at random. */
export const playable = (id) => (PLAYABLE.includes(id) ? id : randomCharacter())

/**
 * The drawing for a player with character `id`. A peer whose roster has a
 * character this one has never heard of shows as a plain smiley instead.
 */
export function avatar(id = null) {
  if (id && drawn(id)) return character(id, { bg: 'var(--who, var(--sky))', className: 'avatar-face character' })
  return `<svg class="avatar-face" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="var(--who, var(--sky))" stroke="#241c3a" stroke-width="4"/>
    <ellipse cx="36" cy="37" rx="5" ry="7" fill="#241c3a"/>
    <ellipse cx="64" cy="37" rx="5" ry="7" fill="#241c3a"/>
    <path d="M32 61 Q50 77 68 61" fill="none" stroke="#241c3a" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`
}

/** The arrow going round, for a button that picks again. */
export const REFRESH = `<svg class="refresh" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.9v4.9h-4.9"/></g></svg>`
