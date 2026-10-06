/**
 * Sounds, made on the spot by the browser's Web Audio: tones and filtered
 * noise shaped by quick envelopes, the way shapes make every picture. No
 * sound files.
 *
 *   import { sound, countdown } from '../kit/sound.js'
 *   sound.play('select')
 *   const ticks = countdown()      // a clock's last five seconds, ticking
 *   ticks.update(msLeft)           // as the clock is redrawn
 *
 * Nothing plays until the page has been clicked or typed into — browsers
 * insist — and nothing plays when the player has turned sounds off.
 */

/** How loud each setting is, against the sounds' own levels. */
const LEVELS = { on: 1, quiet: 0.4, off: 0 }
const KEY = 'recreo:sound'

let audio = null
let master = null
let noise = null
let level = load()

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    return saved in LEVELS ? saved : 'on'
  } catch { return 'on' }
}

/**
 * Start the audio, from inside a click or a key press: the first one on the
 * page, which the room passes on. Before then every sound is silent.
 */
export function unlock() {
  if (!audio) {
    try {
      audio = new AudioContext({ latencyHint: 'interactive' })
    } catch { return }
    master = audio.createGain()
    master.gain.value = LEVELS[level]
    master.connect(audio.destination)
    noise = noiseFor(audio)
  }
  if (audio.state === 'suspended') audio.resume()
}

/** Fill a buffer with white noise: the raw stuff of clicks and knocks. */
function noiseFor(context) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** A tone: a pitch (that may slide), a waveform, a quick rise and a fade. */
function tone(at, { freq, to = freq, type = 'sine', gain = 0.2, length = 0.05, attack = 0.002 }) {
  const osc = audio.createOscillator()
  const env = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, at + length)
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(gain, at + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(env).connect(master)
  osc.start(at)
  osc.stop(at + length + 0.02)
}

/** A burst of noise through a band of frequencies: the snap of a click, the knock of wood. */
function burst(at, { freq = 2500, q = 1.2, gain = 0.1, length = 0.02 }) {
  const src = audio.createBufferSource()
  src.buffer = noise
  const band = audio.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = freq
  band.Q.value = q
  const env = audio.createGain()
  env.gain.setValueAtTime(gain, at)
  env.gain.exponentialRampToValueAtTime(0.0001, at + length)
  src.connect(band).connect(env).connect(master)
  src.start(at, Math.random() * 0.5)
  src.stop(at + length + 0.02)
}

