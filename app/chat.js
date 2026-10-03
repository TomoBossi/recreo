import { colourFor } from './identity.js'

/**
 * The room's chat, as a narrow window.
 *
 * It also carries the room's own announcements — who arrived, who opened a
 * table — in a quieter voice, so there is one place to look for what
 * happened while you were not watching.
 */
export class Chat {
  constructor(body, { room, onSend }) {
    this.room = room
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

  say({ nick, text, from, self }) {
    const peer = self ? null : this.room.peers.get(from)
    const player = self ? this.selfPlayer : peer?.presence.player ?? from
    const line = document.createElement('div')
    line.className = 'chat-line'
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = `${nick} `
    who.style.color = `color-mix(in srgb, ${colourFor(player)} 70%, #241c3a)`
    line.append(who, document.createTextNode(text))
    this.#append(line)
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
