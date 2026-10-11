/**
 * A small dropdown, drawn like the rest of recreo: a button showing the
 * current choice, and a list of the others beneath it. The browser's own
 * <select> would look like nothing else here, and differently everywhere.
 *
 *   const el = select({ value: '10m', choices: [{ value, label }], onPick, label: 'clock' })
 *
 * Pass `anchor` for one others' pointers can be over (see app/cursors.js).
 *
 * Arrow keys move through the list, Enter picks, Escape closes; clicking
 * anywhere else closes it too.
 *
 * The open list floats over everything, fixed to the screen beside its
 * button, so a panel that scrolls or clips — the settings, a menu — never
 * cuts it off or grows scrollbars round it. It opens below the button, or
 * above when there is more room there, and follows the button if the page
 * under it scrolls. (Fixed works as long as nothing round a dropdown is
 * transformed: a transform would become its frame instead of the screen.)
 */
export function select({ value, choices, onPick, label, open = false, onToggle, anchor }) {
  const wrap = document.createElement('span')
  wrap.className = 'select'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn small select-button'
  button.setAttribute('aria-haspopup', 'listbox')
  button.setAttribute('aria-label', label)
  const current = choices.find((c) => c.value === value) ?? choices[0]
  button.innerHTML = '<span class="value"></span><svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  button.querySelector('.value').textContent = current.label
  // Shared pointers: each choice is a place named `${anchor}:${value}`; the
  // button is the chosen one's, which is where the others see its name.
  if (anchor) button.dataset.cursorAnchor = `${anchor}:${current.value}`

  const list = document.createElement('ul')
  list.className = 'select-list'
  list.role = 'listbox'
  let active = Math.max(0, choices.indexOf(current))
  for (const [i, choice] of choices.entries()) {
    const li = document.createElement('li')
    li.role = 'option'
    li.textContent = choice.label
    li.dataset.i = i
    if (anchor) li.dataset.cursorAnchor = `${anchor}:${choice.value}`
    li.setAttribute('aria-selected', String(choice === current))
    list.append(li)
  }
  wrap.append(button, list)

  const mark = () => [...list.children].forEach((li, i) => li.classList.toggle('active', i === active))
  /** Put the open list beside its button, on screen, as tall as there is room for. */
  const place = () => {
    if (list.hidden || !wrap.isConnected) return
    // The wrapper, not the button: a button shifts a pixel while hovered
    // or pressed, and the list should line up with where it rests.
    const b = wrap.getBoundingClientRect()
    const gap = 6
    const margin = 8
    list.style.minWidth = `${b.width}px`
    list.style.maxHeight = ''
    const natural = list.scrollHeight
    const below = innerHeight - b.bottom - gap - margin
    const above = b.top - gap - margin
    const up = natural > below && above > below
    const room = Math.max(80, up ? above : below)
    list.style.maxHeight = natural > room ? `${room}px` : ''
    const height = Math.min(natural, room)
    list.style.top = `${Math.round(up ? b.top - gap - height : b.bottom + gap)}px`
    const width = list.offsetWidth
    list.style.left = `${Math.round(Math.max(margin, Math.min(b.left, innerWidth - margin - width)))}px`
  }
  const follow = () => place()
  const setOpen = (next) => {
    list.hidden = !next
    button.setAttribute('aria-expanded', String(next))
    if (next) {
      active = Math.max(0, choices.indexOf(current))
      mark()
      // Built open, it is not on the page yet: place it once it is.
      if (wrap.isConnected) place()
      else requestAnimationFrame(place)
      addEventListener('scroll', follow, { capture: true, passive: true })
      addEventListener('resize', follow)
    } else {
      removeEventListener('scroll', follow, { capture: true })
      removeEventListener('resize', follow)
    }
    onToggle?.(next)
  }
  const pick = (i) => {
    setOpen(false)
    if (choices[i] && choices[i] !== current) onPick(choices[i].value)
  }

  button.addEventListener('click', () => setOpen(list.hidden))
  list.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const li = e.target.closest('li')
    if (li) pick(Number(li.dataset.i))
  })
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setOpen(false); button.focus(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (list.hidden) return setOpen(true)
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
      mark()
    } else if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault()
      pick(active)
    }
  })
  // Clicking elsewhere closes it; once it has left the page, it stops listening.
  const outside = (e) => {
    if (!wrap.isConnected) {
      document.removeEventListener('pointerdown', outside)
      removeEventListener('scroll', follow, { capture: true })
      removeEventListener('resize', follow)
      return
    }
    if (!list.hidden && !wrap.contains(e.target)) setOpen(false)
  }
  document.addEventListener('pointerdown', outside)

  setOpen(open)
  return wrap
}
