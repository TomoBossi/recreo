/**
 * YouTube watched together over networks worse than a desk's: far apart,
 * lossy, on a phone's mobile data, in rooms of three and four.
 *
 * Every peer samples its player four times a second in the page, and the
 * samples are compared afterwards. The containers share one clock, so two
 * peers' positions are compared at the same instant, not at whenever each
 * happened to be asked. Each container's network is shaped with netem, on
 * everything it sends: to the other peers, and to YouTube itself.
 *
 * Measured, for each scenario:
 *   start   how long from "play now" until everyone plays
 *   steady  how far apart everyone is while playing: median, p95 and worst,
 *           and the share of the time all are within half a second
 *   stutter per peer: stalls (buffering), jumps (seeks to catch up), time at
 *           a speed other than normal and how often it changed, reloads
 *   held    the share of the time everyone was held for someone
 *   pause, play, seek, next: how long until everyone follows, and how far
 *           apart they are once they have
 *   quality per peer: the quality each played for most of the steady stretch
 *
 * PHONE_QUALITY=480 (or 720, 1080) has the peer on mobile data choose that
 * quality, as someone on a phone might; otherwise every peer is on auto.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = { root: path.resolve(here, '..'), driver: path.resolve(here, 'driver.mjs') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const js = (run, label, code, ms = 20000) => run.cmd(label, code, ms)

const LONG = 'aqz-KE-bpKQ'    // Big Buck Bunny, ten minutes
const OTHER = 'M7lc1UVf-VE'   // YouTube's own API sample

/**
 * Network shapes, applied in a peer's container: `up` to everything it
 * sends, `down` to everything it receives (through an ifb device), so a
 * narrow line is narrow for YouTube's video too, not only for uploads.
 */
const NETS = {
  clean: null,
  // Another city. Shaped on the way out only: between two such peers each
  // direction is delayed by its sender, so the path is even both ways.
  far: { up: 'delay 120ms 30ms distribution normal loss 1%' },
  // Another continent, on wifi that drops a little.
  farther: { up: 'delay 200ms 50ms distribution normal loss 2%' },
  // A phone on poor mobile data: slow, jittery, lossy and narrow, both ways.
  mobile: {
    up: 'delay 125ms 40ms distribution normal loss 2% rate 2mbit',
    down: 'delay 125ms 40ms distribution normal loss 2% rate 4mbit',
  },
}

function shape(run, label, net) {
  const n = NETS[net]
  if (n?.up) run.exec(label, `tc qdisc add dev eth0 root netem ${n.up}`)
  if (n?.down) {
    run.exec(label, ['ip link add ifb0 type ifb', 'ip link set ifb0 up', 'tc qdisc add dev eth0 handle ffff: ingress',
      'tc filter add dev eth0 parent ffff: matchall action mirred egress redirect dev ifb0',
      `tc qdisc add dev ifb0 root netem ${n.down}`].join(' && '))
  }
  run.note(`${label} on ${net}`)
}

// ------------------------------------------------------------- driving

async function start(run, peers) {
  const t = Date.now()
  for (const [label, net] of Object.entries(peers)) {
    run.peer(label, {}, app)
    shape(run, label, net)
  }
  const labels = Object.keys(peers)
  await Promise.all(labels.map((l) => run.waitFor(`${l} to join`, (e) => e.label === l && e.ev === 'driver-joined', 90000)))
  await Promise.all(labels.flatMap((a) => labels.filter((b) => b !== a).map((b) =>
    run.waitFor(`${a} to know ${b}`, (e) => e.label === a && e.ev === 'peer:update' && e.peer === b, 120000))))
  // Chosen before the window opens, which is when the player reads it.
  const quality = process.env.PHONE_QUALITY
  if (quality) {
    for (const [l, net] of Object.entries(peers)) {
      if (net === 'mobile') await js(run, l, `(localStorage.setItem('recreo:yt:quality', ${JSON.stringify(JSON.stringify(quality))}), true)`)
    }
  }
  for (const l of labels) await js(run, l, 'yt-watch')
  return Date.now() - t
}

/** Poll an expression in a page until it is true. */
async function until(run, label, expr, what, ms = 60000) {
  const deadline = Date.now() + ms
  for (;;) {
    if (await js(run, label, expr).catch(() => false)) return
    if (Date.now() > deadline) throw new Error(`${label}: timed out waiting for ${what}`)
    await sleep(500)
  }
}

