/**
 * Who a player is, beyond one page load.
 *
 * plaza names a peer once per page load, so a reload would come back as a
 * stranger and lose its seat at every table. A player id is kept per tab
 * instead — sessionStorage survives a reload and dies with the tab — and
 * travels in presence, and seats belong to it.
 *
 * A duplicated tab copies sessionStorage, so two tabs can briefly share one
 * id. Whoever has the higher peer id gives way and takes a new one; both
 * sides apply the same rule, so they never both give way.
 */

const KEY = 'recreo:player'

const fresh = () => [...crypto.getRandomValues(new Uint8Array(9))]
  .map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)

export function playerId() {
  try {
    let id = sessionStorage.getItem(KEY)
    if (!id) {
      id = fresh()
      sessionStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return fresh()
  }
}

export function renewPlayerId() {
  const id = fresh()
  try { sessionStorage.setItem(KEY, id) } catch { /* private mode */ }
  return id
}

/** Should we give way, sharing a player id with this peer? */
export function shouldYield(selfPeerId, otherPeerId) {
  return selfPeerId > otherPeerId
}

export { colourFor } from './colours.js'
