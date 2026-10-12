/**
 * Drives recreo for plaza's network test harness.
 *
 * Joins through the real landing page, then narrates what the room and its
 * tables do as JSON lines. Commands arrive as JavaScript evaluated in the
 * page, against the `recreo` handle the app leaves on window.
 *
 * Only page calls that Playwright and puppeteer share, so the same driver
 * runs in a container, on this machine, or on a phone.
 */
export async function start(page, args, out) {
  const room = args.room
  const base = args.base

  // Screenshots from inside the page, of exactly what this person sees.
  await page.exposeFunction('ntShot', async (file) => {
    await page.screenshot({ path: file })
    return file
  })
  // Resize the viewport, in whichever spelling this page library uses.
  await page.exposeFunction('ntViewport', async (width, height) => {
    if (page.setViewportSize) await page.setViewportSize({ width, height })
    else await page.setViewport({ width, height })
    return true
  })

  // Start from nothing remembered, before anything listens for loads.
  await page.goto(`${base}/index.html?room=${encodeURIComponent(room)}`)
  await page.evaluate(() => localStorage.clear())

  // The first load shows the landing page, and the driver presses join, as a
  // person would. A reload goes straight back in — the name is saved by
  // then — and the driver only waits for it. Either way, on every load.
  let joining = null
  const join = async () => {
    await page.waitForFunction(() => document.querySelector('#nick-input'))
    await page.evaluate((nick) => {
      // Someone who has been here before goes straight in from a link: nothing to fill in.
      if (document.documentElement.dataset.straightIn) return
      document.querySelector('#nick-input').value = nick
      document.querySelector('#join-form').requestSubmit()
    }, args.label)
    await page.waitForFunction(() => window.recreo?.room, { timeout: 30000 })
    await hook(page, args.label)
    out({ ev: 'driver-joined' })
  }
  page.on('load', () => { joining = join().catch((err) => out({ ev: 'driver-failed', error: String(err) })) })
  await page.goto(`${base}/index.html?room=${encodeURIComponent(room)}`)
  while (!joining) await new Promise((r) => setTimeout(r, 20))
  await joining
}

async function hook(page, label) {
  await page.evaluate((label) => {
    const { room, tables } = window.recreo
    const log = (ev, extra = {}) => console.log('NT ' + JSON.stringify({ label, ev, ...extra }))
    const who = (peer) => peer.presence?.nick || peer.id.slice(0, 6)

    for (const name of ['peer:join', 'peer:leave', 'peer:interrupted', 'peer:reconnected']) {
      room.on(name, (peer, reason) => log(name, { peer: who(peer), state: peer.net?.state, ...(reason?.message ? { reason: reason.message } : {}) }))
    }
    room.on('peer:update', (peer) => log('peer:update', { peer: who(peer), player: peer.presence.player }))
    room.on('peer:net', (peer, net) => log('peer:net', { peer: who(peer), state: net.state, path: net.path }))
    log('joined', { selfId: room.selfId, player: window.recreo.me.player })

    // A table, summarised the same way on every peer so they can be compared.
    const summary = (t) => ({
      id: t.id, game: t.game, gen: t.gen, closed: t.closed,
      seats: Object.fromEntries(Object.entries(tables.seated(t)).map(([s, p]) => [s, window.recreo.players.nameOf(p)])),
      moves: t.moves.length,
      board: JSON.stringify(t.state),
    })
    tables.on('change', (t) => log('table', summary(t)))

    window.nt = {
      async run(code) {
        if (code.startsWith('tlog')) {
          return room.transportLog.slice(-(Number(code.split(' ')[1]) || 60))
            .map((e) => `${new Date(e.at).toISOString().slice(14, 23)} ${e.peer} ${e.what} ${e.detail ?? ''}`)
        }
        if (code === 'tables') return [...tables.tables.values()].map(summary)
        // The YouTube player, four times a second, kept in the page until asked for.
        if (code === 'yt-watch') {
          if (!window.ntYt) {
            window.ntYt = []
            setInterval(() => {
              const s = window.recreo.youtube?.snapshot()
              if (!s) return
              window.ntYt.push({
                w: Date.now(), t: s.time, p: s.position, st: s.player, rate: s.rate, held: !!s.state.held, playing: !!s.state.playing,
                id: s.state.now?.id ?? null, exp: s.expected, reloads: s.recovery?.reloaded ?? 0, runner: s.runner, q: s.quality,
              })
            }, 250)
          }
          return true
        }
        if (code === 'yt-samples') return (window.ntYt ?? []).splice(0)
        // eslint-disable-next-line no-new-func
        return await new Function('recreo', `return (async () => (${code}))()`)(window.recreo)
      },
    }
  }, label)
}