const open = (run, label) => js(run, label, '(recreo.youtube.pick(), Date.now())')
const add = (run, label, id, now) => js(run, label, `(() => {
  const f = document.querySelector('.yt-add')
  f.querySelector('input').value = 'https://youtu.be/${id}'
  f.requestSubmit(f.querySelector('[name=${now ? 'now' : 'queue'}]'))
  return Date.now()
})()`)
const click = (run, label, sel) => js(run, label, `(document.querySelector(${JSON.stringify(sel)}).click(), Date.now())`)
const seek = (run, label, to) => js(run, label, `(() => {
  const s = document.querySelector('.yt-controls .seek')
  s.value = '${to}'
  s.dispatchEvent(new Event('input'))
  s.dispatchEvent(new Event('change'))
  return Date.now()
})()`)

/** Everything each peer sampled so far, added to what was collected before. */
async function collect(run, labels, into) {
  for (const l of labels) {
    const fresh = await js(run, l, 'yt-samples', 30000).catch(() => [])
    into[l] = [...(into[l] ?? []), ...fresh]
  }
  return into
}

// ------------------------------------------------------------- reading

const PLAYING = 1
const PAUSED = 2
const BUFFERING = 3

/** Where a peer's video was at an instant: its last sample, carried forward. */
function at(list, w) {
  let s = null
  for (const x of list) { if (x.w > w) break; s = x }
  if (!s || w - s.w > 700) return null
  const moving = s.st === PLAYING ? (w - s.w) / 1000 * (s.rate ?? 1) : 0
  // Where the page itself reckons it is; the raw time lags by up to a telling.
  return { pos: (s.p ?? s.t) + moving, s }
}

const pct = (xs, p) => {
  if (!xs.length) return null
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100)

/** How far apart everyone was, every half second, while all played the same video. */
function together(samples, labels, from, to) {
  const spreads = []
  let instants = 0
  let held = 0
  for (let w = from; w < to; w += 500) {
    instants++
    const now = labels.map((l) => at(samples[l], w))
    if (now.some((x) => x?.s.held)) held++
    if (now.some((x) => !x || x.s.st !== PLAYING || x.s.id !== now[0].s.id)) continue
    const ps = now.map((x) => x.pos)
    spreads.push(Math.max(...ps) - Math.min(...ps))
  }
  return {
    median: r2(pct(spreads, 0.5)),
    p95: r2(pct(spreads, 0.95)),
    worst: r2(spreads.length ? Math.max(...spreads) : null),
    inStep: r2(spreads.filter((s) => s < 0.5).length / Math.max(1, instants)),
    allPlaying: r2(spreads.length / Math.max(1, instants)),
    held: r2(held / Math.max(1, instants)),
  }
}

/** One peer's own playback over a stretch: what a person would notice. */
function stutter(list, from, to) {
  const xs = list.filter((x) => x.w >= from && x.w < to)
  let stalls = 0
  let stalledMs = 0
  let jumps = 0
  let offSpeedMs = 0
  let speedChanges = 0
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1]
    const b = xs[i]
    const dt = b.w - a.w
    if (b.st === BUFFERING && a.st !== BUFFERING) stalls++
    if (a.st === BUFFERING) stalledMs += dt
    if (a.st === PLAYING && (a.rate ?? 1) !== 1) offSpeedMs += dt
    if ((a.rate ?? 1) !== (b.rate ?? 1)) speedChanges++
    if (a.st === PLAYING && b.st === PLAYING && a.id === b.id && Math.abs(((b.p ?? b.t) - (a.p ?? a.t)) - dt / 1000 * (a.rate ?? 1)) > 0.5) jumps++
  }
  const reloads = xs.length ? xs.at(-1).reloads - xs[0].reloads : 0
  const seen = {}
  for (const x of xs) if (x.st === PLAYING && x.q) seen[x.q] = (seen[x.q] ?? 0) + 1
  const quality = Object.entries(seen).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return { stalls, stalledS: r2(stalledMs / 1000), jumps, offSpeedS: r2(offSpeedMs / 1000), speedChanges, reloads, quality }
}

/** How long after `w` each peer first matched, and the slowest of them. */
function follow(samples, labels, w, match, ms = 60000) {
  const each = {}
  for (const l of labels) {
    const hit = samples[l].find((x) => x.w >= w && x.w <= w + ms && match(x))
    each[l] = hit ? hit.w - w : null
  }
  const all = Object.values(each)
  return { slowestMs: all.includes(null) ? null : Math.max(...all), each }
}

/** Positions everyone held still at, an instant after a pause. */
function stillSpread(samples, labels, w) {
  const now = labels.map((l) => at(samples[l], w))
  if (now.some((x) => !x || x.s.st !== PAUSED)) return null
  const ps = now.map((x) => x.s.t)
  return r2(Math.max(...ps) - Math.min(...ps))
}

function check(cond, what) { if (!cond) throw new Error(what) }

