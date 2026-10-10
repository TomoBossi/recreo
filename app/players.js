/**
 * Everyone recreo knows by player id: who is here, who is reconnecting, and
 * the names of those who left — a seat keeps showing its player's name after
 * they have gone, until somebody else sits down.
 */
import { clampColour, colourFor } from '../games/kit/colours.js'

export class Players {
  #known = new Map() // player id -> last known nick
  #colours = new Map() // player id -> last known colour
  #characters = new Map() // player id -> last known character

  constructor({ room, me }) {
    this.room = room
    this.me = me
  }

  /** Remember a peer's name under its player id. */
  learn(peer) {
    const player = peer.presence?.player
    if (player && peer.nick) this.#known.set(player, peer.nick)
    if (player && peer.presence.colour) this.#colours.set(player, clampColour(peer.presence.colour))
    if (player && peer.presence.character) this.#characters.set(player, String(peer.presence.character))
  }

  /** Remember a name met elsewhere — on a seat claim, say — for a player not here. */
  remember(player, nick) {
    if (player && nick && !this.#known.has(player)) this.#known.set(player, nick)
  }

  /** Everyone in the room now, self first. */
  list() {
    const out = [{ player: this.me.player, nick: this.me.nick || 'you', self: true, peerId: null }]
    for (const peer of this.room.peers.values()) {
      const player = peer.presence?.player
      if (!player) continue
      out.push({ player, nick: peer.nick || '…', self: false, peerId: peer.id, reconnecting: !!peer.reconnecting })
    }
    return out
  }

  nameOf(player) {
    if (player === this.me.player) return this.me.nick || 'you'
    const here = this.list().find((p) => p.player === player)
    return here?.nick ?? this.#known.get(player) ?? 'someone'
  }

  /** The colour a player chose, or one picked for them from their id. */
  colourOf(player) {
    if (player === this.me.player) return this.me.colour
    for (const peer of this.room.peers.values()) {
      if (peer.presence?.player === player && peer.presence.colour) return clampColour(peer.presence.colour)
    }
    return this.#colours.get(player) ?? colourFor(player)
  }

  /** The character a player is, if we have heard. */
  characterOf(player) {
    if (player === this.me.player) return this.me.character
    for (const peer of this.room.peers.values()) {
      if (peer.presence?.player === player && peer.presence.character) return String(peer.presence.character)
    }
    return this.#characters.get(player) ?? null
  }

  /** 'here', 'reconnecting' or 'away'. */
  stateOf(player) {
    if (player === this.me.player) return 'here'
    const here = this.list().find((p) => p.player === player)
    if (!here) return 'away'
    return here.reconnecting ? 'reconnecting' : 'here'
  }
}
