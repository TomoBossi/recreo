/**
 * The games shelf: a card per game, opened from the top bar. Picking one
 * opens a new table for it and sits you down.
 *
 * After the games come the activities — a shared screen, a shared video —
 * which are not games and keep their own rules. An activity that cannot be
 * started again just now (already running, or not possible on this device)
 * shows as unavailable, with a word on why, and picking it still does what
 * makes sense: brings the running one forward, or says why not.
 *
 * Each game and activity brings its own icon, drawn from shapes like
 * everything else.
 */
export function shelf({ games, upcoming, activities = [], onPick }) {
  const el = document.createElement('div')
  el.className = 'shelf'
  const card = ({ tone, icon, name }, { ready = true, note = '', pick = null } = {}) => {
    const b = document.createElement('button')
    b.className = `game-card tone-${tone}`
    b.disabled = !pick
    b.classList.toggle('unavailable', !ready)
    b.innerHTML = `<svg class="icon" viewBox="0 0 56 44">${icon ?? ''}</svg>
      <span>${name}</span>${note ? `<span class="soon">${note}</span>` : ''}`
    if (pick) b.addEventListener('click', pick)
    return b
  }
  for (const game of Object.values(games)) el.append(card(game, { pick: () => onPick(game.id) }))
  for (const game of upcoming) el.append(card(game, { ready: false, note: 'soon' }))
  for (const activity of activities) {
    const { ready, note } = activity.status()
    el.append(card(activity, { ready, note, pick: activity.pick }))
  }
  return el
}