/** Every sample, beside the run's log, for reading what the numbers hide. */
function keep(run, samples) {
  fs.writeFileSync(path.join(here, 'results', `${run.tag}-samples.json`), JSON.stringify(samples))
}

// ------------------------------------------------------------ the watch

/**
 * The same watch in every scenario: play, a long steady stretch, then pause,
 * play, seek and next, each from somebody else.
 */
async function watch(run, labels, { steadyS = 45 } = {}) {
  const samples = {}
  try {
    return await watching(run, labels, samples, steadyS)
  } catch (err) {
    // A failed run keeps what every player was doing, and says where each stood.
    await collect(run, labels, samples).catch(() => {})
    keep(run, samples)
    const where = await Promise.all(labels.map((l) => js(run, l, `(() => { const s = recreo.youtube.snapshot(); return { t: s.time, player: s.player, now: s.state.now?.id, playing: s.state.playing, held: s.state.held, waiting: s.state.waiting, runner: s.runner, error: s.error, reloads: s.recovery?.reloaded } })()`).catch((e) => String(e))))
    err.message += ` — ${labels.map((l, i) => `${l}: ${JSON.stringify(where[i])}`).join('; ')}`
    throw err
  }
}

async function watching(run, labels, samples, steadyS) {
  const out = {}
  const who = (i) => labels[i % labels.length]

  await open(run, who(0))
  for (const l of labels) await until(run, l, `!!document.querySelector('.yt-add')`, 'the YouTube window')

  const playAt = await add(run, who(1), LONG, true)
  // Started is seen playing in the samples: a player can say "playing" for
  // an instant as it loads, then wait for data.
  const started = (x) => x.id === LONG && x.st === PLAYING
  for (const deadline = Date.now() + 90000; ;) {
    await sleep(2000)
    await collect(run, labels, samples)
    out.start = follow(samples, labels, playAt, started, 90000)
    if (out.start.slowestMs != null || Date.now() > deadline) break
  }
  const steadyFrom = playAt + out.start.slowestMs + 5000

  await sleep(steadyS * 1000)
  await collect(run, labels, samples)
  const steadyTo = Date.now() - 1000
  out.steady = together(samples, labels, steadyFrom, steadyTo)
  out.stutter = Object.fromEntries(labels.map((l) => [l, stutter(samples[l], steadyFrom, steadyTo)]))

  const pauseAt = await click(run, who(-1 + labels.length), '.yt-controls .play')
  await sleep(5000)
  await collect(run, labels, samples)
  // Reached is told to pause and not playing; a player broken meanwhile is
  // the stutter's to report, not the pause's.
  out.pause = { ...follow(samples, labels, pauseAt, (x) => !x.playing && x.st !== PLAYING, 30000), stillSpread: stillSpread(samples, labels, pauseAt + 4500) }

  const resumeAt = await click(run, who(0), '.yt-controls .play')
  await sleep(15000)
  await collect(run, labels, samples)
  out.play = { ...follow(samples, labels, resumeAt, (x) => x.st === PLAYING && x.playing, 30000), after: together(samples, labels, resumeAt + 5000, Date.now() - 1000) }

  const seekAt = await seek(run, who(1), 300)
  await sleep(25000)
  await collect(run, labels, samples)
  const reached = follow(samples, labels, seekAt, (x) => x.st === PLAYING && x.t > 299 && x.t < 330, 25000)
  out.seek = { ...reached, after: reached.slowestMs == null ? null : together(samples, labels, seekAt + reached.slowestMs + 3000, Date.now() - 1000) }

  await add(run, who(2), OTHER, false)
  await until(run, who(0), `recreo.youtube.snapshot().state.queue.length === 1`, 'the queued video', 30000)
  const nextAt = await click(run, who(0), '.yt-controls .next')
  await sleep(15000)
  await collect(run, labels, samples)
  out.next = follow(samples, labels, nextAt, (x) => x.id === OTHER && x.st === PLAYING, 30000)
  out.window = { steadyFrom, steadyTo }

  keep(run, samples)
  return { out, samples }
}

/** What a run must have managed, whatever the network. */
function sane(out) {
  check(out.start.slowestMs != null, 'not everyone started playing')
  check(out.pause.slowestMs != null, 'a pause did not reach everyone')
  check(out.play.slowestMs != null, 'playing on did not reach everyone')
  check(out.seek.slowestMs != null, 'a seek did not reach everyone')
  check(out.next.slowestMs != null, 'skipping did not reach everyone')
}

