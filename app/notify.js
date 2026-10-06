import { sound } from '../games/kit/sound.js'

/**
 * Every notice the room gives lands in one place: a bar floating at the
 * bottom of the screen, for a few seconds — a link copied, a game won, a
 * sixth game refused. A new notice takes the place of the one showing.
 *
 *   notify('invite link copied — send it to your friends')
 *   notify('you win! — four in a row', { sound: 'win', ms: 4500 })
 */
let timer = null

/** The last few notices given, newest last: for the test harness, and the console. */
export const notices = []

export function notify(text, { sound: name = null, ms = 2600 } = {}) {
  notices.push(text)
  if (notices.length > 20) notices.shift()
  const el = document.querySelector('#toast')
  if (!el) return
  el.textContent = text
  el.hidden = false
  // Restart its entrance, so a notice replacing another is seen to arrive.
  el.classList.remove('show')
  void el.offsetWidth
  el.classList.add('show')
  clearTimeout(timer)
  timer = setTimeout(() => { el.hidden = true }, ms)
  if (name) sound.play(name)
}
