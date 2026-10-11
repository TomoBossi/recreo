import { fill, soundButton, volumeSlider } from './controls.js'
import { store } from './store.js'

/**
 * YouTube: an activity, not a game. One player per room, watched together:
 * play, pause and seek are everyone's, the volume each one's own, and the
 * queue is shared and anyone's to edit — add, remove, reorder, play now, skip.
 *
 * One peer runs it: the first here, until it goes, then the one left with the
 * lowest id; a newcomer learns who from the state it is sent. Everyone else sends it
 * what they want done, and it sends everyone the result, so two people
 * editing the queue at once both get their way. Whoever runs it also watches
 * how everyone is doing. Each player reports every half second; one whose
 * video should be moving and is not — buffering, an advert, a slow line, it
 * does not matter which — holds everyone after a moment, with "waiting for
 * ana…", and everyone carries on together once it is moving again. Someone
 * with adverts keeps playing while the others wait, since an advert only
 * runs while it plays, then comes back to where everyone stopped. After a
 * while the others can go on without them, until the next video.
 *
 * Positions are given on the runner's clock; each peer measures how far its
 * own is from it, keeping the measurement that took the shortest round trip
 * (a slow line skews the others). A player a little off where it should be
 * plays a touch faster or slower until it is there, which needs no new data;
 * only one far off seeks, aiming ahead by what its last seek cost, and one
 * whose seeks keep missing seeks less readily.
 *
 * A browser that will not play sound before the page has been clicked plays
 * the video muted, in step, with a "join playback" button for the sound; it
 * holds nobody up meanwhile.
 *
 * YouTube's own player comes from YouTube's IFrame API, with its controls
 * hidden: every control is recreo's, so every press can go to everyone.
 */

const ICON = `<rect x="6" y="9" width="44" height="28" rx="8" fill="#ff0033" stroke="#241c3a" stroke-width="2.5"/>
  <path d="M24 16.5v13l11-6.5z" fill="#fffaf0" stroke="#241c3a" stroke-width="1.5" stroke-linejoin="round"/>`

export const youtubeCard = { id: 'youtube', name: 'YouTube', tone: 'berry', icon: ICON }

const TICK_MS = 250
const REPORT_MS = 500
const HOLD_AFTER = 1500    // stuck this long holds everyone
const ESCAPE_AFTER = 15000 // held this long offers to go on without them
const LEVEL = 0.05         // seconds off that count as in step
const NUDGE = 0.2          // seconds off before a player changes speed to catch up
const LEAP = 3             // seconds off before a player seeks instead
const GRACE = 2500         // after loading or seeking, a player is not judged stuck
const QUIET = 3000         // no report for this long: not counted
const AHEAD = 4            // seconds a held-for player would like ready before everyone goes on
const AHEAD_WAIT = 3000    // how long it waits for them, at most: a paused player may load nothing
const ASK_AGAIN = 1000     // an unanswered ask is sent again this often
const ASK_GIVE_UP = 20000  // and dropped after this long unanswered
const ASKS_KEPT = 30       // asks the state remembers as done, so no runner does one twice

const PLAY = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.5v9l7.5-4.5z" fill="currentColor"/></svg>`
const PAUSE = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2.5h2.5v9H3.5zM8 2.5h2.5v9H8z" fill="currentColor"/></svg>`
const LIST = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 3.5h10M2 7h10M2 10.5h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
const NEXT = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 2.5v9l6.5-4.5zM10 2.5h2v9h-2z" fill="currentColor"/></svg>`

