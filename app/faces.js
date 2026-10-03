import { gridLayout, SpeakerTracker } from 'mirador'

/**
 * Everyone's face, in one window.
 *
 * Tiles are placed by mirador's grid layout, which answers "where do n tiles
 * go in this box" and nothing else. A tile shows video when there is some and
 * a drawn face when there is not: a camera that is off, one that has not
 * arrived yet, a peer who never had one.
 */
export class Faces {
  #tiles = new Map() // id -> {el, video, stream}
  #speaking = new Set()

  constructor(body, { room, media, me, players }) {
    this.room = room
    this.players = players
    this.media = media
    this.me = me
    this.el = document.createElement('div')
    this.el.className = 'faces-grid'
    body.append(this.el)

    this.speakers = new SpeakerTracker({
      onChange: (_loudest, speaking) => {
        this.#speaking = new Set(speaking ?? [])
        this.render()
      },
    })

    new ResizeObserver(() => this.render()).observe(body)
  }

  /** Track a peer's camera stream for speaking detection. */
  stream(peerId, stream) {
    if (stream) this.speakers.add(peerId, stream)
    else this.speakers.remove(peerId)
    this.render()
  }

  forget(peerId) { this.speakers.remove(peerId) }

  render() {
    const people = [
      {
        id: 'self',
        player: this.me.player,
        nick: this.me.nick || 'you',
        stream: this.media.stream,
        video: this.media.state().videoEnabled && !!this.media.stream?.getVideoTracks().length,
        muted: !this.media.state().audioEnabled,
        self: true,
      },
      ...[...this.room.peers.values()].map((p) => ({
        id: p.id,
        player: p.presence.player ?? p.id,
        nick: p.nick || '…',
        stream: p.streams.camera ?? null,
        video: p.presence.video !== false && !!p.streams.camera?.getVideoTracks().length,
        muted: p.presence.audio === false,
        touch: !!p.presence.touch,
        reconnecting: !!p.reconnecting,
      })),
    ]

    const box = this.el.getBoundingClientRect()
    const { positions } = gridLayout({
      count: people.length, width: box.width, height: box.height, gap: 8, padding: 8, fill: true, aspect: 4 / 3,
    })

    const seen = new Set()
    people.forEach((person, i) => {
      seen.add(person.id)
      const tile = this.#tile(person.id)
      const pos = positions[i]
      if (pos) Object.assign(tile.el.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: `${pos.width}px`, height: `${pos.height}px` })

      const colour = this.players.colourOf(person.player)
      tile.el.style.setProperty('--who', colour)
      tile.el.classList.toggle('speaking', this.#speaking.has(person.id))
      tile.el.classList.toggle('reconnecting', !!person.reconnecting)
      tile.el.classList.toggle('has-video', person.video)

      if (tile.stream !== person.stream) {
        tile.stream = person.stream
        tile.video.srcObject = person.stream
        tile.video.muted = !!person.self
        if (person.stream) tile.video.play().catch(() => {})
      }
      tile.name.textContent = person.nick + (person.self ? ' (you)' : '')
      tile.mute.hidden = !person.muted
      tile.phone.hidden = !person.touch
      tile.state.textContent = person.reconnecting ? 'reconnecting…' : ''
    })

    for (const [id, tile] of this.#tiles) {
      if (!seen.has(id)) { tile.el.remove(); this.#tiles.delete(id) }
    }
  }

  #tile(id) {
    let tile = this.#tiles.get(id)
    if (tile) return tile
    const el = document.createElement('div')
    el.className = 'face'
    el.innerHTML = `
      <div class="avatar"><div class="head"><div class="smile"></div></div></div>
      <video autoplay playsinline disablepictureinpicture></video>
      <span class="tag"><span class="dot"></span><span class="name"></span><svg class="muted-mark" viewBox="0 0 14 14" hidden aria-label="muted">
        <rect x="4.5" y="0.5" width="5" height="8" rx="2.5" fill="currentColor"/>
        <path d="M2.5 6.5 a4.5 4.5 0 0 0 9 0 M7 11 v2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="1" y1="13" x2="13" y2="1" stroke="var(--berry)" stroke-width="2.4" stroke-linecap="round"/></svg>
        <svg class="phone-mark" viewBox="0 0 10 14" hidden aria-label="on a phone"><rect x="1" y="0.8" width="8" height="12.4" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="5" cy="10.6" r="0.9" fill="currentColor"/></svg></span>
      <span class="face-state"></span>`
    this.el.append(el)
    tile = {
      el,
      video: el.querySelector('video'),
      name: el.querySelector('.name'),
      mute: el.querySelector('.muted-mark'),
      phone: el.querySelector('.phone-mark'),
      state: el.querySelector('.face-state'),
      stream: undefined,
    }
    this.#tiles.set(id, tile)
    return tile
  }
}
