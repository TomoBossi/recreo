/**
 * How a player looks when their camera is off: for now a smiley in their
 * colour. Everything that draws a player without video asks this module,
 * so a different look — a character chosen from a roster, say — changes
 * one place.
 *
 * The head takes its colour from the CSS variable --who on any ancestor.
 */
export function avatar() {
  return `<svg class="avatar-face" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="var(--who, var(--sky))" stroke="#241c3a" stroke-width="4"/>
    <ellipse cx="36" cy="37" rx="5" ry="7" fill="#241c3a"/>
    <ellipse cx="64" cy="37" rx="5" ry="7" fill="#241c3a"/>
    <path d="M32 61 Q50 77 68 61" fill="none" stroke="#241c3a" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`
}
