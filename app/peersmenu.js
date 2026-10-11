import { devicePickers } from './devices.js'
import { fill } from './controls.js'

/**
 * The Peers window's menu, beside its microphone and camera buttons: how
 * the faces are laid out, which camera and microphone to use, and how loud
 * each of the others is. A volume belongs to the player, so it holds when
 * they reconnect, and is kept in this browser.
 *
 * It opens in a layer of its own, so a small window never clips it.
 */
const LAYOUTS = [
  { value: 'auto', label: 'auto' },
  { value: 'grid', label: 'grid' },
  { value: 'spotlight', label: 'spotlight' },
]

const DOTS = `<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><circle cx="3.5" cy="8" r="1.8"/><circle cx="8" cy="8" r="1.8"/><circle cx="12.5" cy="8" r="1.8"/></g></svg>`

export function peersMenuButton({ media, faces }) {
  const button = document.createElement('button')
  button.className = 'wbtn media menu'
  button.title = 'layout, volume and devices'
  button.setAttribute('aria-label', button.title)
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-expanded', 'false')
  button.innerHTML = DOTS

  const pop = document.createElement('div')
  pop.className = 'popover peers-menu'
  pop.hidden = true
  pop.innerHTML = `<div class="settings">
    <section>
      <h3>layout</h3>
      <span class="segmented layouts">
        ${LAYOUTS.map((l) => `<button class="btn small" data-layout="${l.value}">${l.label}</button>`).join('')}
      </span>
    </section>
    <section class="devices"></section>
    <section class="volumes"><h3>volume</h3><div class="volume-rows"></div></section></div>`
  // One set of pickers for the life of the room; they keep themselves current.
  const pickers = devicePickers(media)
  pop.querySelector('.devices').append(pickers.el)
  document.body.append(pop)

  // A slider for each of the others, rebuilt as people come and go.
  const volumes = () => {
    const f = faces()
    const rows = pop.querySelector('.volume-rows')
    const others = f ? [...f.room.peers.values()].map((p) => ({ player: p.presence.player ?? p.id, nick: p.nick || '…' })) : []
    pop.querySelector('.volumes').hidden = !others.length
    const key = JSON.stringify(others)
    if (rows.dataset.key === key) return
    rows.dataset.key = key
    rows.replaceChildren(...others.map(({ player, nick }) => {
      const row = document.createElement('label')
      row.className = 'volume-row'
      row.innerHTML = `<span class="who"></span><span class="slider-box"><input type="range" class="slider" min="0" max="1" step="0.05"></span>`
      row.querySelector('.who').textContent = nick
      const input = row.querySelector('input')
      input.setAttribute('aria-label', `${nick}'s volume`)
      input.value = String(f.volumeOf(player))
      fill(input)
      input.addEventListener('input', () => { fill(input); f.setVolume(player, Number(input.value)) })
      return row
    }))
  }

  // The window comes after its menu: listen to the room once it is there.
  let listening = false
  const show = () => {
    if (!listening && faces()) {
      listening = true
      for (const event of ['peer:join', 'peer:leave', 'peer:update']) faces().room.on(event, () => { if (!pop.hidden) volumes() })
    }
    volumes()
    const mode = faces()?.mode ?? 'auto'
    for (const b of pop.querySelectorAll('[data-layout]')) b.setAttribute('aria-pressed', String(b.dataset.layout === mode))
    pop.querySelector('.devices').hidden = pickers.el.hidden
  }
  const place = () => {
    const r = button.getBoundingClientRect()
    pop.style.setProperty('--pop-top', `${Math.round(r.bottom + 10)}px`)
    pop.style.top = `${Math.round(r.bottom + 10)}px`
    pop.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`
  }
  const toggle = (open = pop.hidden) => {
    if (open) { show(); place() }
    pop.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  button.addEventListener('click', (e) => { e.stopPropagation(); toggle() })
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-layout]')
    if (!b) return
    faces()?.setMode(b.dataset.layout)
    show()
  })
  document.addEventListener('pointerdown', (e) => {
    if (!button.isConnected) { pop.remove(); return } // the room was left
    if (!pop.hidden && !pop.contains(e.target) && !button.contains(e.target)) toggle(false)
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) toggle(false) })
  addEventListener('resize', () => { if (!pop.hidden) place() })
  // Picking a device lists them again; keep the menu's devices section in step.
  media.on('devices', () => setTimeout(show, 0))
  media.on('stream', () => setTimeout(show, 0))
  return button
}
