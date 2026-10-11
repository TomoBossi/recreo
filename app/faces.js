import { holds } from './devices.js'
import { avatar } from './avatar.js'
import { gridLayout, spotlightLayout, SpeakerTracker, resumeAudio } from 'mirador'
import { store } from './store.js'

/** How long a speaker keeps the big tile after they pause, in auto. */
const HOLD_MS = 1500

/**
 * Everyone's face, in one window.
 *
 * Tiles are placed by mirador's layouts, which answer "where do n tiles go in
 * this box" and nothing else. A tile shows video when there is some and a
 * drawn face when there is not: a camera that is off, one that has not
 * arrived yet, a peer who never had one.
 *
 * Three layouts, as in tertulia:
 *   auto       whoever is speaking takes the big tile while they talk; then
 *              the grid comes back
 *   grid       equal tiles, always
 *   spotlight  there is always a big tile, held by whoever spoke last
 * Nobody is spotlighted for their own voice: seeing yourself large while
 * you talk helps no one.
 */
export class Faces {
  #tiles = new Map() // id -> {el, video, stream}
  #speaking = new Set()
  #focus = null      // who holds the big tile now, if anyone
  #streams = new Map() // id -> the stream whose voice we may measure
  #metered = new Map() // id -> the stream being measured now
  #lastSpeaker = null
  #holdTimer = null

  constructor(body, { room, media, me, players, onSilenced }) {
    this.onSilenced = onSilenced
    this.room = room
    this.players = players
    this.media = media
    this.me = me
    this.el = document.createElement('div')
    this.el.className = 'faces-grid'
    body.append(this.el)

    this.mode = store.get('faces:layout', 'auto')
    this.speakers = new SpeakerTracker({
      onChange: (loudest, speaking) => {
        this.#speaking = new Set(speaking ?? [])
        this.#heard(loudest)
        this.render()
      },
    })

    new ResizeObserver(() => this.render()).observe(body)
  }

