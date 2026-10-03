/**
 * A small dropdown, drawn like the rest of recreo: a button showing the
 * current choice, and a list of the others beneath it. The browser's own
 * <select> would look like nothing else here, and differently everywhere.
 *
 *   const el = select({ value: '10m', choices: [{ value, label }], onPick, label: 'clock' })
 *
 * Arrow keys move through the list, Enter picks, Escape closes; clicking
 * anywhere else closes it too.
 */
export function select({ value, choices, onPick, label, open = false, onToggle }) {
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

  const list = document.createElement('ul')
  list.className = 'select-list'
  list.role = 'listbox'
  let active = Math.max(0, choices.indexOf(current))
  for (const [i, choice] of choices.entries()) {
    const li = document.createElement('li')
    li.role = 'option'
    li.textContent = choice.label
    li.dataset.i = i
    li.setAttribute('aria-selected', String(choice === current))
    list.append(li)
  }
  wrap.append(button, list)

  const mark = () => [...list.children].forEach((li, i) => li.classList.toggle('active', i === active))
  const setOpen = (next) => {
    list.hidden = !next
    button.setAttribute('aria-expanded', String(next))
    if (next) { active = Math.max(0, choices.indexOf(current)); mark() }
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
    if (!wrap.isConnected) return document.removeEventListener('pointerdown', outside)
    if (!list.hidden && !wrap.contains(e.target)) setOpen(false)
  }
  document.addEventListener('pointerdown', outside)

  setOpen(open)
  return wrap
}
