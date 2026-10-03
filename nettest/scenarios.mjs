/**
 * recreo's network scenarios. Each is a function of a fresh Run from plaza's
 * harness; throwing fails it, and whatever it returns is printed.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = { root: path.resolve(here, '..'), driver: path.resolve(here, 'driver.mjs') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function players(run, labels, kind = 'peer') {
  for (const l of labels) run[kind](l, {}, app)
}

/** Wait until every peer has every other in its room, by name. */
async function roomUp(run, labels, ms = 90000) {
  const t0 = Date.now()
  await Promise.all(labels.flatMap((a) => labels.filter((b) => b !== a).map((b) =>
    run.waitFor(`${a} to know ${b}`, (e) => e.label === a && e.ev === 'peer:update' && e.peer === b, ms))))
  await sleep(1000)
  return Date.now() - t0
}

const js = (run, label, code) => run.cmd(label, code, 20000)

/** Make a move, failing loudly if the table refuses it. */
async function play(run, label, id, col) {
  const ok = await js(run, label, `recreo.tables.play(${JSON.stringify(id)}, { col: ${col} })`)
  if (!ok) throw new Error(`${label} could not play column ${col}`)
}

/** Sit someone down and wait until everyone has seen it. */
async function sit(run, labels, label, id, seat) {
  await js(run, label, `recreo.tables.sit(${JSON.stringify(id)}, ${seat})`)
  const deadline = Date.now() + 15000
  for (;;) {
    const views = await Promise.all(labels.map((l) => js(run, l, 'tables')))
    if (views.every((v) => v.find((t) => t.id === id)?.seats[seat] === label)) return
    if (Date.now() > deadline) throw new Error(`${label}'s seat never reached everyone`)
    await sleep(300)
  }
}

/** Every peer's tables, which must be identical. */
async function agree(run, labels, what) {
  const views = await Promise.all(labels.map((l) => js(run, l, 'tables')))
  const [first, ...rest] = views.map((v) => JSON.stringify(v))
  rest.forEach((v, i) => {
    if (v !== first) throw new Error(`${labels[i + 1]} disagrees with ${labels[0]} ${what}:\n  ${labels[0]}: ${first}\n  ${labels[i + 1]}: ${v}`)
  })
  return views[0]
}

/** Wait until every peer's tables agree, or fail with the difference. */
async function converge(run, labels, what, ms = 15000) {
  const deadline = Date.now() + ms
  for (;;) {
    try { return await agree(run, labels, what) } catch (err) {
      if (Date.now() > deadline) throw err
      await sleep(300)
    }
  }
}

/** A connect four game in which seat 0 wins along the bottom row. */
const WINNING = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3]] // [seat, col]

async function shoot(run, label, name) {
  const inside = `/tmp/${name}.png`
  await js(run, label, `ntShot(${JSON.stringify(inside)})`)
  const peer = run.peers.get(label)
  const out = path.join(here, 'results', `${run.tag}-${name}.png`)
  if (peer.kind === 'docker') {
    const { docker } = await import(path.resolve(here, '../../plaza/nettest/lib.mjs'))
    docker('cp', `${peer.container}:${inside}`, out)
  }
  return out
}

