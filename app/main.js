import { join, generateRoomCode, normalizeRoom, roomFromUrl, inviteUrl } from 'plaza'
import { LocalMedia, resumeAudio } from 'mirador'

import { WindowManager } from './wm.js'
import { Faces } from './faces.js'
import { Chat } from './chat.js'
import { Tables } from './tables.js'
import { TableView } from './tableview.js'
import { Players } from './players.js'
import { shelf } from './shelf.js'
import { playerId, renewPlayerId, shouldYield } from './identity.js'
import { games, upcoming } from '../games/index.js'

const $ = (sel) => document.querySelector(sel)

/**
 * How many people a room holds. In a full mesh everyone sends their video to
 * everyone else, so upload grows with each person; four stays comfortable on
 * a phone, and four is also the most a rollback game in the mesh supports.
 */
const CAPACITY = 4
const media = new LocalMedia()

// ---------------------------------------------------------------- landing

const nickInput = $('#nick-input')
const roomInput = $('#room-input')
try { nickInput.value = localStorage.getItem('recreo:nick') ?? '' } catch { /* private mode */ }
roomInput.value = roomFromUrl() ?? generateRoomCode()
$('#regenerate').addEventListener('click', () => { roomInput.value = generateRoomCode() })

/** See yourself before going in, and sort out permissions while nobody waits. */
async function startPreview() {
  try {
    const stream = await media.start({ audio: true, video: true })
    $('#preview').srcObject = stream
    $('#preview-placeholder').hidden = true
  } catch {
    // No camera, or no permission: the room works without one.
    $('#preview-placeholder').hidden = false
  }
  syncToggles()
  cameraReady()
}

/** Set once in the room: what to do when the camera turns up late. */
let cameraReady = () => {}

function syncToggles() {
  const s = media.state()
  for (const id of ['#preview-mic', '#mic']) $(id).setAttribute('aria-pressed', String(s.audioEnabled && s.hasStream))
  for (const id of ['#preview-cam', '#cam']) $(id).setAttribute('aria-pressed', String(s.videoEnabled && s.hasStream))
  $('#preview').hidden = !(s.videoEnabled && s.hasStream)
  $('#preview-placeholder').hidden = s.videoEnabled && s.hasStream
}
media.on('state', syncToggles)
for (const id of ['#preview-mic', '#mic']) $(id).addEventListener('click', () => media.toggleAudio())
for (const id of ['#preview-cam', '#cam']) $(id).addEventListener('click', () => media.toggleVideo())

void startPreview()

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const nick = nickInput.value.trim().slice(0, 24)
  const room = normalizeRoom(roomInput.value)
  if (!nick || !room) return
  try { localStorage.setItem('recreo:nick', nick) } catch { /* private mode */ }
  $('#join-button').disabled = true
  try {
    await enterRoom(room, nick)
  } catch (err) {
    $('#landing-error').textContent = err.message
    $('#join-button').disabled = false
  }
})

// ------------------------------------------------------------------- room

