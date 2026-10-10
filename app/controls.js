/**
 * Controls shared by the activities: a sound toggle for a title bar and a
 * volume slider for over a video.
 */

export const SPEAKER = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 5h2.5l3.5-3v10L4 9H1.5z" fill="currentColor"/>
  <path d="M9.6 4.6a3.4 3.4 0 0 1 0 4.8M11.4 2.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <line class="slash" x1="1" y1="13" x2="13" y2="1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`

/**
 * A sound toggle for a title bar, pressed while the sound is on: the same
 * button, and the same look when off, as the microphone's.
 */
export function soundButton(onToggle) {
  const b = document.createElement('button')
  b.className = 'wbtn media'
  b.title = 'sound'
  b.setAttribute('aria-label', 'sound')
  b.setAttribute('aria-pressed', 'true')
  b.innerHTML = SPEAKER
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    const on = b.getAttribute('aria-pressed') !== 'true'
    b.setAttribute('aria-pressed', String(on))
    onToggle(on)
  })
  /** Show the sound as on or off without toggling it. */
  b.set = (on) => b.setAttribute('aria-pressed', String(on))
  return b
}

/**
 * Show how far along a slider is: the track is coloured up to the thumb.
 * Called whenever its value changes, by hand or not. The track is drawn by
 * the box round the slider (.slider-box), so its ends sit under the thumb.
 */
export function fill(input) {
  const min = Number(input.min) || 0
  const max = Number(input.max) || 1
  const at = max > min ? (Number(input.value) - min) / (max - min) : 0
  ;(input.closest('.slider-box') ?? input).style.setProperty('--fill', `${Math.max(0, Math.min(1, at)) * 100}%`)
}

/** A volume slider, 0 to 1, for over a video. */
export function volumeSlider(value, onInput) {
  const label = document.createElement('label')
  label.className = 'volume'
  label.title = 'volume'
  label.innerHTML = `${SPEAKER}<span class="slider-box"><input type="range" class="slider" min="0" max="1" step="0.05" aria-label="volume"></span>`
  const input = label.querySelector('input')
  input.value = String(value)
  fill(input)
  input.addEventListener('input', () => { fill(input); onInput(Number(input.value)) })
  // A drag on the slider is not a press on the window behind it.
  label.addEventListener('pointerdown', (e) => e.stopPropagation())
  return label
}
