import { arrow } from './pointer.js'
import { avatar } from './avatar.js'

/**
 * Everyone's pointer, drawn over the games — and your own, drawn the same way.
 *
 * Screens differ in size and shape, and every window sits somewhere else on
 * each of them, so a pointer is never sent as a place on the screen. It is
 * sent as a place in something everyone has:
 *
 *   - On a game board, a point in the board's own drawing coordinates, which
 *     lands on the same square of the same board for everyone.
 *   - On a shared control of a table — a seat, an option, the rematch
 *     button — that control, and where inside it.
 *     Each sits somewhere else on each screen, but means the same thing.
 *     Anything can opt in by naming itself with data-cursor-anchor.
 *   - On an activity — a shared screen, the YouTube player — the same:
 *     anchors, the picture among them. A window shares pointers by naming
 *     itself, the same name on every screen, with data-cursor-window, and
 *     says where they are drawn with data-cursor-host.
 *   - Anywhere else — settings, the shelf, the top bar, your own camera — a
 *     pointer means nothing to anyone else, and is not shown.
 *
 * A pointer that leaves stays parked where it crossed the board's edge,
 * dims, and fades: the others see which way it went instead of it simply
 * vanishing. Small moves glide; a jump — a new table, a new control, the
 * far side of the board — fades out and back in rather than streaking
 * across squares nobody crossed.
 *
 * Mice and fingers both count. A finger is followed while it touches —
 * taps and drags alike — and its cursor fades once it lifts; only one finger
 * is followed, the first one down. Fingers are read from touch events: a
 * phone cancels a finger's pointer events the moment a drag turns into a
 * scroll, but its touch events keep coming. A cursor grows a little while it
 * moves and settles when it stops, and one left still dims where it rests
 * until it moves again.
 *
 * Sent over an unreliable channel a few times a second: a late position is
 * worth nothing, and a lost one is replaced by the next.
 *
 * Cursors can be shown, shown with each player's character beside them, or
 * hidden: hidden ones are neither drawn nor sent. Characters ride only by
 * other people's cursors, and only while they move: one that dims or fades
 * leaves its character behind first.
 */
const SEND_MS = 50
const IDLE_MS = 2500     // a pointer still this long dims where it rests until it moves again
const PARK_MS = 900      // a departed cursor waits at the edge this long, dimmed, then fades
const JUMP_PX = 140      // further than this between updates is a jump, not a glide
export const MOVING_MS = 220

export class Cursors {
  #remote = new Map() // peerId -> entry, see #create
  #lastSent = 0
  #pending = null
  #timer = null
  #touchId = null
  #last = { t: null } // what we last said, to know when we leave