/** Every sound, by name: a function of the moment to start it. */
const SOUNDS = {
  // A button going down, and coming back up: a soft plastic click pair.
  press: (t) => {
    burst(t, { freq: 2200, gain: 0.07, length: 0.012 })
    tone(t, { freq: 620, to: 430, gain: 0.16, length: 0.045 })
  },
  release: (t) => {
    burst(t, { freq: 3600, gain: 0.04, length: 0.008 })
    tone(t, { freq: 980, to: 900, gain: 0.08, length: 0.03 })
  },
  // A choice picked from several: two quick notes, up.
  select: (t) => {
    tone(t, { freq: 740, gain: 0.11, length: 0.045 })
    tone(t + 0.045, { freq: 1110, gain: 0.11, length: 0.06 })
  },
  // Something switched on, or off: a slide up, or down.
  on: (t) => { tone(t, { freq: 560, to: 1050, type: 'triangle', gain: 0.14, length: 0.08 }) },
  off: (t) => { tone(t, { freq: 1000, to: 520, type: 'triangle', gain: 0.12, length: 0.08 }) },
  // Someone else said something in a chat out of sight: a soft pop, and a note above it.
  message: (t) => {
    tone(t, { freq: 520, to: 880, gain: 0.13, length: 0.07, attack: 0.004 })
    tone(t + 0.075, { freq: 1320, type: 'triangle', gain: 0.07, length: 0.09, attack: 0.004 })
  },
  // A clock's last seconds: a wooden tick and tock, and the last one brighter.
  tick: (t) => {
    burst(t, { freq: 3200, q: 3, gain: 0.12, length: 0.018 })
    tone(t, { freq: 1480, gain: 0.2, length: 0.04 })
  },
  tock: (t) => {
    burst(t, { freq: 2400, q: 3, gain: 0.12, length: 0.02 })
    tone(t, { freq: 1120, gain: 0.2, length: 0.045 })
  },
  last: (t) => {
    burst(t, { freq: 3800, q: 3, gain: 0.13, length: 0.02 })
    tone(t, { freq: 1900, gain: 0.22, length: 0.07 })
  },

  // Pieces. A piece lifted: a light wooden tick.
  pick: (t) => {
    burst(t, { freq: 2600, q: 4, gain: 0.08, length: 0.012 })
    tone(t, { freq: 880, to: 990, gain: 0.07, length: 0.03 })
  },
  // A piece set down: a wooden clack, low and round.
  place: (t) => {
    burst(t, { freq: 1300, q: 2.5, gain: 0.16, length: 0.03 })
    tone(t, { freq: 420, to: 300, gain: 0.2, length: 0.07 })
  },
  // One piece knocking another off: two clacks, the second harder.
  capture: (t) => {
    burst(t, { freq: 1500, q: 2.5, gain: 0.12, length: 0.025 })
    tone(t, { freq: 470, to: 360, gain: 0.14, length: 0.05 })
    burst(t + 0.07, { freq: 1100, q: 2, gain: 0.19, length: 0.035 })
    tone(t + 0.07, { freq: 360, to: 250, gain: 0.22, length: 0.09 })
  },
  // A disc landing in its column: a plastic knock with a little ring.
  land: (t) => {
    burst(t, { freq: 2200, q: 3, gain: 0.13, length: 0.02 })
    tone(t, { freq: 660, to: 520, type: 'triangle', gain: 0.16, length: 0.09 })
  },
  // A pen stroke on paper: a short scratch of noise.
  mark: (t) => {
    burst(t, { freq: 4200, q: 1.5, gain: 0.08, length: 0.05 })
    burst(t + 0.05, { freq: 3600, q: 1.5, gain: 0.06, length: 0.04 })
  },
  // Someone got it right: three bright notes up.
  correct: (t) => {
    tone(t, { freq: 784, type: 'triangle', gain: 0.13, length: 0.08 })
    tone(t + 0.07, { freq: 988, type: 'triangle', gain: 0.13, length: 0.08 })
    tone(t + 0.14, { freq: 1319, type: 'triangle', gain: 0.14, length: 0.16 })
  },

  // Endings, with the notice that says so.
  win: (t) => {
    ;[523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, { freq: f, type: 'triangle', gain: 0.14, length: i === 3 ? 0.28 : 0.1 }))
  },
  lose: (t) => {
    tone(t, { freq: 494, type: 'triangle', gain: 0.13, length: 0.14 })
    tone(t + 0.16, { freq: 370, type: 'triangle', gain: 0.13, length: 0.3 })
  },
  draw: (t) => {
    tone(t, { freq: 587, type: 'triangle', gain: 0.12, length: 0.12 })
    tone(t + 0.14, { freq: 587, type: 'triangle', gain: 0.12, length: 0.2 })
  },
}

export const sound = {
  /** The names there are, for a page that plays them all. */
  names: Object.keys(SOUNDS),

  /** Play a sound now, if sounds are on and the page has been touched. */
  /**
   * Play a sound now, if sounds are on and the page has been touched.
   * `from`: the element it belongs to — a game's stage, say; a game folded
   * away to its title bar makes no sound.
   */
  play(name, { from = null } = {}) {
    if (!audio || level === 'off' || audio.state !== 'running') return
    if (from && (!from.isConnected || from.closest('.win.collapsed'))) return
    SOUNDS[name]?.(audio.currentTime + 0.003)
  },

  /** 'on', 'quiet' or 'off', remembered in this browser. */
  get level() { return level },
  setLevel(next) {
    if (LEVELS[next] == null) return
    level = next
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
    if (master) master.gain.setTargetAtTime(LEVELS[next], audio.currentTime, 0.02)
  },
}

/**
 * A sound, rendered offline instead of played: its samples, for drawing it
 * or measuring how loud it is. At full loudness, whatever the setting.
 */
export async function render(name, seconds = 0.25) {
  const offline = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100)
  const live = [audio, master, noise]
  audio = offline
  master = offline.createGain()
  master.connect(offline.destination)
  noise = noiseFor(offline)
  try {
    SOUNDS[name](0.003)
  } finally {
    ;[audio, master, noise] = live
  }
  return (await offline.startRendering()).getChannelData(0)
}

/**
 * A clock's last seconds, ticking: tick, tock, tick, tock, and a brighter
 * last one. Call update with the time left whenever the clock is redrawn;
 * each whole second from `from` down to one sounds once, on the moment it
 * is reached. A clock that is wound back up — a new turn, a new round —
 * starts over.
 */
export function countdown({ from = 5 } = {}) {
  let last = null
  return {
    update(ms) {
      if (ms == null || ms <= 0) { last = ms == null ? null : 0; return }
      const whole = Math.ceil(ms / 1000)
      if (last != null && whole > last) last = null // wound back up
      if (whole === last || whole > from) { if (whole > from) last = null; return }
      if (last != null && last - whole > 1) { last = whole; return } // came back from a pause: no burst of ticks
      last = whole
      sound.play(whole === 1 ? 'last' : whole % 2 ? 'tick' : 'tock')
    },
    /** The clock stopped: the next update starts afresh. */
    reset() { last = null },
  }
}