export const scenarios = {
  /** Three people in a room see each other. */
  async room3(run) {
    const labels = ['ana', 'tomo', 'lu']
    players(run, labels)
    const ms = await roomUp(run, labels)
    const counts = await Promise.all(labels.map((l) => js(run, l, 'recreo.players.list().length')))
    if (counts.some((n) => n !== 3)) throw new Error(`players seen: ${counts}`)
    return { roomUpMs: ms, shot: await shoot(run, 'ana', 'room3-ana') }
  },

  /**
   * A whole game with a spectator: ana opens a table and sits, tomo sits,
   * lu watches. Every move must land identically on all three, the winner
   * must be the same everywhere, and a rematch must reach everyone.
   */
  async 'c4-game'(run) {
    const labels = ['ana', 'tomo', 'lu']
    players(run, labels)
    await roomUp(run, labels)
    const id = await js(run, 'ana', `(() => { const t = recreo.tables.open('connect4'); recreo.tables.sit(t.id, 0); return t.id })()`)
    await converge(run, labels, 'after opening')
    await sit(run, labels, 'tomo', id, 1)

    for (const [seat, col] of WINNING) {
      const who = seat === 0 ? 'ana' : 'tomo'
      const ok = await js(run, who, `recreo.tables.play(${JSON.stringify(id)}, { col: ${col} })`)
      if (!ok) throw new Error(`${who} could not play column ${col}`)
      await converge(run, labels, `after ${who} played ${col}`)
    }
    const [table] = await agree(run, labels, 'at the end')
    const state = JSON.parse(table.board)
    if (state.winner !== 0) throw new Error(`expected ana to win, state: ${table.board}`)
    const shots = [await shoot(run, 'lu', 'c4-won-lu'), await shoot(run, 'ana', 'c4-won-ana')]

    await js(run, 'tomo', `recreo.tables.rematch(${JSON.stringify(id)})`)
    const [after] = await converge(run, labels, 'after the rematch')
    if (after.gen !== 1 || after.moves !== 0) throw new Error(`rematch did not take: ${JSON.stringify(after)}`)
    return { winner: 'ana', moves: table.moves, shots }
  },

  /** Two people grab the same seat at the same moment; everyone agrees who got it. */
  async 'c4-seat-race'(run) {
    const labels = ['ana', 'tomo', 'lu']
    players(run, labels)
    await roomUp(run, labels)
    const id = await js(run, 'ana', `recreo.tables.open('connect4').id`)
    await converge(run, labels, 'after opening')
    await Promise.all(['tomo', 'lu'].map((l) => js(run, l, `recreo.tables.sit(${JSON.stringify(id)}, 1)`)))
    const [table] = await converge(run, labels, 'after the race')
    if (!table.seats[1]) throw new Error('nobody got the seat')
    return { seat1: table.seats[1] }
  },

  /** Someone arriving mid-game is shown the board exactly as it stands. */
  async 'c4-late-join'(run) {
    players(run, ['ana', 'tomo'])
    await roomUp(run, ['ana', 'tomo'])
    const id = await js(run, 'ana', `(() => { const t = recreo.tables.open('connect4'); recreo.tables.sit(t.id, 0); return t.id })()`)
    await converge(run, ['ana', 'tomo'], 'after opening')
    await sit(run, ['ana', 'tomo'], 'tomo', id, 1)
    for (const [seat, col] of WINNING.slice(0, 4)) {
      await play(run, seat === 0 ? 'ana' : 'tomo', id, col)
      await converge(run, ['ana', 'tomo'], 'mid-game')
    }
    run.peer('pau', {}, app)
    await roomUp(run, ['ana', 'tomo', 'pau'])
    const [table] = await converge(run, ['ana', 'tomo', 'pau'], 'once pau arrived')
    if (table.moves !== 4) throw new Error(`pau sees ${table.moves} moves`)
    return { movesSeenByLateArrival: table.moves }
  },

  /**
   * A player's network dies for forty seconds in the middle of a game. Their
   * seat must be held for them, they must come back to the same board, and
   * the game must carry on.
   */
  async 'c4-drop'(run) {
    const labels = ['ana', 'tomo', 'lu']
    players(run, labels)
    await roomUp(run, labels)
    const id = await js(run, 'ana', `(() => { const t = recreo.tables.open('connect4'); recreo.tables.sit(t.id, 0); return t.id })()`)
    await converge(run, labels, 'after opening')
    await sit(run, ['ana', 'tomo'], 'tomo', id, 1)
    for (const [seat, col] of WINNING.slice(0, 3)) {
      await play(run, seat === 0 ? 'ana' : 'tomo', id, col)
      await converge(run, labels, 'before the drop')
    }

    const cutAt = Date.now()
    run.cut('tomo')
    await run.waitFor('ana to see tomo reconnecting', (e) => e.t > cutAt && e.label === 'ana' && e.ev === 'peer:interrupted' && e.peer === 'tomo', 30000)
    const seatDuring = await js(run, 'ana', `recreo.players.stateOf(recreo.tables.tables.get(${JSON.stringify(id)}).seats[1].player)`)
    const shot = await shoot(run, 'ana', 'c4-drop-ana')
    await sleep(Math.max(0, 40000 - (Date.now() - cutAt)))
    run.restore('tomo')
    const restoredAt = Date.now()
    // Back as the same peer if the hold had not run out, or as a new arrival
    // if it had; either way the seat is tomo's, because seats belong to
    // players rather than connections.
    const back = await run.waitFor('ana to have tomo back', (e) => e.t > restoredAt && e.label === 'ana'
      && (e.ev === 'peer:reconnected' || e.ev === 'peer:join') && e.peer === 'tomo', 60000)

    await converge(run, labels, 'after tomo came back')
    const ok = await js(run, 'tomo', `recreo.tables.play(${JSON.stringify(id)}, { col: 1 })`)
    if (!ok) throw new Error('tomo could not carry on after coming back')
    const [table] = await converge(run, labels, 'after tomo moved again')
    return { seatWhileAway: seatDuring, how: back.ev, backAfterRestoreMs: back.t - restoredAt, moves: table.moves, shot }
  },

  /** A player reloads the page mid-game and gets their seat back. */
  async 'c4-reload'(run) {
    players(run, ['ana', 'tomo'])
    await roomUp(run, ['ana', 'tomo'])
    const id = await js(run, 'ana', `(() => { const t = recreo.tables.open('connect4'); recreo.tables.sit(t.id, 0); return t.id })()`)
    await converge(run, ['ana', 'tomo'], 'after opening')
    await sit(run, ['ana', 'tomo'], 'tomo', id, 1)
    await js(run, 'ana', `recreo.tables.play(${JSON.stringify(id)}, { col: 3 })`)
    await converge(run, ['ana', 'tomo'], 'before the reload')
    const before = await js(run, 'tomo', 'recreo.me.player')

    const at = Date.now()
    await js(run, 'tomo', 'setTimeout(() => location.reload(), 50), true')
    await run.waitFor('tomo to rejoin', (e) => e.t > at && e.label === 'tomo' && e.ev === 'driver-joined', 60000)
    await run.waitFor('ana to see tomo again', (e) => e.t > at && e.label === 'ana' && e.ev === 'peer:update' && e.peer === 'tomo', 60000)
    const [table] = await converge(run, ['ana', 'tomo'], 'after the reload', 20000)
    const after = await js(run, 'tomo', 'recreo.me.player')
    if (after !== before) throw new Error(`tomo came back as a different player (${before} -> ${after})`)
    const ok = await js(run, 'tomo', `recreo.tables.play(${JSON.stringify(id)}, { col: 4 })`)
    if (!ok) throw new Error('tomo could not play after reloading')
    await converge(run, ['ana', 'tomo'], 'after tomo played')
    return { samePlayer: true, seat1: table.seats[1] }
  },

  /**
   * Not a test of behaviour: pictures of a game in progress at a desktop
   * size tiled and floating, and at a phone's width, for a person (or a
   * model) to look at.
   */
  async visual(run) {
    players(run, ['ana', 'tomo'])
    await roomUp(run, ['ana', 'tomo'])
    const id = await js(run, 'ana', `(() => { const t = recreo.tables.open('connect4'); recreo.tables.sit(t.id, 0); return t.id })()`)
    await converge(run, ['ana', 'tomo'], 'after opening')
    await sit(run, ['ana', 'tomo'], 'tomo', id, 1)
    for (const [seat, col] of WINNING) {
      await play(run, seat === 0 ? 'ana' : 'tomo', id, col)
      await converge(run, ['ana', 'tomo'], 'mid-game')
    }
    await js(run, 'ana', `recreo.tables.open('connect4').id`)
    await sleep(800)
    const shots = []
    await js(run, 'tomo', 'ntViewport(1440, 900)')
    await sleep(500)
    shots.push(await shoot(run, 'tomo', 'desktop-tiled'))
    await js(run, 'tomo', `recreo.wm.setMode('floating'), true`)
    await sleep(500)
    shots.push(await shoot(run, 'tomo', 'desktop-floating'))
    await js(run, 'tomo', `recreo.wm.setMode('tiled'), true`)
    await js(run, 'tomo', 'ntViewport(390, 844)')
    await sleep(700)
    shots.push(await shoot(run, 'tomo', 'phone'))
    return { shots }
  },

  /**
   * A browser here against Chromium on a phone (ssh phone, Termux): a game,
   * the phone going dark for forty seconds mid-game, and the game carrying on.
   * On mobile data this crosses a real carrier network.
   */
  async 'phone-c4'(run) {
    run.localPeer('ana', {}, app)
    run.phonePeer('tomo', {}, app)
    const roomMs = await roomUp(run, ['ana', 'tomo'], 120000)
    const id = await js(run, 'ana', `(() => { const t = recreo.tables.open('connect4'); recreo.tables.sit(t.id, 0); return t.id })()`)
    await converge(run, ['ana', 'tomo'], 'after opening')
    await sit(run, ['ana', 'tomo'], 'tomo', id, 1)
    for (const [seat, col] of WINNING.slice(0, 3)) {
      await play(run, seat === 0 ? 'ana' : 'tomo', id, col)
      await converge(run, ['ana', 'tomo'], 'before the freeze')
    }
    const frozeAt = Date.now()
    run.freezePhone()
    await run.waitFor('ana to see the phone go', (e) => e.t > frozeAt && e.label === 'ana' && e.ev === 'peer:interrupted', 40000)
    await sleep(Math.max(0, 40000 - (Date.now() - frozeAt)))
    run.thawPhone()
    const thawedAt = Date.now()
    const back = await run.waitFor('ana to have the phone back', (e) => e.t > thawedAt && e.label === 'ana'
      && (e.ev === 'peer:reconnected' || e.ev === 'peer:join'), 90000)
    await converge(run, ['ana', 'tomo'], 'after the thaw', 30000)
    const ok = await js(run, 'tomo', `recreo.tables.play(${JSON.stringify(id)}, { col: 1 })`)
    if (!ok) throw new Error('the phone could not carry on')
    const [table] = await converge(run, ['ana', 'tomo'], 'after the phone moved')
    return { roomUpMs: roomMs, how: back.ev, backAfterThawMs: back.t - thawedAt, moves: table.moves }
  },

  /** Five people try one room; the last to arrive is told it is full and leaves. */
  async 'full-room'(run) {
    const first = ['ana', 'tomo', 'lu', 'ivo']
    players(run, first)
    await roomUp(run, first)
    run.peer('pau', {}, app)
    const told = await run.waitFor('pau to be turned away', (e) => e.label === 'pau' && e.ev === 'driver-joined', 60000)
      .then(async () => {
        const deadline = Date.now() + 20000
        for (;;) {
          const text = await js(run, 'pau', `document.querySelector('#landing-error').textContent`)
          if (/full/.test(text)) return text
          if (Date.now() > deadline) throw new Error('pau was never told the room is full')
          await sleep(500)
        }
      })
    await sleep(3000)
    const counts = await Promise.all(first.map((l) => js(run, l, 'recreo.players.list().length')))
    if (counts.some((n) => n !== 4)) throw new Error(`the four see ${counts} people`)
    return { told, counts }
  },

  /**
   * Chess with a spectator: a fool's mate, every move compared across all
   * three peers, the result agreed everywhere. Pictures of black's view
   * (the board turns round for them) and of the end from the spectator's.
   */
  async 'chess-game'(run) {
    const labels = ['ana', 'tomo', 'lu']
    players(run, labels)
    await roomUp(run, labels)
    const id = await js(run, 'ana', `(() => { const t = recreo.tables.open('chess'); recreo.tables.sit(t.id, 0); return t.id })()`)
    await converge(run, labels, 'after opening')
    await sit(run, ['ana', 'tomo'], 'tomo', id, 1)
    const moves = [['ana', 13, 21], ['tomo', 52, 36], ['ana', 14, 30], ['tomo', 59, 31]]
    let shotBlack = null
    for (const [who, from, to] of moves) {
      const ok = await js(run, who, `recreo.tables.play(${JSON.stringify(id)}, { from: ${from}, to: ${to} })`)
      if (!ok) throw new Error(`${who} could not play ${from}-${to}`)
      await converge(run, labels, `after ${who} played ${from}-${to}`)
      if (from === 14) {
        await js(run, 'tomo', 'ntViewport(1280, 800)')
        await sleep(400)
        shotBlack = await shoot(run, 'tomo', 'chess-black')
      }
    }
    const [table] = await agree(run, labels, 'at the end')
    const state = JSON.parse(table.board)
    if (state.result?.winner !== 'b') throw new Error(`expected black to win: ${JSON.stringify(state.result)}`)
    await js(run, 'lu', 'ntViewport(1280, 800)')
    await sleep(400)
    return { result: 'black wins by checkmate', shots: [shotBlack, await shoot(run, 'lu', 'chess-mate-lu')] }
  },
}
