import { store } from './store.js'
import { sound } from '../games/kit/sound.js'

/**
 * A small window manager for the room.
 *
 * Everything in the room is a window — each game, the peers, the chat — and
 * there are two ways to arrange them. Tiled, after dwm: one window is the
 * master and takes most of the width, everything else stacks in a column
 * beside it, and the dividers between them can be dragged. Floating: windows
 * go wherever they are dragged, resized from any corner. Any window
 * collapses to its title bar in either mode.
 *
 * On a narrow screen there is no room for two columns, so the windows become
 * one scrolling column and floating is not offered.
 *
 * A collapsed window opens from its + or a double click on its title; a
 * double click never collapses one.
 *
 * Tiled on a wide screen, the master is chosen rather than collapsed: it has
 * no collapse button. A window beside it that is open can be expanded (↖),
 * trading places with the master; the chat never is. With a game in the
 * room, the master can step back to the stack (↘): a game gives its place
 * to the peers, the peers theirs to the game used last. Of the games beside
 * the master, one at most is open — at most two games open, so a room with
 * five stays as tidy as one with two — and the rest wait collapsed. Windows
 * beside the master answer only their buttons and a double click: pressing
 * one changes nothing.
 *
 * In the narrow column every game can be open: it scrolls. Floating, windows
 * go where they are put, and nothing is collapsed for them.
 */

const GAP = 14
const LIFT = 3        // the hard shadow every window casts, right and down
const TITLE = 34      // a collapsed window, title bar and border, where none can be measured
const NARROW = 760
const MIN_W = 220
const MIN_H = 120
const CORNER = 16     // how close to a corner a pointer must be to resize