/** CPU per container, at a moment: a busy machine stutters on its own. */
async function cpu(run) {
  const { docker } = await import(path.resolve(here, '../../plaza/nettest/lib.mjs'))
  const names = [...run.peers.values()].map((p) => p.container).filter(Boolean)
  try {
    return Object.fromEntries(docker('stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}', ...names).split('\n')
      .map((line) => line.split(' ')).map(([n, c]) => [n.split('-').at(-1), c]))
  } catch { return null }
}

// ------------------------------------------------------------ scenarios

export const youtube = {
  /** Three on a clean network: the numbers everything else is read against. */
  async 'yt-baseline'(run) {
    const peers = { ana: 'clean', bob: 'clean', cleo: 'clean' }
    const meshMs = await start(run, peers)
    const cpuDuring = cpu(run)
    const { out } = await watch(run, Object.keys(peers))
    sane(out)
    return { meshMs, cpu: await cpuDuring, ...out }
  },

  /** Three in different cities, and a fourth arriving late from one. */
  async 'yt-far'(run) {
    const peers = { ana: 'far', bob: 'far', cleo: 'far' }
    const meshMs = await start(run, peers)
    const labels = Object.keys(peers)
    const { out, samples } = await watch(run, labels)
    sane(out)

    // dan arrives mid-video, from just as far, and must fall in step.
    const t = Date.now()
    run.peer('dan', {}, app)
    shape(run, 'dan', 'far')
    await run.waitFor('dan to join', (e) => e.label === 'dan' && e.ev === 'driver-joined', 90000)
    await js(run, 'dan', 'yt-watch')
    await until(run, 'dan', `recreo.youtube.snapshot().player === 1`, 'dan playing', 90000)
    await sleep(15000)
    const all = [...labels, 'dan']
    await collect(run, all, samples)
    const joinedPlaying = follow(samples, ['dan'], t, (x) => x.st === PLAYING, 120000).slowestMs
    const inStep = samples.dan.find((x) => {
      const others = labels.map((l) => at(samples[l], x.w))
      return x.st === PLAYING && others.every((o) => o && o.s.st === PLAYING && Math.abs(o.pos - x.t) < 0.5)
    })
    out.late = { playingMs: joinedPlaying, inStepMs: inStep ? inStep.w - t : null, after: together(samples, all, Date.now() - 10000, Date.now() - 1000) }
    keep(run, samples)
    check(out.late.inStepMs != null, 'dan never fell in step')
    return { meshMs, ...out }
  },

  /** Four on another continent each: a full mesh, every link slow. The runner leaves. */
  async 'yt-mesh4-farther'(run) {
    const peers = { ana: 'farther', bob: 'farther', cleo: 'farther', dan: 'farther' }
    const meshMs = await start(run, peers)
    const labels = Object.keys(peers)
    const cpuDuring = cpu(run)
    const { out, samples } = await watch(run, labels)
    sane(out)

    // Whoever is running it leaves; the rest carry on, and a pause still reaches them.
    const ids = Object.fromEntries(run.events.filter((e) => e.ev === 'joined').map((e) => [e.selfId, e.label]))
    const runner = ids[(await js(run, labels[0], 'recreo.youtube.snapshot().runner'))]
    check(runner, 'nobody is running it')
    const stay = labels.filter((l) => l !== runner)
    const leftAt = await click(run, runner, '#leave')
    await sleep(12000)
    await collect(run, stay, samples)
    const carried = together(samples, stay, leftAt + 2000, Date.now() - 1000)
    const pausedAt = await click(run, stay[1], '.yt-controls .play')
    await sleep(6000)
    await collect(run, stay, samples)
    out.runnerLeft = { runner, carried, pause: follow(samples, stay, pausedAt, (x) => x.st === PAUSED, 30000) }
    keep(run, samples)
    check(out.runnerLeft.pause.slowestMs != null, 'after the runner left, a pause did not reach everyone')
    return { meshMs, cpu: await cpuDuring, ...out }
  },

  /** Three on good connections and one phone on poor mobile data. */
  async 'yt-one-mobile'(run) {
    const peers = { ana: 'clean', bob: 'clean', cleo: 'clean', phone: 'mobile' }
    const meshMs = await start(run, peers)
    const { out } = await watch(run, Object.keys(peers), { steadyS: 60 })
    sane(out)
    return { meshMs, ...out }
  },
}

Object.assign(youtube, {
  /** Four as they would really be: one at home, one in another city, one on another continent, one on a phone. */
  async 'yt-mixed'(run) {
    const peers = { ana: 'clean', bob: 'far', cleo: 'farther', phone: 'mobile' }
    const meshMs = await start(run, peers)
    const { out } = await watch(run, Object.keys(peers), { steadyS: 60 })
    sane(out)
    return { meshMs, ...out }
  },
})

export const heavy = new Set(Object.keys(youtube))
