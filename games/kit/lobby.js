/**
 * For games with a range of seats, which start when somebody says so: the
 * panel over the board that offers "start", tells the others to wait, and
 * comes back at the end offering to play again.
 *
 *   const lobby = startPanel(el, { onStart: () => ctx.play({ type: 'start', order: seated }) })
 *   lobby.update({ open: state.phase !== 'playing', canStart, again: state.phase === 'over', extra })
 */
import { escape } from './svg.js'

export function startPanel(el, { onStart, startLabel = 'start!', againLabel = 'play again' }) {
  const box = document.createElement('div')
  box.className = 'game-lobby'
  box.dataset.cursorAnchor = 'lobby' // the same panel for everyone: pointers over it are shared
  box.hidden = true
  el.append(box)
  box.addEventListener('click', (e) => { if (e.target.closest('[data-start]')) onStart() })

  return {
    /**
     * open: whether the panel shows at all. seated: how many are seated.
     * min: how many the game needs. mine: whether this viewer is seated.
     * again: whether it is the end of a game. extra: markup shown above,
     * a scorecard say.
     */
    update({ open, seated, min = 2, mine, again = false, extra = '' }) {
      box.hidden = !open
      if (!open) return
      const prompt = seated < min ? `need at least ${min} players`
        : mine ? `<button class="btn sun big" data-start>${escape(again ? againLabel : startLabel)}</button>`
        : 'waiting for a player to start'
      box.innerHTML = `${extra}${prompt.startsWith('<') ? prompt : `<p>${escape(prompt)}</p>`}`
    },
  }
}
