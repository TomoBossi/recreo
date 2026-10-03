/**
 * A small window manager for the room.
 *
 * Everything in the room is a window — each table, the faces, the chat — and
 * there are two ways to arrange them. Tiled, after dwm: one window is the
 * master and takes most of the width, everything else stacks in a column
 * beside it, and a divider between the two can be dragged. Floating: windows
 * go wherever they are dragged, at whatever size they are given. Any window
 * collapses to its title bar in either mode.
 *
 * On a narrow screen there is no room for two columns, so tiling becomes a
 * single column and floating is not offered.
 */

const GAP = 14
const TITLE = 34
const NARROW = 760
const MIN_W = 220
const MIN_H = 120

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`recreo:wm:${key}`)) ?? fallback } catch { return fallback }
  },
  set(key, value) {
    try { localStorage.setItem(`recreo:wm:${key}`, JSON.stringify(value)) } catch { /* private mode */ }
  },
}

export class WindowManager {
  /** @param {HTMLElement} desk */
  constructor(desk) {
    this.desk = desk
    this.windows = []
    this.mode = store.get('mode', 'tiled')
    this.mfact = store.get('mfact', 0.68)
    this.master = null
    this.floatRects = new Map()
    this.z = 1
    this.onChange = () => {}

    this.gutter = document.createElement('div')
    this.gutter.className = 'gutter'
    this.gutter.title = 'drag to resize'
    desk.append(this.gutter)
    this.#dragGutter()

    new ResizeObserver(() => this.layout()).observe(desk)
  }

  get narrow() { return this.desk.clientWidth < NARROW }

  /**
   * Add a window.
   *
   * `kind` decides tiling: a table may be the master, a panel never is unless
   * there is nothing else. `weight` is how much of the stack's height a
   * window wants relative to its neighbours. `order` sorts the stack.
   */
  add({ id, title, meta = '', tone = 'sun', body, kind = 'panel', weight = 1, order = 0, closable = false, collapsed = false, onClose }) {
    const el = document.createElement('section')
    el.className = `win tone-${tone}`
    el.dataset.id = id
    el.innerHTML = `
      <div class="win-title">
        <span class="title"></span>
        <span class="meta"></span>
        <button class="wbtn collapse" title="collapse" aria-label="collapse"></button>
        ${closable ? '<button class="wbtn close" title="close" aria-label="close"></button>' : ''}
      </div>
      <div class="win-body"></div>`
    el.querySelector('.win-body').append(body)

    const win = {
      id, el, kind, weight, order, onClose,
      collapsed: store.get(`collapsed:${id}`, collapsed),
      setTitle: (text) => { el.querySelector('.title').textContent = text },
      setMeta: (text) => { el.querySelector('.meta').textContent = text },
      setTone: (t) => { el.className = el.className.replace(/tone-\S+/, `tone-${t}`) },
      collapse: (on = !win.collapsed) => {
        win.collapsed = on
        store.set(`collapsed:${id}`, on)
        this.layout()
      },
      close: () => this.remove(win),
    }
    win.setTitle(title)
    win.setMeta(meta)

    el.querySelector('.wbtn.collapse').addEventListener('click', (e) => { e.stopPropagation(); win.collapse() })
    el.querySelector('.wbtn.close')?.addEventListener('click', (e) => { e.stopPropagation(); win.onClose ? win.onClose() : win.close() })
    el.addEventListener('pointerdown', () => this.focus(win))
    el.querySelector('.win-title').addEventListener('dblclick', () => win.collapse())
    this.#dragWindow(win)

    this.windows.push(win)
    this.desk.append(el)
    this.layout()
    return win
  }

  remove(win) {
    this.windows = this.windows.filter((w) => w !== win)
    win.el.remove()
    if (this.master === win) this.master = null
    this.layout()
  }

  get(id) { return this.windows.find((w) => w.id === id) }

  /**
   * Bring a window forward. A table becomes the master when tiled; any
   * window is raised when floating.
   */
  focus(win, { expand = false } = {}) {
    if (expand && win.collapsed) win.collapse(false)
    for (const w of this.windows) w.el.classList.toggle('focused', w === win)
    win.el.style.zIndex = String(++this.z)
    if (win.kind === 'table' && this.master !== win) {
      this.master = win
      this.layout()
    }
  }