/** A YouTube link or a bare video id, as the id; null if it is neither. */
export function videoId(text) {
  const s = String(text ?? '').trim()
  if (/^[\w-]{11}$/.test(s)) return s
  let url
  try { url = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`) } catch { return null }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  if (host === 'youtu.be') return /^\/([\w-]{11})/.exec(url.pathname)?.[1] ?? null
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null
  const v = url.searchParams.get('v')
  if (v && /^[\w-]{11}$/.test(v)) return v
  return /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(url.pathname)?.[1] ?? null
}

/** 83 -> "1:23", 3723 -> "1:02:03". */
export function clock(seconds) {
  const t = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const closed = () => ({
  v: 0, runner: null, open: false, queue: [], now: null,
  playing: false, held: false, pos: 0, at: 0,
  waiting: [], since: 0, skip: [], by: null, did: null,
})

let api = null
/** YouTube's IFrame API, loaded once, when first wanted. */
function loadApi() {
  if (api) return api
  api = new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return }
    const before = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { before?.(); resolve(window.YT) }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => { api = null; reject(new Error('YouTube could not be reached')) }
    document.head.append(script)
  })
  return api
}

export class YouTube {
  state = closed()
  #runner = null       // who runs it, by peer id
  #offset = 0          // the runner's clock minus ours, in ms
  #samples = []        // recent measurements of it: { rtt, offset }
  #reports = new Map() // runner only: peer id -> { report, at }
  #view = null         // the window and its player, while open
  #revealNext = false  // we opened it: show it once it is there
  #seq = 0
  #pending = new Map() // ask ref -> { ask, since, sent }: sent, not yet answered
  #done = new Set()    // ask refs this runner has dealt with, done or not

  constructor({ room, wm, chat, players, toast }) {
    this.room = room
    this.wm = wm
    this.chat = chat
    this.players = players
    this.toast = toast
    this.channel = room.channel('yt')
    this.channel.on('message', (msg, from) => this.#hear(msg, from))
    room.answer('yt.clock', () => Date.now())
    // Anyone answers a newcomer with how things stand, as far as it knows.
    room.answer('yt.state', () => (this.state.v > 0 ? this.state : null))
    room.on('peer:join', (peer) => {
      this.#elect()
      if (this.#runs && this.state.v > 0) this.channel.send({ t: 'state', state: this.state }, peer.id)
      if (this.state.v === 0) void this.#fetch()
    })
    room.on('peer:leave', (peer) => { this.#reports.delete(peer.id); this.#elect() })
    room.on('peer:interrupted', () => this.#elect())
    // Back from a drop, a peer may have missed how things changed meanwhile.
    room.on('peer:reconnected', (peer) => {
      this.#elect()
      if (this.#runs && this.state.v > 0) this.channel.send({ t: 'state', state: this.state }, peer.id)
    })
    this.#elect()
    setInterval(() => this.#tick(), TICK_MS)
    setInterval(() => this.#report(), REPORT_MS)
    setInterval(() => this.#measure(), 10000)
  }

  get #runs() { return this.#runner === this.room.selfId }

  /** The peers here now, this one included. */
  #here() {
    return [this.room.selfId, ...[...this.room.peers.values()].filter((p) => !p.reconnecting).map((p) => p.id)]
  }

  /**
   * Who runs it. The runner keeps it while it is here: a newcomer with a
   * lower id taking over would take over knowing nothing. Only when it has
   * gone — or before there is anything to know — does the lowest id here.
   */
  #elect() {
    const here = this.#here()
    if (this.#runner && here.includes(this.#runner) && this.state.v > 0) return
    this.#setRunner(here.sort()[0])
  }

  #setRunner(id) {
    if (id === this.#runner) return
    this.#runner = id
    this.#reports.clear()
    this.#samples = []
    void this.#measure(5)
  }

  /**
   * Ask the others how things stand. What the runner sends a newcomer on
   * arrival can come before the newcomer is listening; asking, once ready,
   * cannot miss.
   */
  async #fetch() {
    for (const peer of this.#here().filter((id) => id !== this.room.selfId).sort()) {
      const state = await this.room.request('yt.state', null, { target: peer, timeout: 4000 }).catch(() => null)
      if (state && state.v > this.state.v) { this.#adopt(state); return }
      if (state) return
    }
  }

  /** How far the runner's clock is from ours, the way NTP asks. */
  async #measure(times = 1) {
    if (this.#runs) { this.#offset = 0; this.#samples = []; return }
    const runner = this.#runner
    for (let i = 0; i < times; i++) {
      const sent = Date.now()
      const theirs = await this.room.request('yt.clock', null, { target: runner, timeout: 4000 }).catch(() => null)
      if (typeof theirs !== 'number' || runner !== this.#runner) return
      const back = Date.now()
      this.#samples = [...this.#samples, { rtt: back - sent, offset: theirs - (sent + back) / 2 }].slice(-8)
      // The quickest round trip had the least room to be lopsided.
      this.#offset = this.#samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset
      if (i < times - 1) await new Promise((r) => setTimeout(r, 250))
    }
  }

  /** Where the video should be now, in seconds. */
  #expected(now = Date.now()) {
    const s = this.state
    if (!s.now) return 0
    if (!s.playing || s.held) return s.pos
    return s.pos + Math.max(0, now + this.#offset - s.at) / 1000
  }

  /** For the console and the test harness: the shared state and this player as it stands. */
  snapshot() {
    const player = this.#view?.player
    return {
      state: structuredClone(this.state),
      runner: this.#runner,
      offset: this.#offset,
      time: player?.getCurrentTime?.() ?? null,
      position: player?.getCurrentTime ? this.#position(this.#view, player.getCurrentTime(), player.getPlayerState(), Date.now()) : null,
      player: player?.getPlayerState?.() ?? null,
      expected: this.#expected(),
      joined: this.#view?.joined ?? null,
      error: this.#view?.error ?? null,
      modules: player?.getOptions?.() ?? null,
      muted: player?.isMuted?.() ?? null,
      rate: this.#view?.rate ?? null,
      recovery: this.#view ? { reloads: this.#view.reloads ?? 0, reloaded: this.#view.reloaded ?? 0, nudged: this.#view.nudged ?? 0, grace: this.#view.grace, movedAt: this.#view.movedAt, now: Date.now() } : null,
      patience: this.#view?.patience ?? null,
    }
  }

  // ------------------------------------------------------------ the shelf

  status() { return this.state.open ? { ready: false, note: 'open' } : { ready: true } }

  pick() {
    if (this.#view) { this.wm.reveal(this.#view.win); return }
    this.#revealNext = true
    this.#ask({ type: 'open' })
  }

  // ------------------------------------------------------------ messages

  #hear(msg, from) {
    if (msg?.t === 'state' && msg.state) {
      // The latest wins; two runners for a moment settle on the lower id.
      const next = msg.state
      const newer = next.v > this.state.v || (next.v === this.state.v && next.runner && next.runner < (this.state.runner ?? '~'))
      if (!newer) return
      this.#adopt(next)
    } else if (msg?.t === 'ask' && this.#runs) {
      this.#apply(msg.ask, from)
    } else if (msg?.t === 'ack') {
      this.#pending.delete(msg.ref)
    } else if (msg?.t === 'report' && this.#runs) {
      this.#reports.set(from, { report: msg.report, at: Date.now() })
    }
  }

  /**
   * Ask the runner for something; the runner asks itself. An ask is sent
   * again until the runner answers — a connection being repaired drops what
   * is sent over it — and the runner does each one once, whoever runs it.
   */
  #ask(ask) {
    ask = { ...ask, ref: `${this.room.selfId.slice(0, 6)}-${Date.now().toString(36)}-${++this.#seq}` }
    if (this.#runs) { this.#apply(ask, this.room.selfId); return }
    const now = Date.now()
    this.#pending.set(ask.ref, { ask, since: now, sent: now })
    this.channel.send({ t: 'ask', ask }, this.#runner)
  }

  #askAgain() {
    const now = Date.now()
    for (const [ref, p] of this.#pending) {
      if (this.state.asks?.includes(ref) || now - p.since > ASK_GIVE_UP) { this.#pending.delete(ref); continue }
      // Running it now ourselves: do it.
      if (this.#runs) { this.#pending.delete(ref); this.#apply(p.ask, this.room.selfId); continue }
      if (now - p.sent > ASK_AGAIN) { p.sent = now; this.channel.send({ t: 'ask', ask: p.ask }, this.#runner) }
    }
  }

  #adopt(next) {
    const before = this.state
    this.state = next
    if (next.runner && next.runner !== this.#runner && this.#here().includes(next.runner)) this.#setRunner(next.runner)
    const name = (id) => (id === this.room.selfId ? null : this.room.peers.get(id)?.nick || 'someone')
    if (!before.open && next.open && next.did === 'open' && name(next.by)) this.chat.system(`${name(next.by)} opened YouTube`)
    if (before.open && !next.open && name(next.by)) this.chat.system(`${name(next.by)} closed YouTube`)
    this.#sync()
  }

  // ------------------------------------------------------------ running it

  #apply(ask, from) {
    if (from !== this.room.selfId && ask.ref) this.channel.send({ t: 'ack', ref: ask.ref }, from)
    // Heard again — its answer was lost — or already done by a runner before.
    if (ask.ref && (this.#done.has(ask.ref) || this.state.asks?.includes(ask.ref))) return
    if (ask.ref) {
      this.#done.add(ask.ref)
      if (this.#done.size > 200) this.#done.delete(this.#done.values().next().value)
    }
    const s = structuredClone(this.state)
    const at = Date.now()
    const here = this.#expected(at)
    const start = (item, playing = true) => Object.assign(s, { now: item, pos: 0, at, playing: !!item && playing, held: false, waiting: [], skip: [] })
    const take = (key) => {
      const i = s.queue.findIndex((q) => q.key === key)
      return i < 0 ? null : s.queue.splice(i, 1)[0]
    }
    switch (ask.type) {
      case 'open':
        if (s.open) return
        Object.assign(s, closed(), { v: s.v, open: true })
        break
      case 'close':
        if (!s.open) return
        Object.assign(s, closed(), { v: s.v })
        break
      case 'add': {
        if (!s.open || !ask.id) return
        const item = { key: `${from.slice(0, 6)}-${Date.now().toString(36)}-${++this.#seq}`, id: ask.id, title: ask.title ?? null }
        if (ask.now || !s.now) start(item)
        else s.queue.push(item)
        break
      }
      case 'title':
        for (const item of [s.now, ...s.queue]) if (item && item.id === ask.id && !item.title) item.title = ask.title
        break
      case 'remove': take(ask.key); break
      case 'move': {
        const i = s.queue.findIndex((q) => q.key === ask.key)
        const to = Math.max(0, Math.min(s.queue.length - 1, i + ask.by))
        if (i < 0 || to === i) return
        s.queue.splice(to, 0, s.queue.splice(i, 1)[0])
        break
      }
      case 'playnow': { const item = take(ask.key); if (!item) return; start(item); break }
      case 'skip':
      case 'ended':
        // An end heard twice, or for a video already gone, moves nothing.
        if (ask.type === 'ended' && s.now?.key !== ask.key) return
        start(s.queue.shift() ?? null)
        break
      case 'play':
        if (!s.now || s.playing) return
        Object.assign(s, { playing: true, pos: s.pos, at, held: false, waiting: [] })
        break
      case 'pause':
        if (!s.now || !s.playing) return
        Object.assign(s, { playing: false, pos: here, at, held: false, waiting: [] })
        break
      case 'seek':
        if (!s.now) return
        Object.assign(s, { pos: Math.max(0, Number(ask.pos) || 0), at, held: false, waiting: [] })
        this.#reports.clear()
        break
      case 'without':
        if (!s.skip.includes(ask.peer)) s.skip.push(ask.peer)
        break
      default: return
    }
    s.by = from
    s.did = ask.type
    if (ask.ref) s.asks = [...(s.asks ?? []), ask.ref].slice(-ASKS_KEPT)
    this.#publish(s)
  }

  #publish(s) {
    s.v = this.state.v + 1
    s.runner = this.room.selfId
    this.#adopt(s)
    this.channel.send({ t: 'state', state: s })
  }

  /**
   * The runner's eye on everyone: hold when someone has been stuck a
   * moment, carry on when nobody is.
   */
  #judge() {
    const s = this.state
    if (!s.open || !s.now || !s.playing) return
    const now = Date.now()
    // A report speaks of the stretch of the video it was made in (`at`
    // changes with every play, pause, seek, hold and carrying on): one from
    // before is no news. Held, a peer not yet heard from about this hold is
    // not ready.
    const counted = [...this.#reports.entries()]
      .filter(([id, { report, at }]) => now - at < QUIET && report.key === s.now.key && !s.skip.includes(id) && !report.muted)
    const current = ({ report }) => report.at === s.at
    if (!s.held) {
      const stuck = counted.filter(([, r]) => current(r) && r.report.stuck >= HOLD_AFTER).map(([id]) => id)
      if (!stuck.length) return
      this.#publish({ ...structuredClone(s), held: true, pos: this.#expected(now), at: now, since: now, waiting: stuck, by: null, did: 'hold' })
      return
    }
    const waiting = counted.filter(([, r]) => !current(r) || !r.report.ready).map(([id]) => id)
    if (!waiting.length) {
      this.#publish({ ...structuredClone(s), held: false, at: now, waiting: [], since: 0, by: null, did: 'resume' })
    } else if (waiting.join() !== s.waiting.join()) {
      this.#publish({ ...structuredClone(s), waiting, by: null, did: 'hold' })
    }
  }

  // ------------------------------------------------------------ this player

  #tick() {
    this.#askAgain()
    if (this.#runs) this.#judge()
    this.#sync()
  }

  /** Make this window and this player match the state. */
  #sync() {
    const s = this.state
    if (!s.open) { this.#closeView(); return }
    if (!this.#view) this.#openView()
    const view = this.#view
    view.render()
    const player = view.player
    if (!player?.getPlayerState) return
    const now = Date.now()

    if ((s.now?.key ?? null) !== view.loaded) {
      view.loaded = s.now?.key ?? null
      view.grace = now + GRACE
      view.caught = false
      view.lastTime = null
      view.raw = null
      // A new video may start at its own speed: set it again, not assumed.
      view.rate = null
      if (!s.now) { player.stopVideo(); return }
      const opts = { videoId: s.now.id, startSeconds: this.#expected(now) }
      if (s.playing) player.loadVideoById(opts)
      else player.cueVideoById(opts)
      return
    }
    if (!s.now) return

    // Every play, pause, seek, hold and carrying on starts the clock afresh:
    // a player is stuck only once it has not moved since it was told to,
    // never for having stood still while everyone was paused.
    if (view.toldOf !== s.at) { view.toldOf = s.at; view.toldAt = now }

    const t = player.getCurrentTime?.() ?? 0
    const state = player.getPlayerState()
    // Moving is playing on: a step forward, not a jump — a seek or a reload
    // that lands somewhere else is no sign the video plays.
    const moving = view.lastTime != null && t - view.lastTime > 0.05 && t - view.lastTime < 1.5
    view.lastTime = t
    if (moving) view.movedAt = now
    const at = this.#position(view, t, state, now)
    // What a seek costs this player, learnt from the last one.
    if (view.seekAt && moving) { view.seekCost = Math.min(3, (view.seekCost + (now - view.seekAt) / 1000) / 2); view.seekAt = 0 }
    const want = this.#expected(now)
    const mine = s.waiting.includes(this.room.selfId)

    // A player stuck a long while may have given up: after its line came
    // back, YouTube's player does not always try again by itself. Nudge it,
    // then load it afresh where it should be.
    const shouldMove = s.playing && (!s.held || (mine && !view.caught))
    // How long it has failed to move when it should have, summed across
    // every play, pause and hold meanwhile: a player that has given up stays
    // given up however often the others change what they are doing.
    const dt = Math.min(1000, now - (view.tickAt ?? now))
    view.tickAt = now
    if (moving) view.stuckMs = 0
    else if (shouldMove && now > view.grace) view.stuckMs = (view.stuckMs ?? 0) + dt
    const stuckFor = view.stuckMs ?? 0
    if (moving) view.reloads = 0
    if (stuckFor > 20000 && now - (view.reloaded ?? 0) > 20000) {
      view.reloaded = now
      view.grace = now + GRACE
      view.reloads = (view.reloads ?? 0) + 1
      // Reloading twice did not help: the player itself has given up.
      if (view.reloads > 2) { view.reloads = 0; view.player = null; this.#makePlayer(view); return }
      player.loadVideoById({ videoId: s.now.id, startSeconds: s.held ? s.pos : want })
      return
    }
    if (stuckFor > 8000 && now - (view.nudged ?? 0) > 8000) {
      view.nudged = now
      player.seekTo(t, true)
    }

    if (s.playing && s.held && mine) {
      // Stuck: keep going until the video itself moves again (an advert
      // only runs while it plays), then come back to where everyone stopped.
      this.#speed(view, 1)
      if (!view.caught) {
        if (moving && state === 1) { view.caught = true; view.caughtAt = now; player.pauseVideo(); player.seekTo(s.pos, true) }
        else if (state !== 1 && state !== 3) player.playVideo()
      }
      return
    }
    view.caught = false
    if (s.playing && !s.held) {
      if (state !== 1 && state !== 3) player.playVideo()
      // Only a player that is moving is put right: one waiting for data
      // gains nothing from it, and would only seem never to be stuck.
      if (state === 1 && moving && now > view.grace) this.#steer(view, at - want, want, now)
    } else {
      this.#speed(view, 1)
      if (state === 1 || state === 3) player.pauseVideo()
      // A video only cued starts playing when sought, so it is left where
      // it was cued, which was the right place.
      if (state !== 5 && Math.abs(t - want) > 0.15 && now > view.grace) { player.seekTo(want, true); view.grace = now + 800 }
    }
  }

  /** Whether a player has enough of the video ready past where everyone stopped. */
  #inHand(view) {
    const player = view.player
    const fraction = player?.getVideoLoadedFraction?.()
    const duration = player?.getDuration?.() || 0
    if (fraction == null || !duration) return true
    return fraction * duration - this.state.pos >= Math.min(AHEAD, duration - this.state.pos - 0.5)
  }

  /**
   * Where the video is now. The player tells the page only now and then —
   * less often on a phone — so between tellings it is where it was plus the
   * time since, at its speed: an old answer would always look behind.
   */
  #position(view, t, state, now) {
    if (t !== view.raw) { view.raw = t; view.rawAt = now }
    return state === 1 ? t + Math.min(1, (now - view.rawAt) / 1000) * (view.rate ?? 1) : t
  }

  /**
   * Bring a playing player to where it should be, `off` seconds ahead (or,
   * negative, behind). Close: a touch faster or slower until level, which
   * needs no new data, so nothing stalls. Far: a seek, aimed ahead by what
   * seeking costs here. A player whose seeks keep missing — a slow line
   * pays for every one — seeks less readily.
   */
  #steer(view, off, want, now) {
    const player = view.player
    view.seeks = (view.seeks ?? []).filter((t) => now - t < 60000)
    const patience = view.seeks.length >= 3 ? Math.min(4, (view.patience ?? 1) * 2) : (view.patience ?? 1)
    view.patience = patience
    if (Math.abs(off) > LEAP * patience) {
      this.#speed(view, 1)
      player.seekTo(want + view.seekCost, true)
      view.seekAt = now
      view.seeks.push(now)
      view.grace = now + GRACE
      return
    }
    const rates = view.rates ??= player.getAvailablePlaybackRates?.() ?? [1]
    let rate = view.rate
    if (Math.abs(off) < LEVEL) rate = 1
    else if (Math.abs(off) > NUDGE) rate = off < 0 ? (rates.includes(1.25) ? 1.25 : 1) : (rates.includes(0.75) ? 0.75 : 1)
    this.#speed(view, rate)
  }

  #speed(view, rate) {
    if (view.rate === rate) return
    view.rate = rate
    view.player?.setPlaybackRate?.(rate)
  }

  /** What this player tells the runner: how long it has been stuck, whether it is ready to go on. */
  #report() {
    const s = this.state
    const view = this.#view
    if (!s.open || !s.now || !view?.player?.getPlayerState || view.loaded !== s.now.key) return
    const now = Date.now()
    if (view.toldOf !== s.at) { view.toldOf = s.at; view.toldAt = now }
    const shouldMove = s.playing && !s.held
    const stuck = shouldMove && now > view.grace ? now - Math.max(view.movedAt ?? 0, view.grace - GRACE, view.toldAt ?? 0) : 0
    const mine = s.held && s.waiting.includes(this.room.selfId)
    const report = {
      key: s.now.key,
      at: s.at,
      stuck: Math.max(0, stuck),
      // Ready once back where everyone stopped with a few seconds in hand:
      // going on with none would only stall it again a moment later.
      ready: s.held ? (mine ? view.caught && (this.#inHand(view) || now - view.caughtAt > AHEAD_WAIT) : true) : true,
      // Muted for want of a click: in step, but nobody waits on it.
      muted: !view.joined,
    }
    if (this.#runs) this.#reports.set(this.room.selfId, { report, at: now })
    else this.channel.send({ t: 'report', report }, this.#runner)
    // Whoever plays it first tells everyone what it is called.
    if (!s.now.title) {
      const title = view.player.getVideoData?.()?.title
      if (title) this.#ask({ type: 'title', id: s.now.id, title })
    }
  }

  // ------------------------------------------------------------ the window

  #openView() {
    const body = document.createElement('div')
    body.className = 'yt-body'
    // Pointers are shared over the picture and the shared controls, each
    // control an anchor of its own — never a group of them, which is laid
    // out differently on every screen — and the volume is each one's own.
    body.dataset.cursorHost = ''
    body.innerHTML = `
      <div class="yt-screen">
        <div class="yt-view" data-cursor-anchor="video"><div class="yt-frame"></div><div class="yt-shield" title="play or pause"></div></div>
        <div class="yt-empty">nothing playing — add a video below</div>
        <div class="yt-wait" hidden><span data-cursor-anchor="wait"></span><button type="button" class="btn small without" data-cursor-anchor="without" hidden></button></div>
        <button type="button" class="btn sun join" hidden>join playback</button>
      </div>
      <div class="yt-controls">
        <button type="button" class="wbtn media play" title="play" aria-label="play" data-cursor-anchor="play"></button>
        <button type="button" class="wbtn media next" title="next in the queue" aria-label="next in the queue" data-cursor-anchor="next">${NEXT}</button>
        <span class="slider-box seek-box" data-cursor-anchor="seek"><input type="range" class="seek slider" min="0" max="1" step="0.1" value="0" aria-label="position"></span>
        <span class="time">0:00 / 0:00</span>
        <button type="button" class="wbtn media queue-toggle" title="the queue" aria-label="the queue" aria-pressed="false">${LIST}</button>
      </div>
      <form class="yt-add">
        <input class="input" name="link" placeholder="YouTube link" autocomplete="off" spellcheck="false" aria-label="YouTube link" data-cursor-anchor="link">
        <button type="submit" class="btn small" name="queue" data-cursor-anchor="queue">add to queue</button>
        <button type="submit" class="btn small sun" name="now" data-cursor-anchor="now">play now</button>
      </form>
      <aside class="yt-side" hidden>
        <h3>queue</h3>
        <ol class="yt-queue" data-cursor-clip></ol>
      </aside>`
    const $ = (sel) => body.querySelector(sel)

    // YouTube draws its own title, "more videos" and logo along the top and
    // bottom of its frame, and offers no way to turn them off. The frame is
    // made taller than the video, so YouTube centres the video in it, and
    // only the video's own box is shown: those edges fall outside.
    const fit = new ResizeObserver(() => {
      const screen = $('.yt-screen')
      const w = screen.clientWidth
      const h = screen.clientHeight
      const vw = Math.min(w, h * 16 / 9)
      const vh = vw * 9 / 16
      Object.assign($('.yt-view').style, { width: `${vw}px`, height: `${vh}px`, left: `${(w - vw) / 2}px`, top: `${(h - vh) / 2}px` })
    })
    fit.observe(body.querySelector('.yt-screen'))

    const view = {
      win: null, player: null, loaded: undefined, grace: 0, caught: false, lastTime: null, movedAt: 0,
      joined: navigator.userActivation?.hasBeenActive ?? true,
      rate: 1, seekCost: 0, raw: null, rawAt: 0,
      // The queue's list shows when asked for, each one's own choice.
      showQueue: store.get('yt:queue', false),
      heard: true,
      volume: store.get('yt:volume', 0.8),
      seeking: false,
      render: () => this.#render(view, $),
    }
    this.#view = view

    const sound = soundButton((on) => { view.heard = on; this.#applySound(view) })
    view.sound = sound
    $('.yt-controls').append(volumeSlider(view.volume, (v) => { view.volume = v; store.set('yt:volume', v); this.#applySound(view) }))

    view.win = this.wm.add({
      id: 'activity:youtube',
      title: 'YouTube',
      tone: 'berry',
      body,
      kind: 'table',
      order: 10 + Date.now() / 1e13,
      closable: true,
      closeLabel: 'close YouTube',
      onClose: () => this.#askClose(view, $),
      tools: [sound],
      // In a phone's column: the title bar, the picture at its own shape, and
      // whatever is under it as tall as it really is, measured, not guessed —
      // a guess off by a little stretched the picture by as much.
      phoneHeight: (w) => {
        const win = body.closest('.win')
        const title = win?.querySelector('.win-title')?.offsetHeight ?? 34
        const frame = win ? win.offsetHeight - win.clientHeight : 6
        // Only what stacks under the picture: other things live in the
        // window too — the pointers' layer spans it whole, and counting it
        // grew the window by its own height at every layout.
        const below = ['.yt-controls', '.yt-add', '.yt-side'].map((sel) => body.querySelector(`:scope > ${sel}`)).reduce((h, el) => h + (!el || el.hidden ? 0 : el.offsetHeight), 0)
        // Never past what the window can hold, should anything ever measure
        // the window back into itself again.
        const picture = (w - frame) * 9 / 16
        return Math.round(title + frame + picture + Math.min(below, 900))
      },
    })
    view.win.el.dataset.cursorWindow = 'youtube'

    // Every control asks the runner; nothing changes here until it answers.
    const toggle = () => this.#ask({ type: this.state.playing ? 'pause' : 'play' })
    // The picture plays and pauses only on a click that also began on it: a
    // press on a button over it that ends on the picture — the button gone
    // from under the pointer meanwhile — is not a click on the picture.
    const shield = $('.yt-shield')
    // Where the last press began, kept until the next one: a phone delivers
    // a tap's click a moment after the finger lifts, in a task of its own.
    let pressed = false
    const press = (e) => { pressed = shield.contains(e.target) }
    addEventListener('pointerdown', press, true)
    // Nor does the second click of a double click on "join playback", which
    // lands on the picture once the button has gone.
    shield.addEventListener('click', () => { if (pressed && Date.now() - (view.joinPressed ?? 0) > 500) toggle() })
    $('.play').addEventListener('click', toggle)
    $('.next').addEventListener('click', () => this.#ask({ type: 'skip' }))
    const seek = $('.seek')
    seek.addEventListener('input', () => { view.seeking = true; fill(seek); $('.time').textContent = `${clock(seek.value)} / ${clock(seek.max)}` })
    seek.addEventListener('change', () => { view.seeking = false; this.#ask({ type: 'seek', pos: Number(seek.value) }) })
    $('.join').addEventListener('click', (e) => { e.stopPropagation(); view.joinPressed = Date.now(); this.#join(view) })
    $('.queue-toggle').addEventListener('click', () => {
      view.showQueue = !view.showQueue
      store.set('yt:queue', view.showQueue)
      view.render()
      // In a phone's column the window grows with it.
      this.wm.layout()
      // Opened, it shows what plays now.
      if (view.showQueue) {
        const list = $('.yt-queue')
        const now = list.querySelector('.now')
        if (now) list.scrollTop = now.offsetTop - list.offsetTop
      }
    })
    // In a phone's column the window's height is measured from what is
    // under the picture; when any of it changes size — the queue opening,
    // an entry added, a title arriving — it is measured again.
    let relayout = 0
    const sections = new ResizeObserver(() => {
      if (!this.wm.narrow || relayout) return
      relayout = requestAnimationFrame(() => { relayout = 0; this.wm.layout() })
    })
    for (const sel of ['.yt-controls', '.yt-add', '.yt-side']) sections.observe($(sel))
    // Floating, the queue is at most a share of the window's own height.
    const tall = new ResizeObserver(() => body.style.setProperty('--queue-max', `${Math.max(90, Math.round(body.clientHeight * 0.4))}px`))
    tall.observe(body)
    // Any click on the page lets the sound play: that is all "join" waits for.
    // The join button's own press is left to it, so it stays under the
    // pointer until its click is done.
    const activate = (e) => { if (!view.joined && !e.target.closest?.('.yt-screen .join')) this.#join(view) }
    addEventListener('pointerdown', activate, true)
    view.cleanup = () => { removeEventListener('pointerdown', activate, true); removeEventListener('pointerdown', press, true); fit.disconnect(); tall.disconnect(); sections.disconnect() }
    $('.without').addEventListener('click', () => { for (const peer of this.state.waiting) this.#ask({ type: 'without', peer }) })
    $('.yt-add').addEventListener('submit', (e) => {
      e.preventDefault()
      const input = $('.yt-add [name=link]')
      const id = videoId(input.value)
      if (!id) { this.toast('that is not a YouTube link'); return }
      input.value = ''
      this.#ask({ type: 'add', id, now: e.submitter?.name === 'now' })
      void this.#fetchTitle(id)
    })
    $('.yt-queue').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-do]')
      if (!b) return
      const key = b.closest('li').dataset.key
      if (b.dataset.do === 'now') this.#ask({ type: 'playnow', key })
      if (b.dataset.do === 'up') this.#ask({ type: 'move', key, by: -1 })
      if (b.dataset.do === 'down') this.#ask({ type: 'move', key, by: 1 })
      if (b.dataset.do === 'remove') this.#ask({ type: 'remove', key })
    })

    this.#makePlayer(view)

    if (this.#revealNext) { this.#revealNext = false; requestAnimationFrame(() => this.#view && this.wm.reveal(this.#view.win)) }
  }

  /**
   * YouTube's player, made afresh: the first time, and again for a player
   * that stayed stuck through reloading its video, which is a player that
   * has given up for good.
   */
  #makePlayer(view) {
    loadApi().then((YT) => {
      if (this.#view !== view) return
      try { view.player?.destroy?.() } catch { /* already gone */ }
      const host = view.win.el.querySelector('.yt-view')
      for (const old of host.querySelectorAll('iframe, .yt-frame')) old.remove()
      const frame = document.createElement('div')
      frame.className = 'yt-frame'
      host.prepend(frame)
      view.player = new YT.Player(frame, {
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1, cc_load_policy: 0, origin: location.origin },
        events: {
          onReady: () => { view.loaded = undefined; this.#applySound(view); this.#sync() },
          onStateChange: (e) => {
            if (e.data === 0 && this.state.now) this.#ask({ type: 'ended', key: this.state.now.key })
            if (e.data === 1) noCaptions(view.player)
          },
          // Captions are a module the player loads with each video, whatever
          // the viewer's own YouTube settings say: unloaded as soon as it is.
          onApiChange: () => noCaptions(view.player),
          onError: (e) => { view.error = e.data },
        },
      })
    }).catch((err) => this.toast(err.message))
  }

  #join(view) {
    view.joined = true
    if (!view.heard) { view.heard = true; view.sound.set(true) }
    this.#applySound(view)
  }

  #applySound(view) {
    const player = view.player
    if (!player?.setVolume) return
    player.setVolume(Math.round(view.volume * 100))
    // YouTube's lowest volume is not silence: none at all is muted.
    if (view.joined && view.heard && view.volume > 0) player.unMute()
    else player.mute()
  }

  #askClose(view, $) {
    const screen = $('.yt-screen')
    if (screen.querySelector('.ask')) return
    const ask = document.createElement('div')
    ask.className = 'ask'
    ask.innerHTML = `<p>close YouTube for everyone?</p>
      <div class="row"><button type="button" class="btn small berry" data-sound="off">close</button><button type="button" class="btn small">keep</button></div>`
    const [yes, no] = ask.querySelectorAll('button')
    yes.addEventListener('click', () => { ask.remove(); this.#ask({ type: 'close' }) })
    no.addEventListener('click', () => ask.remove())
    screen.append(ask)
  }

  async #fetchTitle(id) {
    try {
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`
      const res = await fetch(url)
      if (!res.ok) return
      const { title } = await res.json()
      if (title) this.#ask({ type: 'title', id, title: String(title).slice(0, 200) })
    } catch { /* the player tells us once it plays */ }
  }

  #render(view, $) {
    const s = this.state
    const player = view.player
    const name = (id) => (id === this.room.selfId ? 'you' : this.room.peers.get(id)?.nick || 'someone')
    view.win.setMeta(s.now?.title ?? (s.now ? s.now.id : ''))
    $('.yt-empty').hidden = !!s.now
    $('.yt-screen').classList.toggle('idle', !s.now)
    // With no picture, the whole black screen is the place pointers share,
    // whatever its shape here: black maps onto black on every screen.
    const [where, other] = s.now ? [$('.yt-view'), $('.yt-screen')] : [$('.yt-screen'), $('.yt-view')]
    where.dataset.cursorAnchor = 'video'
    delete other.dataset.cursorAnchor
    $('.join').hidden = view.joined || !s.now
    const play = $('.play')
    play.innerHTML = s.playing ? PAUSE : PLAY
    play.title = s.playing ? 'pause' : 'play'
    play.setAttribute('aria-label', play.title)
    play.disabled = !s.now
    $('.next').disabled = !s.queue.length

    const wait = $('.yt-wait')
    wait.hidden = !(s.playing && s.held)
    if (!wait.hidden) {
      const who = s.waiting.map(name)
      wait.querySelector('span').textContent = who.length ? `waiting for ${who.join(', ')}…` : 'getting everyone in step…'
      const without = wait.querySelector('.without')
      const others = s.waiting.filter((id) => id !== this.room.selfId)
      without.hidden = !others.length || Date.now() + this.#offset - s.since < ESCAPE_AFTER
      without.textContent = `play without ${others.map(name).join(', ')}`
    }

    const duration = player?.getDuration?.() || 0
    const seek = $('.seek')
    seek.max = String(Math.max(1, duration))
    seek.disabled = !s.now
    seek.closest('.slider-box').classList.toggle('off', seek.disabled)
    if (!view.seeking) {
      const at = Math.min(this.#expected(), duration || Infinity)
      seek.value = String(at)
      fill(seek)
      $('.time').textContent = `${clock(at)} / ${clock(duration)}`
    }

    $('.queue-toggle').setAttribute('aria-pressed', String(view.showQueue))
    $('.yt-side').hidden = !view.showQueue
    view.win.el.querySelector('.yt-body').classList.toggle('queue-open', view.showQueue)
    // The queue: what plays now first, then what waits, each with its
    // picture. Every part of a row is its own anchor, so a pointer on a
    // button lands on that button however wide the row is elsewhere.
    const list = $('.yt-queue')
    const key = JSON.stringify([s.now, s.playing, s.queue])
    if (list.dataset.key !== key) {
      list.dataset.key = key
      const thumb = (id, anchor) => `<img class="thumb" src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg" alt="" loading="lazy" data-cursor-anchor="${anchor}">`
      const now = s.now ? `<li class="now">
          ${thumb(s.now.id, 'now:thumb')}
          <span class="about"><span class="state">${s.playing ? 'playing' : 'paused'}</span>
          <span class="title" data-cursor-anchor="now:title">${escapeHtml(s.now.title ?? s.now.id)}</span></span>
        </li>` : ''
      const empty = s.queue.length ? '' : `<li class="hint">${s.now ? 'nothing after this' : 'nothing queued'} — add a link below</li>`
      list.innerHTML = now + empty + s.queue.map((q, i) => `<li data-key="${q.key}">
        <span class="pic">${thumb(q.id, `q:${q.key}:thumb`)}<span class="n">${i + 1}</span></span>
        <span class="about">
          <span class="title" data-cursor-anchor="q:${q.key}:title">${escapeHtml(q.title ?? q.id)}</span>
          <span class="acts">
            <button type="button" class="wbtn media" data-do="now" title="play now" aria-label="play now" data-cursor-anchor="q:${q.key}:now">${PLAY}</button>
            <button type="button" class="wbtn up" data-do="up" title="earlier" aria-label="earlier" data-cursor-anchor="q:${q.key}:up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="wbtn down" data-do="down" title="later" aria-label="later" data-cursor-anchor="q:${q.key}:down" ${i === s.queue.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="wbtn close" data-do="remove" title="remove" aria-label="remove" data-cursor-anchor="q:${q.key}:remove"></button>
          </span>
        </span>
      </li>`).join('')
    }
  }

  #closeView() {
    const view = this.#view
    if (!view) return
    this.#view = null
    view.cleanup?.()
    try { view.player?.destroy?.() } catch { /* already gone */ }
    this.wm.remove(view.win)
  }
}

/** No captions: the player's preference setting cannot promise that, unloading the module can. */
function noCaptions(player) {
  for (const module of ['captions', 'cc']) {
    try { player?.unloadModule?.(module) } catch { /* not loaded */ }
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
