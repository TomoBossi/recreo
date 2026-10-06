import { sound, unlock } from '../games/kit/sound.js'

/**
 * The room's own sounds, for every control on the page at once, so nothing
 * has to ask for them: a click as it goes down and a lighter one as it
 * comes back up, two notes for a choice picked from several, and a slide
 * up or down for a switch turned on or off.
 *
 * What counts as a control: buttons, anything that acts as one
 * (role="button", like an empty seat), the choices in a dropdown, and
 * anything marked data-sound. A choice is a button in a segmented group or
 * a dropdown's option; a switch is a button that carries aria-pressed on
 * its own, like the microphone and camera toggles. data-sound="none" silences a
 * control; data-sound="<name>" plays that sound when it is used.
 */
const CONTROL = 'button, [role="button"], [role="option"], [data-sound]'

export function clickSounds(root = document) {
  // The first touch of the page starts the audio: browsers allow nothing sooner.
  const start = () => unlock()
  root.addEventListener('pointerdown', start, { capture: true })
  root.addEventListener('keydown', start, { capture: true })

  const control = (target) => {
    const el = target?.closest?.(CONTROL)
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.dataset.sound === 'none') return null
    return el
  }

  // Listening as events come down, not up: a control that stops its own
  // clicks from bubbling still sounds.
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return
    const el = control(e.target)
    if (!el) return
    // A dropdown's option is picked on the way down; it says so at once.
    if (el.getAttribute('role') === 'option') return sound.play('select')
    sound.play('press')
  }, { capture: true })

  root.addEventListener('click', (e) => {
    const el = control(e.target)
    if (!el || el.getAttribute('role') === 'option') return
    // Enter in a text box sends its form by clicking the button for it: that is typing, not a click.
    if (e.detail === 0 && el.type === 'submit' && e.target === el && document.activeElement !== el) return
    if (el.dataset.sound && el.dataset.sound !== 'none') return sound.play(el.dataset.sound)
    if (el.closest('.segmented')) return sound.play('select')
    // A switch: read which way it went once the click has been handled.
    if (el.hasAttribute('aria-pressed')) {
      return setTimeout(() => sound.play(el.getAttribute('aria-pressed') === 'true' ? 'on' : 'off'), 0)
    }
    sound.play('release')
  }, { capture: true })
}
