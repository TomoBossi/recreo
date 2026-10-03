/**
 * The games shelf: a card per game, opened from the top bar. Picking one
 * opens a new table for it and sits you down.
 *
 * The icons are drawn from shapes like everything else.
 */
const ICONS = {
  connect4: `
    <rect x="6" y="6" width="44" height="34" rx="5" fill="var(--sea)" stroke="var(--ink)" stroke-width="2.5"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => {
      const fill = (r === 2 && c < 3) || (r === 1 && c === 1) ? (c % 2 ? 'var(--sun)' : 'var(--berry)') : 'var(--paper)'
      return `<circle cx="${14 + c * 9.5}" cy="${14 + r * 9.5}" r="3.6" fill="${fill}" stroke="var(--ink)" stroke-width="1.5"/>`
    }).join('')).join('')}`,
  chess: `
    <rect x="6" y="8" width="44" height="32" rx="4" fill="var(--paper)" stroke="var(--ink)" stroke-width="2.5"/>
    ${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5].map((c) => (r + c) % 2
      ? `<rect x="${8 + c * 6.7}" y="${10 + r * 7}" width="6.7" height="7" fill="var(--grape)" opacity="0.55"/>` : '').join('')).join('')}
    <circle cx="28" cy="15" r="5" fill="var(--paper)" stroke="var(--ink)" stroke-width="2.5"/>
    <path d="M22 34 L25 21 H31 L34 34 Z" fill="var(--paper)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="19" y="33" width="18" height="5" rx="2" fill="var(--paper)" stroke="var(--ink)" stroke-width="2.5"/>`,
  draw: `
    <rect x="5" y="7" width="40" height="32" rx="4" fill="#fff" stroke="var(--ink)" stroke-width="2.5"/>
    <path d="M11 30 C 16 18, 22 34, 28 22" fill="none" stroke="var(--berry)" stroke-width="3" stroke-linecap="round"/>
    <g transform="rotate(40 40 18)">
      <rect x="35" y="2" width="9" height="26" rx="2" fill="var(--sun)" stroke="var(--ink)" stroke-width="2.5"/>
      <path d="M35 28 L39.5 36 L44 28 Z" fill="var(--paper)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
    </g>`,
  golf: `
    <ellipse cx="28" cy="36" rx="22" ry="7" fill="var(--leaf)" stroke="var(--ink)" stroke-width="2.5"/>
    <ellipse cx="33" cy="36" rx="5" ry="2" fill="var(--ink)"/>
    <line x1="33" y1="36" x2="33" y2="6" stroke="var(--ink)" stroke-width="2.5"/>
    <path d="M33 6 L48 11 L33 16 Z" fill="var(--berry)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="16" cy="33" r="3.5" fill="#fff" stroke="var(--ink)" stroke-width="2"/>`,
}

export function shelf({ games, upcoming, onPick }) {
  const el = document.createElement('div')
  el.className = 'shelf'
  const card = (game, ready) => {
    const b = document.createElement('button')
    b.className = `game-card tone-${game.tone}`
    b.disabled = !ready
    b.innerHTML = `<svg class="icon" viewBox="0 0 56 44">${ICONS[game.id] ?? ''}</svg>
      <span>${game.name}</span>${ready ? '' : '<span class="soon">soon</span>'}`
    if (ready) b.addEventListener('click', () => onPick(game.id))
    return b
  }
  for (const game of Object.values(games)) el.append(card(game, true))
  for (const game of upcoming) el.append(card(game, false))
  return el
}