  constructor({ room, desk, players }) {
    this.room = room
    this.desk = desk
    this.players = players
    this.mode = cursorMode()
    this.channel = room.dataChannel('recreo:cursors', { ordered: false, maxRetransmits: 0 })
    this.channel.on('message', (peerId, data) => this.#receive(peerId, data))

    // Mouse and pen, by pointer events: they hover.
    desk.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') this.#move(e) })
    desk.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.#leave(e) })

    // Fingers, by touch events: followed through taps and drags, scrolling or not.
    const finger = (e) => [...e.changedTouches].find((t) => t.identifier === this.#touchId)
    desk.addEventListener('touchstart', (e) => {
      if (this.#touchId == null) this.#touchId = e.changedTouches[0].identifier
      const t = finger(e)
      if (t) this.#move(touchPoint(t))
    }, { passive: true })
    desk.addEventListener('touchmove', (e) => {
      const t = finger(e)
      if (t) this.#move(touchPoint(t))
    }, { passive: true })
    const lift = (e) => {
      if (!finger(e)) return
      this.#touchId = null
      if (this.#last.t) this.#send({ ...this.#last, up: 1 }, true)
    }
    desk.addEventListener('touchend', lift, { passive: true })
    desk.addEventListener('touchcancel', lift, { passive: true })

    room.on('peer:leave', (peer) => this.#forget(peer.id))
    room.on('peer:interrupted', (peer) => this.#forget(peer.id))
    new ResizeObserver(() => this.#redraw()).observe(desk)
  }

  get enabled() { return this.mode !== 'hide' }

  /** 'show', 'characters' or 'hide'. */
  setMode(mode) {
    this.mode = mode
    try { localStorage.setItem('recreo:cursors', JSON.stringify(mode)) } catch { /* private mode */ }
    if (!this.enabled) {
      this.#send({ t: null }, true)
      for (const id of [...this.#remote.keys()]) this.#forget(id)
    }
    this.#redraw()
  }

  // ------------------------------------------------------------ sending

  /** What a pointer is over that others share: a board point, an anchor, or nothing. */
  #placeOf(target, e) {
    const win = target?.closest?.('.win[data-id^="table:"], .win[data-cursor-window]')
    if (!win || win.classList.contains('collapsed')) return null
    const table = win.dataset.cursorWindow ?? win.dataset.id.slice(6)
    const svg = win.dataset.cursorWindow ? null : target.closest('.stage svg')
    if (svg) {
      // A game can name the group whose coordinates are its own — a board
      // that turns round for one player, say — and positions travel in those.
      const space = svg.querySelector('[data-cursor-space]') ?? svg
      const p = toSpace(space, e)
      // Only the drawing is shared. The margin round it is letterboxing,
      // shaped differently on every screen: being there is having left.
      const box = bounds(space)
      const pad = Math.max(box.width, box.height) * 0.04
      if (!p || p.x < box.x - pad || p.y < box.y - pad || p.x > box.x + box.width + pad || p.y > box.y + box.height + pad) return null
      return { t: table, x: Math.round(p.x), y: Math.round(p.y) }
    }
    const anchor = target.closest('[data-cursor-anchor]')
    if (anchor && win.contains(anchor)) {
      const box = anchor.getBoundingClientRect()
      if (!box.width || !box.height) return null
      return {
        t: table,
        a: anchor.dataset.cursorAnchor,
        fx: Math.round(clamp01((e.clientX - box.left) / box.width) * 1000),
        fy: Math.round(clamp01((e.clientY - box.top) / box.height) * 1000),
      }
    }
    return null
  }

  #move(e) {
    if (!this.enabled) return
    // A finger's target is whatever is under it now, not where it went down.
    const target = e.pointerType === 'touch' ? document.elementFromPoint(e.clientX, e.clientY) : e.target
    const place = this.#placeOf(target, e)
    if (!place) return this.#leave(e)
    if (e.pointerType === 'touch') place.touch = 1
    this.#last = place
    this.#send(place)
  }

  /**
   * The pointer left everything shared. From a board, say where it crossed
   * the edge — the last update may have been well inside — so the others
   * park it there; from anything else, it parks where it was last seen.
   */
  #leave(e) {
    const last = this.#last
    if (!last.t) return
    this.#last = { t: null }
    if (last.a == null && e) {
      const win = this.#window(last.t)
      const svg = win?.dataset.cursorWindow ? null : win?.querySelector('.stage svg')
      const space = svg?.querySelector('[data-cursor-space]') ?? svg
      const p = space && toSpace(space, e)
      if (p) {
        const box = bounds(space)
        const x = Math.round(Math.min(box.x + box.width, Math.max(box.x, p.x)))
        const y = Math.round(Math.min(box.y + box.height, Math.max(box.y, p.y)))
        return this.#send({ t: last.t, x, y, out: 1, ...(last.touch ? { touch: 1 } : {}) }, true)
      }
    }
    this.#send({ ...last, out: 1 }, true)
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

  // ---------------------------------------------------------- receiving

  #receive(peerId, data) {
    if (!this.enabled) return
    let msg
    try { msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) } catch { return }
    const entry = this.#remote.get(peerId) ?? this.#create(peerId)
    if (!msg?.t) return this.#park(entry)
    const before = entry.shown ? entry.screen : null
    const moved = entry.table !== String(msg.t) || (entry.a ?? null) !== (msg.a ?? null)
    Object.assign(entry, {
      table: String(msg.t),
      a: msg.a ?? null,
      x: Number(msg.x), y: Number(msg.y), fx: Number(msg.fx), fy: Number(msg.fy),
      at: Date.now(),
      touch: !!msg.touch,
    })
    entry.el.classList.toggle('touch', entry.touch)
    entry.el.classList.remove('idle')
    // A pointer that stops dims where it rests: one timer per cursor, set on each
    // move, instead of a sweep that wakes the page whether or not anyone
    // is pointing at anything.
    clearTimeout(entry.idleTimer)
    if (!entry.touch) entry.idleTimer = setTimeout(() => entry.el.classList.add('idle'), IDLE_MS)
    const shown = this.#place(entry)
    if (!shown) return
    // A jump fades rather than glides: across tables, controls, or the board.
    const far = before && Math.hypot(entry.screen.x - before.x, entry.screen.y - before.y) > JUMP_PX
    if (!before || moved || far) this.#appear(entry)
    if (msg.out) return this.#park(entry)
    if (msg.up) {
      // A finger lifted: its cursor goes away rather than standing there.
      entry.el.classList.add('lifted')
      return
    }
    clearTimeout(entry.parkTimer)
    entry.el.classList.remove('parked', 'gone', 'lifted')
    entry.el.classList.add('moving')
    clearTimeout(entry.movingTimer)
    entry.movingTimer = setTimeout(() => entry.el.classList.remove('moving'), MOVING_MS)
  }

  /** Arrive without gliding: jump into place, then fade in. */
  #appear(entry) {
    const el = entry.el
    el.classList.add('jumping')
    el.classList.remove('parked', 'gone', 'lifted')
    void el.offsetWidth // commit the jump before transitions return
    el.classList.remove('jumping')
    el.classList.remove('entering')
    void el.offsetWidth
    el.classList.add('entering')
    // Done fading in, it must let go: an animation outranks a transition,
    // and one left on would cut every later fade — going still, parking,
    // leaving — to a blink.
    const done = (e) => { if (e.animationName !== 'cursor-in') return; el.classList.remove('entering'); el.removeEventListener('animationend', done) }
    el.addEventListener('animationend', done)
  }

  /** Left everything shared: stay where it crossed, dimmed, then fade away. */
  #park(entry) {
    if (!entry.shown) return
    clearTimeout(entry.parkTimer)
    entry.el.classList.remove('moving')
    entry.el.classList.add('parked')
    entry.parkTimer = setTimeout(() => {
      entry.el.classList.add('gone')
      entry.shown = false
    }, PARK_MS)
  }

  #create(peerId) {
    const peer = this.room.peers.get(peerId)
    const el = document.createElement('div')
    el.className = 'cursor'
    el.innerHTML = `${arrow(this.players.colourOf(peer?.presence.player ?? peerId))}<span class="cursor-character"></span>`
    const entry = { el, peerId, character: undefined, table: null, a: null, x: 0, y: 0, fx: 0, fy: 0, at: 0, touch: false, shown: false, screen: null, movingTimer: null, parkTimer: null }
    this.#remote.set(peerId, entry)
    return entry
  }

  /** The window a pointer message names: a game's table, or an activity by its shared name. */
  #window(name) {
    return this.desk.querySelector(`.win[data-cursor-window="${CSS.escape(name)}"]`)
      ?? this.desk.querySelector(`.win[data-id="table:${CSS.escape(name)}"]`)
  }

  /**
   * Put a cursor where it belongs on this screen. Returns false when there
   * is nowhere: the table is closed or collapsed here, or the control it
   * was over is not showing.
   */
  #place(entry) {
    const win = this.#window(entry.table)
    const table = win?.querySelector('.table, [data-cursor-host]')
    if (!table || win.classList.contains('collapsed')) { entry.el.remove(); entry.shown = false; return false }
    // Cursors live in a layer of their own that clips them, so one near an
    // edge can never stretch the window or make it scroll.
    let host = table.querySelector(':scope > .cursor-layer')
    if (!host) {
      host = document.createElement('div')
      host.className = 'cursor-layer'
      table.append(host)
    }
    let x
    let y
    if (entry.a != null) {
      const anchor = [...win.querySelectorAll('[data-cursor-anchor]')].find((n) => n.dataset.cursorAnchor === entry.a)
      const box = anchor?.getBoundingClientRect()
      if (!box?.width) { entry.el.remove(); entry.shown = false; return false }
      x = box.left + (entry.fx / 1000) * box.width
      y = box.top + (entry.fy / 1000) * box.height
      // In something that scrolls (data-cursor-clip), each scrolled their own
      // way: a pointer on a part scrolled out of sight here is not shown.
      const clip = anchor.closest('[data-cursor-clip]')?.getBoundingClientRect()
      if (clip && (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom)) { entry.el.remove(); entry.shown = false; return false }
    } else {
      const root = win.querySelector('.stage svg')
      const space = root?.querySelector('[data-cursor-space]') ?? root
      const ctm = space?.getScreenCTM()
      if (!ctm) { entry.el.remove(); entry.shown = false; return false }
      const p = new DOMPoint(entry.x, entry.y).matrixTransform(ctm)
      x = p.x
      y = p.y
    }
    if (entry.el.parentElement !== host) host.append(entry.el)
    // Colours and characters can change while a cursor is up.
    const peer = this.room.peers.get(entry.peerId)
    const player = peer?.presence.player ?? entry.peerId
    const colour = this.players.colourOf(player)
    entry.el.querySelector('.arrow path').setAttribute('fill', colour)
    entry.el.style.setProperty('--who', colour)
    entry.el.classList.toggle('with-character', this.mode === 'characters')
    const character = this.players.characterOf(player)
    if (this.mode === 'characters' && entry.character !== character) {
      entry.character = character
      entry.el.querySelector('.cursor-character').innerHTML = avatar(character)
    }
    const origin = host.getBoundingClientRect()
    entry.screen = { x, y }
    entry.el.style.setProperty('--x', `${x - origin.left}px`)
    entry.el.style.setProperty('--y', `${y - origin.top}px`)
    // Near the right edge the character goes on the other side, to stay in view.
    entry.el.classList.toggle('flip', x - origin.left > origin.width - 70)
    entry.shown = true
    return true
  }

