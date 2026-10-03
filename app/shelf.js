/**
 * The games shelf: a card per game, opened from the top bar. Picking one
 * opens a new table for it and sits you down.
 *
 * Each game brings its own icon, drawn from shapes like everything else.
 */
export function shelf({ games, upcoming, onPick }) {
  const el = document.createElement('div')
  el.className = 'shelf'
  const card = (game, ready) => {
    const b = document.createElement('button')
    b.className = `game-card tone-${game.tone}`
    b.disabled = !ready
    b.innerHTML = `<svg class="icon" viewBox="0 0 56 44">${game.icon ?? ''}</svg>
      <span>${game.name}</span>${ready ? '' : '<span class="soon">soon</span>'}`
    if (ready) b.addEventListener('click', () => onPick(game.id))
    return b
  }
  for (const game of Object.values(games)) el.append(card(game, true))
  for (const game of upcoming) el.append(card(game, false))
  return el
}
