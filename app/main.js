import { join, generateRoomCode, normalizeRoom, roomFromUrl, inviteUrl } from 'plaza'
import { LocalMedia, resumeAudio } from 'mirador'

import { WindowManager } from './wm.js'
import { Faces } from './faces.js'
import { Chat } from './chat.js'
import { Tables } from './tables.js'
import { TableView } from './tableview.js'
import { Players } from './players.js'
import { shelf } from './shelf.js'
import { Cursors } from './cursors.js'
import { store, ago } from './store.js'
import { settingsPanel, GEAR } from './settings.js'
import { clampColour, colourFor, colourButton } from './colours.js'
import { ownCursor } from './pointer.js'
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

/** Your colour: chosen once, kept, and the same on everything that is yours. */
let colour = clampColour(store.get('colour', colourFor(playerId())))
const pointer = ownCursor({ colour: () => colour })

/** Change your colour everywhere it shows; the room listens in once joined. */
let colourChanged = () => {}
function setColour(next) {
  colour = clampColour(next)
  store.set('colour', colour)
  pointer.recolour()
  colourChanged(colour)
  for (const b of document.querySelectorAll('.colour-button')) b.style.setProperty('--c', colour)
}

/** On a touchscreen, recreo says so to the others, who see a phone by your name. */
const TOUCH = matchMedia('(pointer: coarse)').matches

for (const b of document.querySelectorAll('.settings-button')) b.innerHTML = GEAR

/**
 * A button that opens a popover, and closes it on a second press or a click
 * anywhere else. `fill` builds the contents each time it opens.
 */
function popover(button, pop, fill) {
  const toggle = (open = pop.hidden) => {
    if (open) fill?.(pop)
    pop.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }
  button.addEventListener('click', (e) => { e.stopPropagation(); toggle() })
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !button.contains(e.target)) toggle(false)
  })
  return toggle
}

// ---------------------------------------------------------------- landing

const nickInput = $('#nick-input')
const roomInput = $('#room-input')
nickInput.value = store.get('nick', '')
$('#name-row').prepend(colourButton({ value: colour, onPick: setColour }))
roomInput.value = roomFromUrl() ?? generateRoomCode()
$('#regenerate').addEventListener('click', () => { roomInput.value = generateRoomCode() })

/** Rooms you have been in, one tap away. */
function showRecent() {
  const recent = $('#recent')
  const rooms = store.rooms()
  recent.hidden = rooms.length === 0
  recent.textContent = ''
  for (const r of rooms.slice(0, 5)) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.textContent = r.code
    chip.title = `last here ${ago(r.at)}`
    chip.addEventListener('click', () => { roomInput.value = r.code; roomInput.focus() })
    recent.append(chip)
  }
}
showRecent()

{
  const anchor = $('#landing-settings')
  popover(anchor.querySelector('button'), anchor.querySelector('.popover'), (pop) => {
    pop.replaceChildren(settingsPanel({
      colour: () => colour,
      onColour: setColour,
      onNick: (nick) => { nickInput.value = nick },
      onRoomsChanged: showRecent,
    }).el)
  })
}

/** See yourself before going in, and sort out permissions while nobody waits. */
async function startPreview() {
  try {
    const stream = await media.start({ audio: true, video: true })
    $('#preview').srcObject = stream
  } catch {
    // No camera, or no permission: the room works without one.
  }
  syncToggles()
  cameraReady()
}

/** Set once in the room: what to do when the camera turns up late. */
let cameraReady = () => {}

function syncToggles() {
  const s = media.state()
  const mic = String(s.audioEnabled && s.hasStream)
  const cam = String(s.videoEnabled && s.hasStream)
  for (const b of document.querySelectorAll('[data-media=mic], #preview-mic')) b.setAttribute('aria-pressed', mic)
  for (const b of document.querySelectorAll('[data-media=cam], #preview-cam')) b.setAttribute('aria-pressed', cam)
  $('#preview').hidden = cam !== 'true'
  $('#preview-placeholder').hidden = cam === 'true'
}
media.on('state', syncToggles)
$('#preview-mic').addEventListener('click', () => media.toggleAudio())
$('#preview-cam').addEventListener('click', () => media.toggleVideo())

void startPreview()

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const nick = nickInput.value.trim().slice(0, 24)
  const room = normalizeRoom(roomInput.value)
  if (!nick || !room) return
  store.set('nick', nick)
  $('#join-button').disabled = true
  try {
    await enterRoom(room, nick)
  } catch (err) {
    $('#landing-error').textContent = err.message
    $('#join-button').disabled = false
  }
})

// ------------------------------------------------------------------- room

/** The microphone and camera, drawn for the Peers title bar. */
const MIC = `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="4.5" y="0.5" width="5" height="8" rx="2.5" fill="currentColor"/>
  <path d="M2.5 6.5 a4.5 4.5 0 0 0 9 0 M7 11 v2.5 M4.5 13.5 h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <line class="slash" x1="1" y1="13" x2="13" y2="1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
const CAM = `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="0.5" y="3.5" width="9" height="7" rx="1.5" fill="currentColor"/>
  <path d="M9.5 6.2 L13.5 4 V10 L9.5 7.8 Z" fill="currentColor"/>
  <line class="slash" x1="1" y1="13" x2="13" y2="1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`