  /**
   * Play a tile. A browser lets a page make sound only once it has been
   * clicked or typed into — and arriving straight from a link, it has not —
   * so a voice it refuses plays muted, picture and all, until the first
   * click or key anywhere, which turns every voice on.
   */
  #play(tile, self) {
    tile.video.play().catch((err) => {
      if (err?.name !== 'NotAllowedError' || self) return
      tile.video.muted = true
      tile.silenced = true
      tile.video.play().catch(() => {})
      this.#awaitGesture()
    })
  }

  #awaitGesture() {
    if (this.waiting) return
    this.waiting = true
    this.onSilenced?.()
    const unmute = () => {
      removeEventListener('pointerdown', unmute, true)
      removeEventListener('keydown', unmute, true)
      this.waiting = false
      void resumeAudio()
      for (const tile of this.#tiles.values()) {
        if (!tile.silenced) continue
        tile.silenced = false
        tile.video.muted = false
        tile.video.play().catch(() => {})
      }
    }
    addEventListener('pointerdown', unmute, true)
    addEventListener('keydown', unmute, true)
  }

  /** A peer's (or our own) camera stream, for speaking detection. */
  stream(peerId, stream) {
    if (stream) this.#streams.set(peerId, stream)
    else this.#streams.delete(peerId)
    this.render()
  }

  /**
   * Measure only voices that can be heard: a muted microphone cannot be
   * speaking, and measuring it costs a wake-up ten times a second.
   */
  #syncMeters(people) {
    for (const person of people) {
      const stream = this.#streams.get(person.id) ?? null
      const want = !person.muted && stream ? stream : null
      if (this.#metered.get(person.id) === want) continue
      if (want) this.speakers.add(person.id, want)
      else this.speakers.remove(person.id)
      if (want) this.#metered.set(person.id, want)
      else this.#metered.delete(person.id)
    }
  }

  forget(peerId) {
    this.speakers.remove(peerId)
    this.#streams.delete(peerId)
    this.#metered.delete(peerId)
    if (this.#focus === peerId) this.#focus = null
    if (this.#lastSpeaker === peerId) this.#lastSpeaker = null
  }

  setMode(mode) {
    this.mode = mode
    store.set('faces:layout', mode)
    this.#heard(this.speakers.loudest())
    this.render()
  }

  /** Someone is (or nobody is) the loudest: decide who holds the big tile. */
  #heard(loudest) {
    const other = loudest && loudest !== 'self' ? loudest : null
    if (other) this.#lastSpeaker = other
    clearTimeout(this.#holdTimer)
    if (this.mode === 'grid') { this.#focus = null; return }
    if (this.mode === 'spotlight') { this.#focus = this.#lastSpeaker; return }
    if (other) { this.#focus = other; return }
    // auto: a pause keeps the speaker up a moment, then the grid returns.
    if (this.#focus) this.#holdTimer = setTimeout(() => { this.#focus = null; this.render() }, HOLD_MS)
  }

  render() {
    const people = [
      {
        id: 'self',
        player: this.me.player,
        nick: this.me.nick || 'you',
        stream: this.media.stream,
        video: this.media.state().videoEnabled && holds(this.media, 'video'),
        muted: !(this.media.state().audioEnabled && holds(this.media, 'audio')),
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

    this.#syncMeters(people)
    const box = this.el.getBoundingClientRect()
    let positions
    // In spotlight, somebody must hold it even before anyone has spoken.
    const focus = this.mode === 'spotlight' ? (this.#focus ?? people.find((p) => !p.self)?.id) : this.#focus
    const star = people.find((p) => p.id === focus && !p.self)
    if (star && people.length > 1) {
      // The speaker large, everyone else — you last — in the strip beside them.
      people.splice(people.indexOf(star), 1)
      people.push(people.shift())
      people.unshift(star)
      const { main, strip } = spotlightLayout({ count: people.length, width: box.width, height: box.height, gap: 8, padding: 8, aspect: 4 / 3 })
      positions = [main, ...strip]
    } else {
      positions = gridLayout({
        count: people.length, width: box.width, height: box.height, gap: 8, padding: 8, fill: true, aspect: 4 / 3,
      }).positions
      // When the grid makes one tile bigger than the rest — three people,
      // say, with the last one stretched across — that one is yours, on
      // every screen: each of us sees ourselves large and the others small.
      const areas = positions.map((p) => p.width * p.height)
      const largest = Math.max(...areas)
      if (people.length > 1 && largest > Math.min(...areas) + 1) {
        const [self] = people.splice(0, 1)
        people.splice(areas.indexOf(largest), 0, self)
      }
    }

    const seen = new Set()
    people.forEach((person, i) => {
      seen.add(person.id)
      const tile = this.#tile(person.id)
      const pos = positions[i]
      if (pos) Object.assign(tile.el.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: `${pos.width}px`, height: `${pos.height}px` })

      const colour = this.players.colourOf(person.player)
      tile.el.style.setProperty('--who', colour)
      const character = this.players.characterOf(person.player)
      if (tile.character !== character) {
        tile.character = character
        tile.avatar.innerHTML = avatar(character)
      }
      tile.el.classList.toggle('speaking', this.#speaking.has(person.id))
      tile.el.classList.toggle('reconnecting', !!person.reconnecting)
      tile.el.classList.toggle('has-video', person.video)

      if (tile.stream !== person.stream) {
        tile.stream = person.stream
        tile.video.srcObject = person.stream
        tile.video.muted = !!person.self
        if (person.stream) this.#play(tile, person.self)
      }
      // Each one's voice as loud as you have set it for them.
      if (!person.self) tile.video.volume = this.volumeOf(person.player)
      tile.name.textContent = person.nick + (person.self ? ' (you)' : '')
      tile.mute.hidden = !person.muted
      tile.phone.hidden = !person.touch
      tile.state.textContent = person.reconnecting ? 'reconnecting…' : ''
    })

    for (const [id, tile] of this.#tiles) {
      if (!seen.has(id)) { tile.el.remove(); this.#tiles.delete(id) }
    }
  }

  /** How loud a player is heard here, 0 to 1: set in the Peers menu, kept in this browser. */
  volumeOf(player) {
    const v = Number(store.get(`volume:${player}`, 1))
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
  }

  setVolume(player, v) {
    store.set(`volume:${player}`, v)
    this.render()
  }

  #tile(id) {
    let tile = this.#tiles.get(id)
    if (tile) return tile
    const el = document.createElement('div')
    el.className = 'face'
    el.innerHTML = `
      <div class="avatar"></div>
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
      avatar: el.querySelector('.avatar'),
      character: undefined,
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