  setMode(mode) {
    if (mode === this.mode) return
    if (mode === 'floating') {
      // Float from where things are now, so switching is not a rearrangement.
      for (const w of this.windows) {
        if (!this.floatRects.has(w.id)) this.floatRects.set(w.id, this.#rectOf(w))
      }
    }
    this.mode = mode
    store.set('mode', mode)
    this.layout()
    this.onChange()
  }

  layout() {
    const W = this.desk.clientWidth
    if (!W) return
    this.gutter.hidden = true
    // A phone's column scrolls, so it sets the desk's height rather than
    // fitting inside one — and has no height to wait for.
    if (this.narrow) {
      this.desk.classList.remove('floating')
      return this.#scroll(this.#sorted(this.windows), W)
    }
    if (this.desk.style.height) this.desk.style.height = ''
    const H = this.desk.clientHeight
    if (!H) return
    const floating = this.mode === 'floating'
    this.desk.classList.toggle('floating', floating)
    if (floating) return this.#layoutFloating(W, H)

    // A table is the master whenever there is one: the game is the stage.
    const tables = this.windows.filter((w) => w.kind === 'table')
    const kept = this.master && this.windows.includes(this.master)
      && (this.master.kind === 'table' || tables.length === 0)
    let master = kept ? this.master : tables[0]
    if (!master) master = this.#sorted(this.windows)[0]
    this.master = master
    const rest = this.#sorted(this.windows.filter((w) => w !== master))

    if (!master) return
    if (rest.length === 0) {
      this.#place(master, 0, 0, W, H)
      return
    }
    const mw = Math.round(W * this.mfact - GAP / 2)
    this.#place(master, 0, 0, mw, master.collapsed ? TITLE : H)
    this.#column(rest, mw + GAP, 0, W - mw - GAP, H)

    this.gutter.hidden = false
    Object.assign(this.gutter.style, { left: `${mw}px`, top: '0px', width: `${GAP}px`, height: `${H}px` })
  }

  #sorted(list) { return [...list].sort((a, b) => a.order - b.order) }

  /** Stack windows in a column: collapsed ones take a title bar, the rest share. */
  #column(list, x, y, w, h) {
    const open = list.filter((win) => !win.collapsed)
    const fixed = list.length * GAP - GAP + (list.length - open.length) * TITLE
    const share = Math.max(0, h - fixed)
    const weights = open.reduce((sum, win) => sum + win.weight, 0) || 1
    let top = y
    for (const win of list) {
      const height = win.collapsed ? TITLE : Math.round(share * win.weight / weights)
      this.#place(win, x, top, w, height)
      top += height + GAP
    }
  }

  /**
   * On a phone, one column that scrolls, every window at a natural height for
   * its kind: a table nearly square so its board is playable, the faces
   * short, the chat a strip. Squeezing them all into one screen made boards
   * the size of a thumbnail.
   */
  #scroll(list, W) {
    const natural = (win) => win.collapsed ? TITLE
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
    Object.assign(win.el.style, {
      left: `${x}px`, top: `${y}px`, width: `${w}px`, height: win.collapsed ? '' : `${h}px`,
    })
  }

  #rectOf(win) {
    return { x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight }
  }

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
      r.y = Math.min(Math.max(r.y, 0), H - TITLE)
      this.#place(win, r.x, r.y, r.w, r.h)
    }
  }

  #dragWindow(win) {
    const title = win.el.querySelector('.win-title')
    title.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'floating' || this.narrow || e.target.closest('button')) return
      e.preventDefault()
      const r = this.floatRects.get(win.id)
      const start = { x: e.clientX, y: e.clientY, rx: r.x, ry: r.y }
      title.setPointerCapture(e.pointerId)
      const move = (ev) => {
        r.x = start.rx + ev.clientX - start.x
        r.y = start.ry + ev.clientY - start.y
        this.layout()
      }
      const up = () => { title.removeEventListener('pointermove', move); title.removeEventListener('pointerup', up) }
      title.addEventListener('pointermove', move)
      title.addEventListener('pointerup', up)
    })

    // The resize grip is the window's bottom-right corner.
    win.el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'floating' || this.narrow || win.collapsed) return
      const box = win.el.getBoundingClientRect()
      if (e.clientX < box.right - 16 || e.clientY < box.bottom - 16) return
      e.preventDefault()
      const r = this.floatRects.get(win.id)
      const start = { x: e.clientX, y: e.clientY, w: r.w, h: r.h }
      win.el.setPointerCapture(e.pointerId)
      const move = (ev) => {
        r.w = Math.max(MIN_W, start.w + ev.clientX - start.x)
        r.h = Math.max(MIN_H, start.h + ev.clientY - start.y)
        this.layout()
      }
      const up = () => { win.el.removeEventListener('pointermove', move); win.el.removeEventListener('pointerup', up) }
      win.el.addEventListener('pointermove', move)
      win.el.addEventListener('pointerup', up)
    })
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
        store.set('mfact', this.mfact)
        this.gutter.removeEventListener('pointermove', move)
        this.gutter.removeEventListener('pointerup', up)
      }
      this.gutter.addEventListener('pointermove', move)
      this.gutter.addEventListener('pointerup', up)
    })
  }
}
