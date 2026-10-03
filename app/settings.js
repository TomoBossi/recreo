import { store, theme, setTheme } from './store.js'
import { colourButton } from './colours.js'

/**
 * The settings menu, as one panel used in two places: on the landing page
 * (name, theme, saved data) and in a room, where it also arranges the
 * windows and shows or hides cursors.
 *
 * It is rebuilt each time it opens, so it always shows what is true now.
 */
export function settingsPanel({ room = null, wm = null, cursors = null, colour, onColour, onNick, onRoomsChanged } = {}) {
  const el = document.createElement('div')
  el.className = 'settings'

  const render = () => {
    const t = theme()
    el.innerHTML = `
      <section>
        <h3>your name and colour</h3>
        <form class="row name-form">
          <input class="input" name="nick" maxlength="24" autocomplete="nickname" aria-label="your name">
        </form>
      </section>

      <section>
        <h3>theme</h3>
        <span class="segmented theme">
          ${['auto', 'light', 'dark'].map((v) => `<button class="btn small" data-theme="${v}" aria-pressed="${t === v}">${v}</button>`).join('')}
        </span>
      </section>

      ${wm ? `
      <section>
        <h3>layout</h3>
        <div class="row">
          <span class="segmented mode">
            ${['tiled', 'floating'].map((v) => `<button class="btn small" data-mode="${v}" aria-pressed="${wm.mode === v}">${v}</button>`).join('')}
          </span>
          ${wm.mode === 'floating' ? '<button class="btn small reset">reset windows</button>' : ''}
        </div>
      </section>` : ''}

      ${cursors ? `
      <section>
        <h3>cursors</h3>
        <span class="segmented cursors">
          ${['show', 'hide'].map((v) => `<button class="btn small" data-cursors="${v}" aria-pressed="${cursors.enabled === (v === 'show')}">${v}</button>`).join('')}
        </span>
      </section>` : ''}

      <section>
        <h3>saved data</h3>
        <div class="row">
          <button class="btn small export">export</button>
          <button class="btn small import">import</button>
          <button class="btn small berry clear">clear</button>
          <input type="file" accept="application/json,.json" hidden>
        </div>
      </section>`

    el.querySelector('[name=nick]').value = savedNick()
    if (colour && onColour) el.querySelector('.name-form').prepend(colourButton({ value: colour(), onPick: onColour }))
  }

  // Like everything else here, a name applies as it is typed: everyone sees
  // it a moment after you stop. An empty field changes nothing, and gives
  // the name back when you leave it.
  let saved = null
  const savedNick = () => saved ?? (room?.nick || store.get('nick', ''))
  const field = () => el.querySelector('[name=nick]')
  let typing = null
  const apply = () => {
    clearTimeout(typing)
    const nick = field().value.trim().slice(0, 24)
    if (!nick || nick === savedNick()) return
    saved = nick
    store.set('nick', nick)
    onNick?.(nick)
  }
  el.addEventListener('input', (e) => {
    if (e.target.name !== 'nick') return
    clearTimeout(typing)
    typing = setTimeout(apply, 300)
  })
  el.addEventListener('focusout', (e) => {
    if (e.target.name !== 'nick') return
    apply()
    if (!field().value.trim()) field().value = savedNick()
  })
  el.addEventListener('submit', (e) => {
    e.preventDefault()
    apply()
    field().blur()
  })

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.theme) { setTheme(b.dataset.theme); render() }
    if (b.dataset.mode) { wm.setMode(b.dataset.mode); render() }
    if (b.dataset.cursors) { cursors.setEnabled(b.dataset.cursors === 'show'); render() }
    if (b.classList.contains('reset')) wm.resetFloating()
    if (b.classList.contains('export')) download(store.export())
    if (b.classList.contains('import')) el.querySelector('input[type=file]').click()
    if (b.classList.contains('clear')) {
      if (b.dataset.armed) {
        store.clear()
        onRoomsChanged?.()
        render()
      } else {
        // Clearing asks once, inline: a second press within a few seconds.
        b.dataset.armed = '1'
        b.textContent = 'really clear?'
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'clear' } }, 3000)
      }
    }
  })

  el.addEventListener('change', async (e) => {
    if (e.target.type === 'file' && e.target.files[0]) {
      try {
        store.import(JSON.parse(await e.target.files[0].text()))
        setTheme(theme())
        onRoomsChanged?.()
        render()
      } catch (err) {
        alertIn(el, err.message)
      }
    }
  })

  render()
  return { el, render }
}

function download(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `recreo-settings-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function alertIn(el, text) {
  const p = document.createElement('p')
  p.className = 'hint error'
  p.textContent = text
  el.append(p)
  setTimeout(() => p.remove(), 4000)
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/** The gear drawn for the settings button: teeth around a ring, and a hole. */
export const GEAR = `<svg class="gear" viewBox="0 0 24 24" aria-hidden="true">
  <g fill="currentColor">${Array.from({ length: 8 }, (_, i) => `<rect x="10" y="1" width="4" height="6" rx="1" transform="rotate(${i * 45} 12 12)"/>`).join('')}
  <circle cx="12" cy="12" r="7.5"/></g>
  <circle cx="12" cy="12" r="3.2" fill="var(--panel)"/></svg>`
