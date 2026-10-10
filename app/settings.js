import { store, theme, setTheme } from './store.js'
import { cleanName, NAME_MAX } from './limits.js'
import { sound } from '../games/kit/sound.js'
import { colourButton } from '../games/kit/colours.js'
import { avatar, randomCharacter, REFRESH } from './avatar.js'

/**
 * The settings menu, as one panel used in two places: on the landing page,
 * where it has only the theme and sounds (who you are is right there on the
 * page), and in a room, where it also has your identity, the windows, the
 * cursors and your saved data.
 *
 * It is rebuilt each time it opens, so it always shows what is true now.
 */
export function settingsPanel({ room = null, wm = null, cursors = null, colour, onColour, character, onCharacter, onNick, onRoomsChanged, identity = true, saved: savedData = true } = {}) {
  const el = document.createElement('div')
  el.className = 'settings'

  const render = () => {
    const t = theme()
    el.innerHTML = `
      ${identity ? `
      <section>
        <div class="identity">
          ${character ? `
          <span class="character-preview self-colour" style="--who: ${colour?.() ?? 'var(--sky)'}">${avatar(character())}
            <button type="button" class="btn icon reroll" title="another character" aria-label="another character">${REFRESH}</button>
          </span>` : ''}
          <form class="row name-form">
            <input class="input" name="nick" maxlength="${NAME_MAX}" autocomplete="nickname" aria-label="your name" placeholder="name">
          </form>
        </div>
      </section>` : ''}

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
        <h3>peer cursors</h3>
        <span class="segmented cursors">
          ${['show', 'characters', 'hide'].map((v) => `<button class="btn small" data-cursors="${v}" aria-pressed="${cursors.mode === v}">${v}</button>`).join('')}
        </span>
      </section>` : ''}

      <section>
        <h3>sounds</h3>
        <span class="segmented sounds">
          ${['on', 'quiet', 'off'].map((v) => `<button class="btn small" data-sound-level="${v}" aria-pressed="${sound.level === v}">${v}</button>`).join('')}
        </span>
      </section>

      ${savedData ? `
      <section>
        <h3>saved data</h3>
        <div class="row">
          <button class="btn small export">export</button>
          <button class="btn small import">import</button>
          <button class="btn small berry clear">clear</button>
          <input type="file" accept="application/json,.json" hidden>
        </div>
      </section>` : ''}`

    if (!identity) return
    el.querySelector('[name=nick]').value = savedNick()
    if (colour && onColour) el.querySelector('.name-form').prepend(colourButton({ value: colour(), onPick: onColour }))
  }

  // Like everything else here, a name applies as it is typed: everyone sees
  // it a moment after you stop. An empty field changes nothing, and gives
  // the name back when you leave it.
  let saved = null
  const savedNick = () => saved ?? cleanName(room?.nick || store.get('nick', ''))
  const field = () => el.querySelector('[name=nick]')
  let typing = null
  const apply = () => {
    clearTimeout(typing)
    const nick = cleanName(field().value)
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
    if (b.dataset.cursors) { cursors.setMode(b.dataset.cursors); render() }
    if (b.dataset.soundLevel) { sound.setLevel(b.dataset.soundLevel); render() }
    if (b.classList.contains('reroll')) {
      onCharacter?.(randomCharacter(character()))
      el.querySelector('.character-preview .avatar-face').outerHTML = avatar(character())
    }
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
  <path fill-rule="evenodd" d="M4.5 12a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0Z M8.8 12a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0Z"/></g></svg>`