async function enterRoom(code, nick) {
  await resumeAudio()
  const me = { player: playerId(), nick }
  const room = await join({
    room: code,
    appId: 'recreo',
    nick,
    presence: { player: me.player, since: Date.now(), ...mediaPresence() },
    // A friend whose connection drops is waited for a full minute. Seats
    // outlast even that — they belong to the player, not the connection.
    readmitMs: 60000,
  })
  history.replaceState(null, '', inviteUrl(code))

  // Video tiles here are small, and in a mesh everyone uploads one stream
  // per other person; this keeps four people inside a phone's uplink.
  void room.limitBitrate({ video: 400, audio: 40 })

  $('#landing').hidden = true
  $('#app').hidden = false
  $('#room-name').textContent = code

  const wm = new WindowManager($('#desk'))
  const players = new Players({ room, me })

  // The faces and the chat are panels: always there, never the master while
  // a table is open.
  const facesBody = document.createElement('div')
  facesBody.className = 'faces-body'
  const facesWin = wm.add({ id: 'faces', title: 'Everyone', tone: 'sun', body: facesBody, order: 0, weight: 1.3 })
  const faces = new Faces(facesBody, { room, media, me })

  const chatBody = document.createElement('div')
  chatBody.className = 'chat-body'
  wm.add({ id: 'chat', title: 'Chat', tone: 'leaf', body: chatBody, order: 100, weight: 1 })
  const chat = new Chat(chatBody, { room })
  chat.selfPlayer = me.player

  const tables = new Tables({ room, me, games })
  const views = new Map() // table id -> {win, view}

  const refreshFaces = () => {
    facesWin.setMeta(`${room.peers.size + 1} here`)
    faces.render()
  }

  // ----------------------------------------------------------- media

  // The camera may arrive after we are already in — permission granted late,
  // or join pressed before the preview had started — so it is sent whenever
  // it appears, not only at the door.
  let sent = null
  const sendCamera = () => {
    if (!media.stream || media.stream === sent) return
    if (sent) room.removeStream(sent)
    sent = media.stream
    room.addStream(sent, { kind: 'camera' })
    faces.stream('self', sent)
  }
  const mediaChanged = () => {
    sendCamera()
    room.updatePresence(mediaPresence())
    refreshFaces()
  }
  // Once now, for a camera that started while we were still joining: the
  // presence sent at the door was taken before it existed.
  mediaChanged()
  media.on('state', mediaChanged)
  cameraReady = mediaChanged

  // ----------------------------------------------------------- people

  const greeted = new Set()
  const greet = (peer) => {
    if (!peer.nick || greeted.has(peer.id)) return
    greeted.add(peer.id)
    chat.system(`${peer.nick} joined`)
  }

  room.on('peer:join', (peer) => { setTimeout(() => greet(peer), 1500); refreshFaces() })
  room.on('peer:update', (peer) => {
    players.learn(peer)
    if (overCapacity()) return roomFull()
    // A duplicated tab copies its player id; one of the two takes a new one.
    if (peer.presence.player === me.player && shouldYield(room.selfId, peer.id)) {
      me.player = renewPlayerId()
      room.updatePresence({ player: me.player })
    }
    greet(peer)
    refreshFaces()
    renderTables()
  })
  room.on('peer:stream', (peer, stream, kind) => {
    if (kind === 'camera') faces.stream(peer.id, stream)
    refreshFaces()
  })
  room.on('peer:interrupted', (peer) => { chat.system(`${peer.nick || 'someone'} is reconnecting…`); refreshFaces(); renderTables() })
  room.on('peer:reconnected', (peer) => { chat.system(`${peer.nick || 'someone'} is back`); refreshFaces(); renderTables() })
  room.on('peer:leave', (peer) => {
    faces.forget(peer.id)
    greeted.delete(peer.id)
    const dropped = peer.net?.state === 'failed'
    chat.system(`${peer.nick || 'someone'} ${dropped ? 'dropped' : 'left'}`)
    refreshFaces()
    renderTables()
  })

  // ----------------------------------------------------------- tables

  function showTable(table, { focus = false } = {}) {
    if (table.closed || views.has(table.id)) return
    const game = games[table.game]
    const body = document.createElement('div')
    body.className = 'table-body'
    const win = wm.add({
      id: `table:${table.id}`,
      title: game.name,
      tone: game.tone,
      body,
      kind: 'table',
      order: 10 + table.at / 1e13,
      closable: true,
      onClose: () => views.get(table.id)?.view.askClose(),
    })
    const view = new TableView(body, { tables, table, players, me })
    views.set(table.id, { win, view })
    win.setMeta(view.summary())
    if (focus) wm.focus(win, { expand: true })
  }

  function renderTables() {
    for (const { win, view } of views.values()) {
      view.render()
      win.setMeta(view.summary())
    }
  }

  tables.on('opened', (table, by) => {
    const mine = by === me.player
    showTable(table)
    // Opening a table is wanting to look at it.
    if (mine) wm.focus(views.get(table.id).win, { expand: true })
    if (!mine) chat.system(`${players.nameOf(by)} opened a ${games[table.game].name.toLowerCase()} table`)
  })
  tables.on('change', (table) => {
    if (!views.has(table.id)) showTable(table)
    const entry = views.get(table.id)
    if (!entry) return
    entry.view.render()
    entry.win.setMeta(entry.view.summary())
  })
  tables.on('closed', (table) => {
    const entry = views.get(table.id)
    if (!entry) return
    entry.view.destroy()
    wm.remove(entry.win)
    views.delete(table.id)
    chat.system(`the ${games[table.game].name.toLowerCase()} table was closed`)
  })

  // ----------------------------------------------------------- top bar

  const pop = $('#shelf-pop')
  pop.append(shelf({
    games,
    upcoming,
    onPick: (gameId) => {
      togglePop(false)
      const table = tables.open(gameId)
      tables.sit(table.id, 0)
    },
  }))
  const togglePop = (open = pop.hidden) => {
    pop.hidden = !open
    $('#new-table').setAttribute('aria-expanded', String(open))
  }
  $('#new-table').addEventListener('click', (e) => { e.stopPropagation(); togglePop() })
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) togglePop(false) })

  const syncMode = () => {
    for (const b of $('#mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === wm.mode))
  }
  $('#mode').addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode
    if (mode) wm.setMode(mode)
  })
  wm.onChange = syncMode
  syncMode()

  const copyInvite = async () => {
    const url = inviteUrl(code)
    try {
      await navigator.clipboard.writeText(url)
      toast('invite link copied — send it to your friends')
    } catch {
      toast(url)
    }
  }
  $('#invite').addEventListener('click', copyInvite)
  $('#room-chip').addEventListener('click', copyInvite)

  $('#leave').addEventListener('click', async () => {
    await room.leave()
    media.stop()
    location.href = location.pathname
  })
  addEventListener('pagehide', () => { void room.leave() })

  /**
   * Four at most. Everyone ranks the room the same way — by when each player
   * came in, then by player id — so whoever is fifth knows it without being
   * told, and leaves by themselves.
   */
  function overCapacity() {
    const entries = [{ player: me.player, since: room.presence.since },
      ...[...room.peers.values()].filter((p) => p.presence.player).map((p) => ({ player: p.presence.player, since: p.presence.since ?? 0 }))]
    entries.sort((a, b) => a.since - b.since || (a.player < b.player ? -1 : 1))
    return entries.findIndex((e) => e.player === me.player) >= CAPACITY
  }

  async function roomFull() {
    await room.leave()
    media.stop()
    $('#app').hidden = true
    $('#landing').hidden = false
    $('#join-button').disabled = false
    $('#landing-error').textContent = `${code} is full — four is the most a room holds. Try another room.`
    delete window.recreo
  }

  chat.system(`welcome to ${code} — invite friends with the button up top`)
  refreshFaces()

  // A handle for the console, and for the test harness.
  window.recreo = { room, tables, wm, players, me, media }
}

function mediaPresence() {
  const s = media.state()
  return { audio: s.audioEnabled && s.hasStream, video: s.videoEnabled && s.hasStream }
}

let toastTimer = null
function toast(text) {
  const el = $('#toast')
  el.textContent = text
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 2600)
}
