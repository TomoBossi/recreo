
import { sound } from '../games/kit/sound.js'

/**
 * The room's chat, as a narrow window.
 *
 * It also carries the room's own announcements — who arrived, who opened a
 * table — in a quieter voice, so there is one place to look for what
 * happened while you were not watching.
 */
export class Chat {
  constructor(body, { room, players, onSend }) {
    this.room = room
    this.players = players
    body.innerHTML = `
      <div class="chat">
        <div class="chat-lines" aria-live="polite"></div>
        <form class="chat-form">
          <input class="input" maxlength="500" placeholder="say something" aria-label="message">
          <button class="btn small sun" type="submit">send</button>
        </form>
      </div>`
    this.lines = body.querySelector('.chat-lines')
    const input = body.querySelector('input')
    body.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      onSend?.(text)
      room.chat(text)
    })
    room.on('chat', (msg) => this.say(msg))
  }

  /**
   * Whether you can see the chat. A message you can see needs no sound;
   * one that arrives with the chat minimized, scrolled out of view or the
   * tab in the background gets one, as a notification.
   */
  #inView() {
    if (document.hidden || this.lines.closest('.win')?.classList.contains('collapsed')) return false
    // New lines arrive at the bottom: that is the part that has to be on
    // screen. Scrolled away in a phone's column is as good as minimized.
    const box = this.lines.getBoundingClientRect()
    return box.height > 0 && box.bottom > 0 && box.bottom <= innerHeight + 2
  }

  say({ nick, text, from, self }) {
    const peer = self ? null : this.room.peers.get(from)
    const player = self ? this.selfPlayer : peer?.presence.player ?? from
    const line = document.createElement('div')
    line.className = 'chat-line'
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = `${nick} `
    who.style.color = this.players.colourOf(player)
    line.append(who, document.createTextNode(text))
    this.#append(line)
    // Someone else's message, out of sight, makes a sound; your own, the
    // room's notices, and anything you can already see do not.
    if (!self && !this.#inView()) sound.play('message')
  }

  system(text) {
    const line = document.createElement('div')
    line.className = 'chat-line system'
    line.textContent = text
    this.#append(line)
  }

  #append(line) {
    const atBottom = this.lines.scrollHeight - this.lines.scrollTop - this.lines.clientHeight < 40
    this.lines.append(line)
    while (this.lines.children.length > 300) this.lines.firstChild.remove()
    if (atBottom) this.lines.scrollTop = this.lines.scrollHeight
  }
}
