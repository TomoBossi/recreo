import { arrow } from './pointer.js'

/**
 * Everyone's pointer, drawn over the games — and your own, drawn the same way.
 *
 * Windows sit in different places on every screen, so a position travels in
 * the game's own coordinates — the board's drawing space — and lands on the
 * same square of the same board for everyone, wherever their window is.
 *
 * Mice and fingers both count. A finger is followed while it touches and its
 * cursor fades once it lifts; only one finger is followed, the first one
 * down. A cursor grows a little while it moves and settles when it stops.
 *
 * Sent over an unreliable channel a few times a second: a late cursor
 * position is worth nothing, and a lost one is replaced by the next.
 */
const SEND_MS = 50
const IDLE_MS = 3000
export const MOVING_MS = 220

export class Cursors {
  #remote = new Map() // peerId -> { el, table, x, y, at, movingTimer, touch }
  #lastSent = 0
  #pending = null
  #timer = null
  #touchId = null

  constructor({ room, desk, players }) {
    this.room = room
    this.desk = desk
    this.players = players
    this.enabled = load()
    this.channel = room.dataChannel('recreo:cursors', { ordered: false, maxRetransmits: 0 })
    this.channel.on('message', (peerId, data) => this.#receive(peerId, data))

    // Mouse and pen hover; a finger only counts while it touches.
    desk.addEventListener('pointermove', (e) => this.#move(e))
    desk.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return
      if (this.#touchId == null && e.isPrimary) this.#touchId = e.pointerId
      this.#move(e)
    })
    const lift = (e) => {
      if (e.pointerType === 'touch' && e.pointerId === this.#touchId) {
        this.#touchId = null
        this.#send({ ...this.#lastPosition, up: 1 }, true)
      }
    }
    desk.addEventListener('pointerup', lift)
    desk.addEventListener('pointercancel', lift)
    desk.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.#send({ t: null }) })

    room.on('peer:leave', (peer) => this.#forget(peer.id))
    room.on('peer:interrupted', (peer) => this.#forget(peer.id))
    setInterval(() => this.#sweep(), 1000)
    new ResizeObserver(() => this.#redraw()).observe(desk)
  }

  setEnabled(on) {
    this.enabled = on
    try { localStorage.setItem('recreo:cursors', JSON.stringify(on)) } catch { /* private mode */ }
    if (!on) {
      this.#send({ t: null }, true)
      for (const id of [...this.#remote.keys()]) this.#forget(id)
    }
  }

  /** The game window and board drawing under a point, if any. */
  #boardAt(target) {
    const win = target.closest?.('.win[data-id^="table:"]')
    const svg = win?.querySelector('.stage svg')
    // A game can name the group whose coordinates are its own — a board that
    // turns round for one player, say — and positions travel in those.
    const space = svg?.querySelector('[data-cursor-space]') ?? svg
    return space ? { table: win.dataset.id.slice(6), svg: space } : null
  }

  #lastPosition = { t: null }

  #move(e) {
    if (!this.enabled) return
    if (e.pointerType === 'touch' && e.pointerId !== this.#touchId) return // one finger only
    const target = e.pointerType === 'touch' ? document.elementFromPoint(e.clientX, e.clientY) ?? e.target : e.target
    const board = this.#boardAt(target)
    if (!board) return this.#send({ t: null })
    const ctm = board.svg.getScreenCTM()
    if (!ctm) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    this.#lastPosition = { t: board.table, x: Math.round(p.x), y: Math.round(p.y), ...(e.pointerType === 'touch' ? { touch: 1 } : {}) }
    this.#send(this.#lastPosition)
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
    Object.assign(entry, { table: String(msg.t), x: Number(msg.x), y: Number(msg.y), at: Date.now(), touch: !!msg.touch })
    entry.el.classList.toggle('touch', entry.touch)
    entry.el.classList.remove('lifted', 'idle')
    if (msg.up) {
      // A finger lifted: its cursor goes away rather than standing there.
      entry.el.classList.add('lifted')
    } else {
      entry.el.classList.add('moving')
      clearTimeout(entry.movingTimer)
      entry.movingTimer = setTimeout(() => entry.el.classList.remove('moving'), MOVING_MS)
    }
    this.#place(entry)
  }

  #create(peerId) {
    const peer = this.room.peers.get(peerId)
    const el = document.createElement('div')
    el.className = 'cursor'
    el.innerHTML = `${arrow(this.players.colourOf(peer?.presence.player ?? peerId))}<span class="cursor-name"></span>`
    el.querySelector('.cursor-name').textContent = peer?.nick || '…'
    const entry = { el, table: null, x: 0, y: 0, at: 0, movingTimer: null, touch: false, peerId }
    this.#remote.set(peerId, entry)
    return entry
  }

  #place(entry) {
    const win = this.desk.querySelector(`.win[data-id="table:${CSS.escape(entry.table)}"]`)
    const root = win?.querySelector('.stage svg')
    const svg = root?.querySelector('[data-cursor-space]') ?? root
    const stage = win?.querySelector('.stage')
    const ctm = svg?.getScreenCTM()
    if (!ctm || win.classList.contains('collapsed')) { entry.el.remove(); return }
    if (entry.el.parentElement !== stage) stage.append(entry.el)
    // Colours and names can change while a cursor is up.
    const peer = this.room.peers.get(entry.peerId)
    const colour = this.players.colourOf(peer?.presence.player ?? entry.peerId)
    entry.el.querySelector('.arrow path').setAttribute('fill', colour)
    entry.el.querySelector('.cursor-name').textContent = peer?.nick || '…'
    const p = new DOMPoint(entry.x, entry.y).matrixTransform(ctm)
    const box = stage.getBoundingClientRect()
    entry.el.style.setProperty('--x', `${p.x - box.left}px`)
    entry.el.style.setProperty('--y', `${p.y - box.top}px`)
  }

  #redraw() {
    for (const entry of this.#remote.values()) this.#place(entry)
  }

  #sweep() {
    const now = Date.now()
    for (const entry of this.#remote.values()) {
      if (!entry.touch) entry.el.classList.toggle('idle', now - entry.at > IDLE_MS)
    }
  }

  #forget(peerId) {
    const entry = this.#remote.get(peerId)
    if (!entry) return
    clearTimeout(entry.movingTimer)
    entry.el.remove()
    this.#remote.delete(peerId)
  }

}

function load() {
  try { return JSON.parse(localStorage.getItem('recreo:cursors') ?? 'true') !== false } catch { return true }
}
