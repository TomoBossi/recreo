/**
 * Everything recreo remembers, in this browser only: your name, the theme,
 * whether cursors are shown, how the windows were arranged, and the rooms you
 * have been in. All of it lives under one prefix in localStorage, so it can
 * be exported, imported and cleared as one.
 *
 * Every access is guarded: a private window, blocked storage or a full quota
 * makes recreo forget, never break.
 */

const PREFIX = 'recreo:'
const MAX_ROOMS = 5

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch {
      return fallback
    }
  },

  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)) } catch { /* forgetting is fine */ }
  },

  remove(key) {
    try { localStorage.removeItem(PREFIX + key) } catch { /* nothing to forget */ }
  },

  /** Every key recreo owns, without the prefix. */
  keys() {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length))
    } catch {
      return []
    }
  },

  /** All of it, as a file someone can keep. */
  export() {
    const data = {}
    for (const key of this.keys()) data[key] = this.get(key)
    return { app: 'recreo', version: 1, exported: new Date().toISOString(), data }
  },

  /** Replace what is remembered with a file exported earlier. */
  import(file) {
    if (file?.app !== 'recreo' || typeof file.data !== 'object' || !file.data) {
      throw new Error('that is not a recreo settings file')
    }
    this.clear()
    for (const [key, value] of Object.entries(file.data)) {
      if (typeof key === 'string' && key.length < 100) this.set(key, value)
    }
  },

  clear() {
    for (const key of this.keys()) this.remove(key)
  },

  // ------------------------------------------------------------- rooms

  rooms() {
    const list = this.get('rooms', [])
    return Array.isArray(list) ? list.filter((r) => r && typeof r.code === 'string') : []
  },

  /** Remember a room as the most recent one. */
  visit(code) {
    const rooms = [{ code, at: Date.now() }, ...this.rooms().filter((r) => r.code !== code)].slice(0, MAX_ROOMS)
    this.set('rooms', rooms)
  },

  forget(code) {
    this.set('rooms', this.rooms().filter((r) => r.code !== code))
  },
}

// ------------------------------------------------------------------ theme

const dark = matchMedia('(prefers-color-scheme: dark)')

/** 'auto', 'light' or 'dark'. */
export function theme() {
  const t = store.get('theme', 'auto')
  return ['auto', 'light', 'dark'].includes(t) ? t : 'auto'
}

/** Paint the page in the chosen theme, following the system when on auto. */
export function applyTheme() {
  const t = theme()
  const resolved = t === 'auto' ? (dark.matches ? 'dark' : 'light') : t
  document.documentElement.dataset.theme = resolved
}

export function setTheme(t) {
  store.set('theme', t)
  applyTheme()
}

dark.addEventListener('change', applyTheme)
applyTheme()

/** "3 days ago", "just now": when a room was last visited. */
export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