async function enterRoom(code, nick) {
  await resumeAudio()
  const me = { player: playerId(), nick, colour }
  const room = await join({
    room: code,
    appId: 'recreo',
    nick,
    presence: { player: me.player, colour, touch: TOUCH, since: Date.now(), ...mediaPresence() },
    // A friend whose connection drops is waited for a full minute. Seats
    // outlast even that — they belong to the player, not the connection.
    readmitMs: 60000,
  })
  history.replaceState(null, '', inviteUrl(code))
  store.visit(code)

  // Video tiles here are small, and in a mesh everyone uploads one stream
  // per other person; this keeps four people inside a phone's uplink.
  void room.limitBitrate({ video: 400, audio: 40 })

  $('#landing').hidden = true
  $('#app').hidden = false
  $('#room-name').textContent = code

  const wm = new WindowManager($('#desk'))
  const players = new Players({ room, me })

  // Peers and chat are panels: always there, never the master while a game
  // is open. Your microphone and camera live in Peers' title bar.
  const facesBody = document.createElement('div')
  facesBody.className = 'faces-body'
  const mediaTools = ['mic', 'cam'].map((kind) => {
    const b = document.createElement('button')
    b.className = 'wbtn media'
    b.dataset.media = kind
    b.title = kind === 'mic' ? 'microphone' : 'camera'
    b.setAttribute('aria-label', b.title)
    b.innerHTML = kind === 'mic' ? MIC : CAM
    b.addEventListener('click', (e) => { e.stopPropagation(); kind === 'mic' ? media.toggleAudio() : media.toggleVideo() })
    return b
  })
  const facesWin = wm.add({ id: 'faces', title: 'Peers', tone: 'sun', body: facesBody, order: 0, weight: 1.3, tools: mediaTools })
  const faces = new Faces(facesBody, { room, media, me, players })
  syncToggles()

  const chatBody = document.createElement('div')
  chatBody.className = 'chat-body'
  wm.add({ id: 'chat', title: 'Chat', tone: 'leaf', body: chatBody, order: 100, weight: 1 })
  const chat = new Chat(chatBody, { room, players })
  chat.selfPlayer = me.player

  const tables = new Tables({ room, me, games, present: (player) => players.stateOf(player) === 'here' })
  const views = new Map() // game id -> {win, view}
  const cursors = new Cursors({ room, desk: $('#desk'), players })

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
    renderGames()
  })
  room.on('peer:stream', (peer, stream, kind) => {
    if (kind === 'camera') faces.stream(peer.id, stream)
    refreshFaces()
  })
  room.on('peer:interrupted', (peer) => { chat.system(`${peer.nick || 'someone'} is reconnecting…`); refreshFaces(); renderGames() })
  room.on('peer:reconnected', (peer) => { chat.system(`${peer.nick || 'someone'} is back`); refreshFaces(); renderGames() })
  room.on('peer:leave', (peer) => {
    faces.forget(peer.id)
    greeted.delete(peer.id)
    const dropped = peer.net?.state === 'failed'
    chat.system(`${peer.nick || 'someone'} ${dropped ? 'dropped' : 'left'}`)
    refreshFaces()
    renderGames()
  })

  // ----------------------------------------------------------- games

  const gameName = (table) => games[table.game].name

  function showGame(table) {
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
      closeLabel: 'end this game',
      onClose: () => views.get(table.id)?.view.askClose(),
    })
    const view = new TableView(body, { tables, table, players, me })
    views.set(table.id, { win, view })
    win.setMeta(view.summary())
  }

  function renderGames() {
    for (const { win, view } of views.values()) {
      view.render()
      win.setMeta(view.summary())
    }
  }

  tables.on('opened', (table, by) => {
    const mine = by === me.player
    showGame(table)
    // Starting a game is wanting to look at it.
    if (mine) wm.focus(views.get(table.id).win, { expand: true })
    if (!mine) chat.system(`${players.nameOf(by)} started a game of ${gameName(table).toLowerCase()}`)
  })
  tables.on('change', (table) => {
    if (!views.has(table.id)) showGame(table)
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
    chat.system(`the game of ${gameName(table).toLowerCase()} was ended`)
  })

  // ----------------------------------------------------------- top bar

  const toggleShelf = popover($('#new-table'), $('#shelf-pop'))
  $('#shelf-pop').append(shelf({
    games,
    upcoming,
    onPick: (gameId) => {
      toggleShelf(false)
      const table = tables.open(gameId)
      tables.sit(table.id, 0)
    },
  }))

  const settingsAnchor = $('#settings').parentElement
  popover($('#settings'), settingsAnchor.querySelector('.popover'), (pop) => {
    pop.replaceChildren(settingsPanel({
      room,
      wm,
      cursors,
      colour: () => colour,
      onColour: setColour,
      onNick: (next) => {
        me.nick = next
        room.setNick(next)
        refreshFaces()
        renderGames()
      },
    }).el)
  })

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

  colourChanged = (next) => {
    me.colour = next
    room.updatePresence({ colour: next })
    refreshFaces()
    renderGames()
  }

  chat.system(`welcome to ${code} — invite friends with the button up top`)
  refreshFaces()

  // A handle for the console, and for the test harness.
  window.recreo = { room, tables, wm, players, me, media, cursors }
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