const arrow = (d) => `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
/** Up and to the left, towards the master's place: expand. */
const EXPAND = arrow('M11 11 3.5 3.5 M3 8.5V3h5.5')
/** Down and to the right, back to the stack: step back. */
const RETIRE = arrow('M3 3 10.5 10.5 M11 5.5V11H5.5')

export class WindowManager {
  /** @param {HTMLElement} desk */
  constructor(desk) {
    this.desk = desk
    this.windows = []
    this.mode = store.get('wm:mode', 'tiled')
    this.mfact = store.get('wm:mfact', 0.68)
    this.master = null
    this.recent = []    // game windows, the one brought forward last first
    this.floatRects = new Map(Object.entries(store.get('wm:float', {})))
    this.z = 1
    this.onChange = () => {}

    this.gutter = document.createElement('div')
    this.gutter.className = 'gutter'
    this.gutter.title = 'drag to resize'
    desk.append(this.gutter)
    this.#dragGutter()
    this.hgutters = []

    new ResizeObserver(() => this.layout()).observe(desk)
  }

  get narrow() { return this.desk.clientWidth < NARROW }

  /** Whether the last layout was wide and tiled, to notice arriving there. */
  #wasWide = false
  /** Whether the master was chosen — expanded, stepped back for, or a game played — rather than fallen to. */
  #chosen = false
  /** Games brought forward at least once. The rest are ranked as they are shown. */
  #used = new WeakSet()

  /**
   * Add a window.
   *
   * `kind` decides tiling: a game may be the master, a panel never is unless
   * there is nothing else. `weight` is how much of the stack's height a
   * window wants relative to its neighbours, until someone drags a divider.
   * `tools` are extra buttons for the title bar.
   */
  add({ id, title, meta = '', tone = 'sun', body, kind = 'panel', weight = 1, order = 0, closable = false, closeLabel = 'close', collapsed = false, tools = [], onClose, phoneHeight = null }) {
    const el = document.createElement('section')
    el.className = `win tone-${tone}`
    el.dataset.id = id
    el.innerHTML = `
      <div class="win-title">
        <span class="title"></span>
        <span class="meta"></span>
        <span class="tools"></span>
        <button class="wbtn expand" title="make this the main window" aria-label="make this the main window" hidden>${EXPAND}</button>
        <button class="wbtn retire" title="back to the side" aria-label="back to the side" hidden>${RETIRE}</button>
        <button class="wbtn collapse" title="collapse" aria-label="collapse"></button>
        ${closable ? `<button class="wbtn close" title="${closeLabel}" aria-label="${closeLabel}"></button>` : ''}
      </div>
      <div class="win-body"></div>`
    el.querySelector('.tools').append(...tools)
    el.querySelector('.win-body').append(body)

    const win = {
      id, el, kind, order, onClose, phoneHeight,
      weight: store.get(`wm:weight:${id}`, weight),
      collapsed: store.get(`wm:collapsed:${id}`, collapsed),
      setTitle: (text) => { el.querySelector('.title').textContent = text },
      setMeta: (text) => { el.querySelector('.meta').textContent = text },
      collapse: (on = !win.collapsed) => {
        win.collapsed = on
        store.set(`wm:collapsed:${id}`, on)
        // A game opened up from its title bar joins the one being played,
        // and the game looked at longest ago steps back.
        if (!on && kind === 'table') this.#bring(win, this.master && this.master !== win ? 1 : 0, win)
        this.layout()
      },
      close: () => this.remove(win),
      /** Show or hide the close button: a game offers it only to its players. */
      setClosable: (on) => { const b = el.querySelector('.wbtn.close'); if (b) b.hidden = !on },
    }
    win.setTitle(title)
    win.setMeta(meta)

    el.querySelector('.wbtn.collapse').addEventListener('click', (e) => { e.stopPropagation(); win.collapse() })
    el.querySelector('.wbtn.expand').addEventListener('click', (e) => { e.stopPropagation(); this.#crown(win) })
    el.querySelector('.wbtn.retire').addEventListener('click', (e) => { e.stopPropagation(); this.#retire(win) })
    // A small game is brought forward before it asks whether to end: its
    // own question has no room to show while it is small.
    el.querySelector('.wbtn.close')?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (el.classList.contains('side') || win.collapsed) this.focus(win, { expand: true })
      win.onClose ? win.onClose() : win.close()
    })
    // Pressing a window's own buttons does what they say, not "focus": a
    // focus would rearrange the desk under the press and swallow the click.
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.wbtn, .tools button')) return
      // Wide and tiled, a window beside the master answers only its buttons
      // and a double click on its title: pressing it changes nothing.
      if (this.#wide) { if (win === this.master) this.focus(win); return }
      // In the column a collapsed game waits for its + or a double click;
      // floating, any window pressed comes to the front.
      if (this.narrow && win.collapsed) return
      this.focus(win)
    })
    // A double click on a collapsed window's title opens it, as its + does;
    // on an open one it does nothing.
    el.querySelector('.win-title').addEventListener('dblclick', (e) => {
      if (e.target.closest('button') || !win.collapsed) return
      win.collapse(false)
      sound.play('on')
    })
    this.#dragWindow(win)
    this.#resizeWindow(win)

    this.windows.push(win)
    // A game arriving last in line: open if there is room, else waiting.
    if (kind === 'table') { this.#rank(win); this.#settle({ refill: false }) }
    this.desk.append(el)
    this.layout()
    return win
  }

  remove(win) {
    this.windows = this.windows.filter((w) => w !== win)
    this.recent = this.recent.filter((w) => w !== win)
    win.el.remove()
    if (this.master === win) { this.master = null; this.#chosen = false }
    // A game gone leaves room: of those waiting, the one seen last comes back.
    this.#settle({ refill: true })
    this.layout()
  }

  get(id) { return this.windows.find((w) => w.id === id) }

  /**
   * Bring a window forward. A game becomes the master when tiled; any window
   * is raised when floating.
   */
  focus(win, { expand = false } = {}) {
    win.el.style.zIndex = String(++this.z)
    if (win.kind !== 'table') return
    // The game played is never a title bar; floating, a window's state is its own.
    if ((expand || this.#tiled) && win.collapsed) {
      win.collapsed = false
      store.set(`wm:collapsed:${win.id}`, false)
    }
    const changed = this.master !== win || this.recent[0] !== win
    // Wide and tiled, the master it replaces stays open beside it.
    const previous = this.master
    if (this.#wide && previous && previous !== win) this.#open(previous)
    this.master = win
    this.#chosen = true
    this.#bring(win, 0, previous?.kind === 'table' ? previous : null)
    if (changed || expand) this.layout()
  }

  /** Tiled on a screen wide enough for two columns: where the master is chosen. */
  get #wide() { return this.mode !== 'floating' && !this.narrow }

  #open(win) {
    if (!win.collapsed) return
    win.collapsed = false
    store.set(`wm:collapsed:${win.id}`, false)
  }

  /**
   * Make an open window beside the master the master. They trade places,
   * and the master goes beside it open, as the window it replaces was.
   */
  #crown(win) {
    if (!this.#wide || win === this.master || win.id === 'chat') return
    if (win.kind === 'table') return this.focus(win)
    const previous = this.master
    if (previous) this.#open(previous)
    this.#open(win)
    this.master = win
    this.#chosen = true
    this.#settle({ refill: false, keep: previous?.kind === 'table' ? previous : null })
    this.layout()
  }

  /**
   * The master steps back beside the new one, open: a game in favour of the
   * peers, the peers in favour of the game used last (or, with none used
   * yet, the first in the stack).
   */
  #retire(win) {
    if (!this.#wide || win !== this.master) return
    const tables = this.windows.filter((w) => w.kind === 'table')
    if (!tables.length) return
    const next = win.kind === 'table' ? this.get('faces')
      : this.recent.find((w) => w !== win) ?? this.#sorted(tables)[0]
    if (!next || next === win) return
    this.#open(win)
    this.#open(next)
    this.master = next
    this.#chosen = true
    if (next.kind === 'table') this.#bring(next, 0)
    this.#settle({ refill: false, keep: win.kind === 'table' ? win : null })
    this.layout()
  }

  /** Tiled, where games are arranged for you (a phone's column included). */
  get #tiled() { return this.mode !== 'floating' || this.narrow }

  /**
   * A game joining the line of those seen last: after every game used, among
   * those never used in the order they are shown. Someone just arrived has
   * used none, so theirs is the order on screen.
   */
  #rank(win) {
    const used = this.recent.filter((w) => this.#used.has(w))
    const unused = this.#sorted([...this.recent.filter((w) => !this.#used.has(w)), win])
    this.recent = [...used, ...unused]
  }

  /**
   * The master: the one chosen; until there is a choice, a game whenever
   * there is one — the game is the stage, the one seen last, or the first
   * shown — and otherwise the peers. Never the chat.
   */
  #pickMaster() {
    const tables = this.windows.filter((w) => w.kind === 'table')
    const current = this.master && this.windows.includes(this.master) && this.master.id !== 'chat' ? this.master : null
    if (current && (this.#chosen || current.kind === 'table' || !tables.length)) return current
    return this.recent.find((w) => !w.collapsed) ?? this.recent[0]
      ?? this.get('faces') ?? this.#sorted(this.windows)[0] ?? null
  }

  /** Put a game at a place in the line of those seen last, and keep the line tidy. */
  #bring(win, at, keep = null) {
    this.#used.add(win)
    this.recent = this.recent.filter((w) => w !== win)
    this.recent.splice(at, 0, win)
    this.#settle({ refill: false, keep })
  }

  /**
   * Keep the games open within what the layout allows: wide and tiled, see
   * #settleWide; in the column and floating, every game may be open.
   */
  #settle({ refill, keep = null }) {
    if (this.#wide) this.#settleWide({ refill, keep })
  }

  /**
   * Wide and tiled: of the games beside the master, one at most is open —
   * `keep` if it is one of them, else the one seen last. With `refill`, a
   * game waiting comes back when none beside the master is open.
   */
  #settleWide({ refill, keep }) {
    const master = this.#pickMaster()
    const beside = this.recent.filter((w) => w !== master)
    const open = beside.filter((w) => !w.collapsed)
    const stays = open.includes(keep) ? keep : open[0]
    for (const win of open) {
      if (win === stays) continue
      win.collapsed = true
      store.set(`wm:collapsed:${win.id}`, true)
    }
    if (refill && !stays && beside.length && master?.kind === 'table') this.#open(beside[0])
  }

  setMode(mode) {
    if (mode === this.mode) return
    if (mode === 'floating') {
      // Float from where things are now, so switching is not a rearrangement.
      for (const w of this.windows) {
        if (!this.floatRects.has(w.id)) this.floatRects.set(w.id, this.#rectOf(w))
      }
      this.#saveFloat()
    }
    this.mode = mode
    store.set('wm:mode', mode)
    this.#settle({ refill: false })
    this.layout()
    this.onChange()
  }

  /**
   * Put every floating window back where tiling would put it. Windows can be
   * dragged nearly off the desk; this is how they come back.
   */
  resetFloating() {
    this.mode = 'tiled'
    this.layout()
    for (const w of this.windows) this.floatRects.set(w.id, this.#rectOf(w))
    this.mode = 'floating'
    this.#saveFloat()
    this.layout()
  }

  /** A collapsed window's height: its title bar and border, as styled now. */
  #title() {
    const bar = this.desk.querySelector('.win-title')
    if (!bar) return TITLE
    const cs = getComputedStyle(bar.parentElement)
    return bar.offsetHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
  }

  layout() {
    const W = this.desk.clientWidth
    if (!W) return
    this.gutter.hidden = true
    for (const g of this.hgutters) g.remove()
    this.hgutters = []
    // A phone's column scrolls, so it sets the desk's height rather than
    // fitting inside one — and has no height to wait for.
    if (this.narrow) {
      this.#wasWide = false
      this.desk.classList.remove('floating')
      for (const w of this.windows) w.el.classList.remove('side')
      this.#buttons()
      return this.#scroll(this.#sorted(this.windows), W)
    }
    if (this.desk.style.height) this.desk.style.height = ''
    const H = this.desk.clientHeight
    if (!H) return
    const floating = this.mode === 'floating'
    this.desk.classList.toggle('floating', floating)
    if (floating) {
      this.#wasWide = false
      for (const w of this.windows) w.el.classList.remove('side')
      this.#buttons()
      return this.#layoutFloating(W, H)
    }

    const tables = this.windows.filter((w) => w.kind === 'table')
    const master = this.#pickMaster()
    this.master = master
    // The master is never a title bar here.
    this.#open(master)
    // Widened from the column, where every game could be open: back within
    // the master and one beside it, the one seen last.
    if (!this.#wasWide) this.#settleWide({ refill: false, keep: null })
    this.#wasWide = true
    this.#buttons(tables.length > 0)
    // Games in the stack beside the master are shown small: just the game.
    for (const t of tables) t.el.classList.toggle('side', t !== master)
    const rest = this.#sorted(this.windows.filter((w) => w !== master))

    if (!master) return
    if (rest.length === 0) {
      this.#place(master, 0, 0, W, H)
      return
    }
    const mw = Math.round(W * this.mfact - GAP / 2)
    this.#place(master, 0, 0, mw, master.collapsed ? this.#title() : H)
    const stackBottom = this.#column(rest, mw + GAP, 0, W - mw - GAP, H)

    // The divider sits in the gap the shadow leaves, and only as tall as the
    // windows beside it: next to the stack when everything in it is
    // collapsed.
    const reach = Math.min(H, stackBottom)
    this.gutter.hidden = false
    Object.assign(this.gutter.style, { left: `${mw + LIFT}px`, top: '0px', width: `${GAP - LIFT}px`, height: `${reach}px` })
  }

  #sorted(list) { return [...list].sort((a, b) => a.order - b.order) }

  /**
   * Which buttons a window's title bar shows. Wide and tiled: the master
   * none of collapse, but step back when there is a game to step back for;
   * an open window beside it, expand — the chat aside. Elsewhere, collapse.
   */
  #buttons(games = false) {
    const wide = this.#wide
    for (const w of this.windows) {
      const master = wide && w === this.master
      w.el.querySelector('.wbtn.collapse').hidden = master
      w.el.querySelector('.wbtn.retire').hidden = !(master && games)
      w.el.querySelector('.wbtn.expand').hidden = !(wide && !master && !w.collapsed && w.id !== 'chat')
    }
  }

  /**
   * Stack windows in a column: collapsed ones take a title bar, the rest share
   * the height by weight, with a divider between each two open neighbours.
   * Returns where the column ends.
   */
  #column(list, x, y, w, h) {
    const open = list.filter((win) => !win.collapsed)
    const fixed = list.length * GAP - GAP + (list.length - open.length) * this.#title()
    const share = Math.max(0, h - fixed)
    const weights = open.reduce((sum, win) => sum + win.weight, 0) || 1
    let top = y
    const bottoms = [] // where each window ends, for the dividers
    list.forEach((win) => {
      const height = win.collapsed ? this.#title() : Math.round(share * win.weight / weights)
      this.#place(win, x, top, w, height)
      bottoms.push(top + height)
      top += height + GAP
    })
    // A divider between every two open windows, collapsed ones between them
    // or not, each trading height between those two alone. It sits where one
    // kind of window meets another: just under a panel above, just over a
    // panel below — under the peers and over the chat, the games between.
    for (let i = 0; i < open.length - 1; i++) {
      const above = open[i]
      const below = open[i + 1]
      const a = list.indexOf(above)
      const b = list.indexOf(below)
      const at = above.kind !== 'table' ? a : b - 1
      this.#hgutter(above, below, x, bottoms[at], w)
    }
    return open.length ? y + h : top - GAP
  }

  /** A divider between two open windows in the stack, trading height between them. */
  #hgutter(above, below, x, y, w) {
    const g = document.createElement('div')
    g.className = 'hgutter'
    g.title = 'drag to resize'
    Object.assign(g.style, { left: `${x}px`, top: `${y + LIFT}px`, width: `${w}px`, height: `${GAP - LIFT}px` })
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      // Each step lays the windows out again, which replaces this divider,
      // so the drag is followed on the window rather than on the element.
      const a = above.el.getBoundingClientRect()
      const b = below.el.getBoundingClientRect()
      const span = a.height + b.height
      const total = above.weight + below.weight
      const from = e.clientY
      // Followed by how far the pointer moved, so windows collapsed between
      // the two make no difference.
      const move = (ev) => {
        const ha = Math.min(span - MIN_H, Math.max(MIN_H, a.height + ev.clientY - from))
        above.weight = total * ha / span
        below.weight = total - above.weight
        this.layout()
      }
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return
        store.set(`wm:weight:${above.id}`, above.weight)
        store.set(`wm:weight:${below.id}`, below.weight)
        document.body.classList.remove('resizing-rows')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      document.body.classList.add('resizing-rows')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    })
    this.desk.append(g)
    this.hgutters.push(g)
  }

  /**
   * On a phone, one column that scrolls, every window at a natural height for
   * its kind: a game nearly square so its board is playable, the peers
   * short, the chat a strip.
   */
  #scroll(list, W) {
    const natural = (win) => win.collapsed ? this.#title()
      : win.phoneHeight ? Math.round(win.phoneHeight(W))
      : win.kind === 'table' ? Math.round(W * 0.95 + 110)
      : win.id === 'faces' ? Math.round(W * 0.62)
      : 300
    let top = 0
    for (const win of list) {
      const h = natural(win)
      this.#place(win, 0, top, W, h)
      top += h + GAP
    }
    const height = `${Math.max(0, top - GAP)}px`
    if (this.desk.style.height !== height) this.desk.style.height = height
  }

  #place(win, x, y, w, h) {
    win.el.classList.toggle('collapsed', win.collapsed)
    // Its button sounds what it does: a slide down to fold, up to open.
    const fold = win.el.querySelector('.wbtn.collapse')
    if (fold) fold.dataset.sound = win.collapsed ? 'on' : 'off'
    Object.assign(win.el.style, {
      left: `${x}px`, top: `${y}px`, width: `${w}px`, height: win.collapsed ? '' : `${h}px`,
    })
  }

  #rectOf(win) {
    return { x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.collapsed ? 360 : win.el.offsetHeight }
  }

  #saveFloat() { store.set('wm:float', Object.fromEntries(this.floatRects)) }

  #layoutFloating(W, H) {
    let cascade = 0
    for (const win of this.windows) {
      let r = this.floatRects.get(win.id)
      if (!r) {
        r = { x: 40 + cascade * 28, y: 30 + cascade * 28, w: Math.min(560, W - 80), h: Math.min(420, H - 60) }
        cascade++
        this.floatRects.set(win.id, r)
      }
      // Keep a title bar reachable whatever the window size did.
      r.x = Math.min(Math.max(r.x, -r.w + 80), W - 80)
      r.y = Math.min(Math.max(r.y, 0), H - this.#title())
      this.#place(win, r.x, r.y, r.w, r.h)
    }
  }

  #dragWindow(win) {
    const title = win.el.querySelector('.win-title')
    title.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'floating' || this.narrow || e.target.closest('button') || this.#corner(win, e)) return
      e.preventDefault()
      const r = this.floatRects.get(win.id)
      const start = { x: e.clientX, y: e.clientY, rx: r.x, ry: r.y }
      title.setPointerCapture(e.pointerId)
      const move = (ev) => {
        r.x = start.rx + ev.clientX - start.x
        r.y = start.ry + ev.clientY - start.y
        this.layout()
      }
      const up = () => {
        this.#saveFloat()
        title.removeEventListener('pointermove', move)
        title.removeEventListener('pointerup', up)
      }
      title.addEventListener('pointermove', move)
      title.addEventListener('pointerup', up)
    })
  }

  /** Which corner of an open floating window a pointer is at, if any: 'nw', 'ne', 'sw' or 'se'. */
  #corner(win, e) {
    if (this.mode !== 'floating' || this.narrow || win.collapsed) return null
    const box = win.el.getBoundingClientRect()
    const v = e.clientY - box.top < CORNER ? 'n' : box.bottom - e.clientY < CORNER ? 's' : null
    const h = e.clientX - box.left < CORNER ? 'w' : box.right - e.clientX < CORNER ? 'e' : null
    return v && h ? v + h : null
  }

  /**
   * Resize from any corner. No grip is drawn: the pointer changes as it
   * reaches a corner, and a collapsed window does not resize at all.
   */
  #resizeWindow(win) {
    win.el.addEventListener('pointermove', (e) => {
      if (e.buttons) return
      const c = this.#corner(win, e)
      win.el.style.cursor = c ? (c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize') : ''
    })
    win.el.addEventListener('pointerleave', () => { win.el.style.cursor = '' })
    win.el.addEventListener('pointerdown', (e) => {
      const c = this.#corner(win, e)
      if (!c) return
      e.preventDefault()
      e.stopPropagation()
      this.focus(win)
      const r = this.floatRects.get(win.id)
      const start = { x: e.clientX, y: e.clientY, rx: r.x, ry: r.y, rw: r.w, rh: r.h }
      win.el.setPointerCapture(e.pointerId)
      const move = (ev) => {
        const dx = ev.clientX - start.x
        const dy = ev.clientY - start.y
        if (c.includes('e')) r.w = Math.max(MIN_W, start.rw + dx)
        if (c.includes('s')) r.h = Math.max(MIN_H, start.rh + dy)
        if (c.includes('w')) { r.w = Math.max(MIN_W, start.rw - dx); r.x = start.rx + start.rw - r.w }
        if (c.includes('n')) { r.h = Math.max(MIN_H, start.rh - dy); r.y = start.ry + start.rh - r.h }
        this.layout()
      }
      const up = () => {
        this.#saveFloat()
        win.el.removeEventListener('pointermove', move)
        win.el.removeEventListener('pointerup', up)
      }
      win.el.addEventListener('pointermove', move)
      win.el.addEventListener('pointerup', up)
    }, true)
  }

  #dragGutter() {
    this.gutter.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.gutter.setPointerCapture(e.pointerId)
      const box = this.desk.getBoundingClientRect()
      const move = (ev) => {
        this.mfact = Math.min(0.8, Math.max(0.35, (ev.clientX - box.left) / box.width))
        this.layout()
      }
      const up = () => {
        store.set('wm:mfact', this.mfact)
        this.gutter.removeEventListener('pointermove', move)
        this.gutter.removeEventListener('pointerup', up)
      }
      this.gutter.addEventListener('pointermove', move)
      this.gutter.addEventListener('pointerup', up)
    })
  }
}
