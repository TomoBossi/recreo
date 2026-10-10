import { LocalMedia } from 'mirador'
import { soundButton, volumeSlider } from './controls.js'

/**
 * Screenshare: an activity, not a game. Anyone can share their screen, several
 * at once, and each share is a window for everyone: the sharer's own, showing
 * what they send, and one for each peer who sees it.
 *
 * The share is the stream itself, sent to the room labelled 'screen'; there
 * is nothing else to agree on. A window opens when a share arrives and closes
 * when it stops — the sharer pressed stop, here or in the browser's own bar,
 * or left. The sharer's ✕ stops sharing; nobody else's window can be closed,
 * only collapsed, and a peer's share can be muted from its title bar, collapsed
 * or not, and turned down with the slider over it.
 *
 * Phones cannot share a screen (no mobile OS lets a page capture one), but
 * see everyone else's.
 */

const SCREEN = `<rect x="7" y="7" width="42" height="26" rx="3.5" fill="#2b84b4" stroke="#241c3a" stroke-width="2.5"/>
  <path d="M22 39h12M28 33v6" stroke="#241c3a" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M21 25c1-6 5-9 11-9" fill="none" stroke="#fffaf0" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M29 12.5l4 3.5-4 3.5" fill="none" stroke="#fffaf0" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`

export const screenshareCard = { id: 'screenshare', name: 'Screenshare', tone: 'sky', icon: SCREEN }

export class Screenshare {
  /** @type {Map<string, {win: object, video: HTMLVideoElement, peerId: string|null}>} */
  #windows = new Map()

  constructor({ room, media, wm, chat, toast }) {
    this.room = room
    this.media = media
    this.wm = wm
    this.chat = chat
    this.toast = toast

    // Both ways of stopping — the window's ✕ and the browser's own bar — end
    // in the same event, so peers always hear of it.
    media.on('screen', (stream, ended) => {
      if (stream) {
        room.addStream(stream, { kind: 'screen' })
        this.#open('self', stream, null)
      } else {
        if (ended) room.removeStream(ended)
        this.#close('self')
      }
    })
    room.on('peer:stream', (peer, stream, kind) => {
      if (kind !== 'screen') return
      if (stream) {
        const isNew = !this.#windows.has(peer.id)
        this.#open(peer.id, stream, peer)
        if (isNew) chat.system(`${peer.nick || 'someone'} is sharing their screen`)
      } else {
        this.#close(peer.id)
      }
    })
    room.on('peer:leave', (peer) => this.#close(peer.id))
    room.on('peer:update', (peer) => {
      const entry = this.#windows.get(peer.id)
      if (entry) entry.win.setTitle(`${peer.nick || 'someone'}'s screen`)
    })
  }

  get sharing() { return !!this.media.screenStream }

  /** How the shelf shows it: unavailable while sharing, or where sharing is impossible. */
  status() {
    if (!LocalMedia.canShareScreen) return { ready: false, note: 'not here' }
    if (this.sharing) return { ready: false, note: 'sharing' }
    return { ready: true }
  }

  /** Picked from the shelf: share, or bring the share running forward, or say why not. */
  async pick() {
    if (!LocalMedia.canShareScreen) { this.toast('this device cannot share its screen'); return }
    const own = this.#windows.get('self')
    if (own) { this.wm.reveal(own.win); return }
    try {
      await this.media.startScreen()
    } catch (err) {
      // Choosing not to share, at the browser's picker, is no error.
      if (err?.name !== 'NotAllowedError') this.toast(err.message)
    }
  }

  #open(key, stream, peer) {
    const existing = this.#windows.get(key)
    if (existing) {
      if (existing.video.srcObject !== stream) existing.video.srcObject = stream
      return
    }
    const own = key === 'self'
    const body = document.createElement('div')
    body.className = 'screen-body'
    body.dataset.cursorHost = ''
    // The picture's own box, letterboxing left out: a pointer over it is a
    // place on the shared screen, the same for everyone.
    const frame = document.createElement('div')
    frame.className = 'screen-frame'
    frame.dataset.cursorAnchor = 'screen'
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.disablePictureInPicture = true
    // Your own share plays silently: you hear your screen already.
    video.muted = own
    video.srcObject = stream
    frame.append(video)
    body.append(frame)
    const fit = () => {
      const w = body.clientWidth
      const h = body.clientHeight
      const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
      const fw = Math.min(w, h * ratio)
      const fh = fw / ratio
      Object.assign(frame.style, { width: `${fw}px`, height: `${fh}px`, left: `${(w - fw) / 2}px`, top: `${(h - fh) / 2}px` })
    }
    const sized = new ResizeObserver(fit)
    sized.observe(body)
    // A shared window can change shape mid-share.
    video.addEventListener('resize', fit)

    let heard = !own
    const tools = []
    if (!own) {
      const sound = soundButton((on) => { heard = on; video.muted = !on })
      tools.push(sound)
      body.append(volumeSlider(1, (v) => { video.volume = v }))
      // The slider shows while a pointer is over the screen; a finger has
      // none, so a tap shows it for a few seconds, kept while it is used.
      let sleep = null
      const wake = () => {
        body.classList.add('awake')
        clearTimeout(sleep)
        sleep = setTimeout(() => body.classList.remove('awake'), 3000)
      }
      body.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') wake() }, true)
    }
    const win = this.wm.add({
      id: `screen:${key}`,
      title: own ? 'your screen' : `${peer?.nick || 'someone'}'s screen`,
      tone: 'sky',
      body,
      kind: 'table',
      order: 10 + Date.now() / 1e13,
      closable: own,
      closeLabel: 'stop sharing',
      onClose: () => this.media.stopScreen(),
      tools,
      phoneHeight: (w) => Math.round(w * 9 / 16) + 40,
    })
    // Named the same on every screen: by whose share it is.
    win.el.dataset.cursorWindow = `screen:${own ? this.room.selfId : peer.id}`
    this.#windows.set(key, { win, video, sized, peerId: peer?.id ?? null })
    // A browser holding sound back until the page is clicked plays the
    // share silent, picture and all, until then.
    video.play().catch((err) => {
      if (err?.name !== 'NotAllowedError') return
      video.muted = true
      video.play().catch(() => {})
      const unmute = () => {
        removeEventListener('pointerdown', unmute, true)
        if (heard) video.muted = false
      }
      addEventListener('pointerdown', unmute, true)
    })
  }

  #close(key) {
    const entry = this.#windows.get(key)
    if (!entry) return
    this.#windows.delete(key)
    entry.video.srcObject = null
    entry.sized.disconnect()
    this.wm.remove(entry.win)
  }
}
