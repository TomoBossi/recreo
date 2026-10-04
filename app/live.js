/**
 * What a player is in the middle of, shown to everyone as it happens: an aim
 * being pulled back, a line being drawn. Nothing here is a move — it changes
 * no state, a late arrival never sees it, and a lost message is replaced by
 * the next — so it travels the way pointers do, unreliable and unordered,
 * a few dozen times a second at most.
 *
 * A game's view calls ctx.share(data); every other peer's view of that
 * table gets hear(data, seat). Only what a seated player shares is passed
 * on, with the seat they hold.
 */
const SEND_MS = 33

export class Live {
  #pending = new Map() // table id -> data waiting for its slot
  #lastSent = new Map()
  #timers = new Map()

  constructor({ room, tables, deliver }) {
    this.tables = tables
    this.room = room
    this.channel = room.dataChannel('recreo:live', { ordered: false, maxRetransmits: 0 })
    this.channel.on('message', (peerId, raw) => {
      let msg
      try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) } catch { return }
      const table = tables.tables.get(String(msg?.t))
      const player = room.peers.get(peerId)?.presence?.player
      if (!table || table.closed || !player) return
      const seat = tables.seatOf(table, player)
      if (seat == null) return
      deliver(table.id, msg.d ?? null, seat)
    })
  }

  /** Share something about a table now, or in a moment if we just did. */
  share(tableId, data) {
    this.#pending.set(tableId, data)
    const due = (this.#lastSent.get(tableId) ?? 0) + SEND_MS - Date.now()
    // An end — null, a shot let go — goes at once, so it is never held back behind an aim.
    if (data == null || due <= 0) return this.#flush(tableId)
    if (!this.#timers.has(tableId)) this.#timers.set(tableId, setTimeout(() => this.#flush(tableId), due))
  }

  #flush(tableId) {
    clearTimeout(this.#timers.get(tableId))
    this.#timers.delete(tableId)
    if (!this.#pending.has(tableId)) return
    const data = this.#pending.get(tableId)
    this.#pending.delete(tableId)
    this.#lastSent.set(tableId, Date.now())
    this.channel.broadcast(JSON.stringify({ t: tableId, d: data }))
  }
}
