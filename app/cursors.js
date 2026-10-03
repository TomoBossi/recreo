import { colourFor } from './identity.js'

/**
 * Everyone's pointer, drawn over the tables.
 *
 * Windows sit in different places on every screen, so a position travels in
 * the game's own coordinates — the board's drawing space — and lands on the
 * same square of the same board for everyone, wherever their window is.
 *
 * Sent over an unreliable channel a few times a second: a late cursor
 * position is worth nothing, and a lost one is replaced by the next.
 */
const SEND_MS = 50
const IDLE_MS = 3000

export class Cursors {
  #remote = new Map() // peerId -> { el, table, x, y, at }
  #lastSent = 0
  #pending = null
  #timer = null

  constructor({ room, desk, players }) {
    this.room = room
    this.desk = desk
    this.players = players
    this.enabled = load()
    this.channel = room.dataChannel('recreo:cursors', { ordered: false, maxRetransmits: 0 })
    this.channel.on('message', (peerId, data) => this.#receive(peerId, data))

    desk.addEventListener('pointermove', (e) => this.#move(e))
    desk.addEventListener('pointerleave', () => this.#send({ t: null }))
    room.on('peer:leave', (peer) => this.#forget(peer.id))
    room.on('peer:interrupted', (peer) => this.#forget(peer.id))
    setInterval(() => this.#sweep(), 1000)
    new ResizeObserver(() => this.#redraw()).observe(desk)
  }

  setEnabled(on) {
    this.enabled = on
    try { localStorage.setItem('recreo:cursors', on ? '1' : '0') } catch { /* private mode */ }
    if (!on) {
      this.#send({ t: null }, true)
      for (const id of [...this.#remote.keys()]) this.#forget(id)
    }
  }

  /** The table window and board drawing under a point, if any. */
  #boardAt(target) {
    const win = target.closest?.('.win[data-id^="table:"]')
    const svg = win?.querySelector('.stage svg')
    // A game can name the group whose coordinates are its own — a board that
    // turns round for one player, say — and positions travel in those.
    const space = svg?.querySelector('[data-cursor-space]') ?? svg
    return space ? { table: win.dataset.id.slice(6), svg: space } : null
  }

  #move(e) {
    if (!this.enabled) return
    const board = this.#boardAt(e.target)
    if (!board) return this.#send({ t: null })
    const ctm = board.svg.getScreenCTM()
    if (!ctm) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    this.#send({ t: board.table, x: Math.round(p.x), y: Math.round(p.y) })
  }

  #send(msg, now = false) {
    this.#pending = msg
    const due = this.#lastSent + SEND_MS - Date.now()
    if (now || due <= 0) return this.#flush()
    if (!this.#timer) this.#timer = setTimeout(() => this.#flush(), due)
  }

  #flush() {
    this.#timer = null
    if (!this.#pending) return
    this.#lastSent = Date.now()
    this.channel.broadcast(JSON.stringify(this.#pending))
    this.#pending = null
  }

  #receive(peerId, data) {
    if (!this.enabled) return
    let msg
    try { msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) } catch { return }
    if (!msg?.t) return this.#forget(peerId)
    const entry = this.#remote.get(peerId) ?? this.#create(peerId)
    Object.assign(entry, { table: String(msg.t), x: Number(msg.x), y: Number(msg.y), at: Date.now() })
    this.#place(peerId, entry)
  }

  #create(peerId) {
    const peer = this.room.peers.get(peerId)
    const el = document.createElement('div')
    el.className = 'cursor'
    el.innerHTML = `<svg viewBox="0 0 24 28" width="22" height="26"><path d="M2 2 L2 22 L8 16 L12 26 L16 24 L12 14 L20 14 Z"
      fill="${colourFor(peer?.presence.player ?? peerId)}" stroke="#241c3a" stroke-width="2.2" stroke-linejoin="round"/></svg>
      <span class="cursor-name"></span>`
    el.querySelector('.cursor-name').textContent = peer?.nick || '…'
    const entry = { el, table: null, x: 0, y: 0, at: 0 }
    this.#remote.set(peerId, entry)
    return entry
  }

  #place(peerId, entry) {
    const win = this.desk.querySelector(`.win[data-id="table:${CSS.escape(entry.table)}"]`)
    const root = win?.querySelector('.stage svg')
    const svg = root?.querySelector('[data-cursor-space]') ?? root
    const stage = win?.querySelector('.stage')
    const ctm = svg?.getScreenCTM()
    if (!ctm || win.classList.contains('collapsed')) { entry.el.remove(); return }
    if (entry.el.parentElement !== stage) stage.append(entry.el)
    const p = new DOMPoint(entry.x, entry.y).matrixTransform(ctm)
    const box = stage.getBoundingClientRect()
    entry.el.style.transform = `translate(${p.x - box.left}px, ${p.y - box.top}px)`
    entry.el.classList.remove('idle')
  }

  #redraw() {
    for (const [id, entry] of this.#remote) this.#place(id, entry)
  }

  #sweep() {
    const now = Date.now()
    for (const entry of this.#remote.values()) entry.el.classList.toggle('idle', now - entry.at > IDLE_MS)
  }

  #forget(peerId) {
    this.#remote.get(peerId)?.el.remove()
    this.#remote.delete(peerId)
  }
}

function load() {
  try { return localStorage.getItem('recreo:cursors') !== '0' } catch { return true }
}