  #redraw() {
    for (const entry of this.#remote.values()) if (entry.shown) this.#place(entry)
  }

  #forget(peerId) {
    const entry = this.#remote.get(peerId)
    if (!entry) return
    clearTimeout(entry.movingTimer)
    clearTimeout(entry.parkTimer)
    clearTimeout(entry.idleTimer)
    entry.el.remove()
    this.#remote.delete(peerId)
  }
}

/** A drawing's extent, measured at most once a second — it rarely changes. */
const measured = new WeakMap()
function bounds(space) {
  const hit = measured.get(space)
  if (hit && performance.now() - hit.at < 1000) return hit.box
  const box = space.getBBox()
  measured.set(space, { box, at: performance.now() })
  return box
}

/** A touch, shaped like the pointer events the rest of this reads. */
function touchPoint(t) {
  return { clientX: t.clientX, clientY: t.clientY, pointerType: 'touch' }
}

/** A pointer event's position in an SVG element's own coordinates. */
function toSpace(space, e) {
  const ctm = space.getScreenCTM()
  return ctm ? new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()) : null
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))

/**
 * How cursors are shown: 'show', 'characters' or 'hide' (once stored as true
 * or false). Until a player picks, cursors come with their characters.
 */
export function cursorMode() {
  try {
    const saved = JSON.parse(localStorage.getItem('recreo:cursors') ?? '"characters"')
    if (saved === false) return 'hide'
    return ['show', 'characters', 'hide'].includes(saved) ? saved : 'characters'
  } catch {
    return 'characters'
  }
}
