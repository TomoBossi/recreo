import { devicePickers } from './devices.js'

/**
 * The Peers window's menu, beside its microphone and camera buttons: how
 * the faces are laid out, and which camera and microphone to use.
 *
 * It opens in a layer of its own, so a small window never clips it.
 */
const LAYOUTS = [
  { value: 'auto', label: 'auto', hint: 'whoever speaks takes the big tile, then the grid comes back' },
  { value: 'grid', label: 'grid', hint: 'everyone the same size' },
  { value: 'spotlight', label: 'spotlight', hint: 'always a big tile, for whoever spoke last' },
]

const DOTS = `<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><circle cx="3.5" cy="8" r="1.8"/><circle cx="8" cy="8" r="1.8"/><circle cx="12.5" cy="8" r="1.8"/></g></svg>`

export function peersMenuButton({ media, faces }) {
  const button = document.createElement('button')
  button.className = 'wbtn media menu'
  button.title = 'layout and devices'
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
      <p class="hint"></p>
    </section>
    <section class="devices">
      <h3>devices</h3>
    </section></div>`
  // One set of pickers for the life of the room; they keep themselves current.
  const pickers = devicePickers(media)
  pop.querySelector('.devices').append(pickers.el)
  document.body.append(pop)

  const show = () => {
    const mode = faces()?.mode ?? 'auto'
    for (const b of pop.querySelectorAll('[data-layout]')) b.setAttribute('aria-pressed', String(b.dataset.layout === mode))
    pop.querySelector('.hint').textContent = LAYOUTS.find((l) => l.value === mode)?.hint ?? ''
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
