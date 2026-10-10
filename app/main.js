import { avatar, playable, randomCharacter, remember, REFRESH } from './avatar.js'
import { devicePickers, restoreDevices } from './devices.js'
import { peersMenuButton } from './peersmenu.js'
import { join, generateRoomCode, normalizeRoom, roomFromUrl, inviteUrl } from 'plaza'
import { LocalMedia, resumeAudio, videoProfileFor } from 'mirador'

import { WindowManager } from './wm.js'
import { Faces } from './faces.js'
import { Chat } from './chat.js'
import { Tables } from './tables.js'
import { TableView } from './tableview.js'
import { Players } from './players.js'
import { shelf } from './shelf.js'
import { Live } from './live.js'
import { clickSounds } from './clicks.js'
import { notify, notices } from './notify.js'
import { Cursors } from './cursors.js'
import { store, ago } from './store.js'
import { settingsPanel, GEAR } from './settings.js'
import { BELL, setPageIcon } from './bell.js'
import { clampColour, colourFor, colourButton, PRESETS } from '../games/kit/colours.js'
import { ownCursor } from './pointer.js'
import { CAPACITY, TABLES } from './limits.js'
import { playerId, renewPlayerId, shouldYield } from './identity.js'
import { games, upcoming, shelved } from '../games/index.js'

const $ = (sel) => document.querySelector(sel)

// Every control clicks, everywhere, from the welcome screen on.
clickSounds()

// Each game's own stylesheet, from its folder.
for (const game of Object.values(games)) {
  if (!game.styles) continue
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = game.styles
  document.head.append(link)
}

const media = new LocalMedia()

/**
 * Your colour: the one you chose, or else a preset picked at random on your
 * first visit and kept as your default. The two are stored apart, so a
 * default can still step aside for someone else (see avoidSameColour) while
 * a choice never does.
 */
const randomPreset = (from = PRESETS) => from[crypto.getRandomValues(new Uint32Array(1))[0] % from.length]
if (!store.get('colour', null) && !store.get('colour-default', null)) store.set('colour-default', randomPreset())
let colour = clampColour(store.get('colour', null) ?? store.get('colour-default', null) ?? colourFor(playerId()))
const pointer = ownCursor({ colour: () => colour })

/** Change your colour everywhere it shows; the room listens in once joined. */
let colourChanged = () => {}
function setColour(next, { chosen = true } = {}) {
  colour = clampColour(next)
  // A colour someone picks is theirs; a default that moved is the new default.
  store.set(chosen ? 'colour' : 'colour-default', colour)
  pointer.recolour()
  colourChanged(colour)
  for (const b of document.querySelectorAll('.colour-button')) b.style.setProperty('--c', colour)
  // Your character's disc, and whatever frames it, take the colour at once.
  for (const el of document.querySelectorAll('.self-colour')) el.style.setProperty('--who', colour)
}

/**
 * Your character: the one you last rolled, or one rolled for you on your
 * first visit. One that has left the roster since is rolled again.
 */
let character = playable(store.get('character', null))
store.set('character', character)
remember(character)

/** Change your character everywhere it shows; the room listens in once joined. */
let characterChanged = () => {}
function setCharacter(next) {
  character = playable(next)
  store.set('character', character)
  remember(character)
  $('#preview-placeholder').innerHTML = avatar(character)
  $('#preview-character').innerHTML = avatar(character)
  characterChanged(character)
}

/**
 * Centre the wordmark on what you see, not on its box. "recreo" has no tall
 * letters, so its ink sits low in the line, and its drop shadow adds weight
 * below; measured from the font in use, it is nudged so the letters and
 * their shadow sit on the centre line of whatever they share a row with.
 */
function centreWordmark(el) {
  const cs = getComputedStyle(el)
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const m = ctx.measureText(el.textContent)
  const size = parseFloat(cs.fontSize)
  const lineHeight = parseFloat(cs.lineHeight) || size
  const ascent = m.fontBoundingBoxAscent
  const descent = m.fontBoundingBoxDescent
  if (!ascent || !m.actualBoundingBoxAscent) return
  const baseline = (lineHeight - (ascent + descent)) / 2 + ascent
  const inkTop = baseline - m.actualBoundingBoxAscent
  const inkBottom = baseline + m.actualBoundingBoxDescent
  // The drop shadow is a solid copy offset down: count half of it as ink.
  const drop = parseFloat((cs.textShadow.match(/(-?[\d.]+)px (-?[\d.]+)px 0px[^,]*$/) ?? [])[2] ?? 0)
  const shift = lineHeight / 2 - (inkTop + inkBottom + drop / 2) / 2
  el.style.transform = `translateY(${shift.toFixed(2)}px)`
}
const centreWordmarks = () => document.querySelectorAll('.wordmark').forEach(centreWordmark)
document.fonts?.ready.then(centreWordmarks)
addEventListener('resize', centreWordmarks)

/** On a touchscreen, recreo says so to the others, who see a phone by your name. */
const TOUCH = matchMedia('(pointer: coarse)').matches

for (const b of document.querySelectorAll('.settings-button')) b.innerHTML = GEAR
for (const slot of document.querySelectorAll('.bell-slot')) slot.innerHTML = BELL
setPageIcon()

/**
 * A button that opens a popover, and closes it on a second press or a click
 * anywhere else. `fill` builds the contents each time it opens.
 */
function popover(button, pop, fill) {
  const toggle = (open = pop.hidden) => {
    if (open) fill?.(pop)
    // On a phone a popover spans the screen; it starts just below its button.
    if (open) pop.style.setProperty('--pop-top', `${Math.round(button.getBoundingClientRect().bottom + 10)}px`)
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
$('#preview-placeholder').innerHTML = avatar(character)
$('.preview').style.setProperty('--who', colour)
$('#preview-character').innerHTML = avatar(character)
$('#preview-reroll').innerHTML = REFRESH
$('#preview-reroll').addEventListener('click', () => setCharacter(randomCharacter(character)))
$('#name-row').prepend(colourButton({ value: colour, onPick: setColour }))
roomInput.value = roomFromUrl() ?? generateRoomCode()
$('#regenerate').addEventListener('click', () => { roomInput.value = generateRoomCode() })

/**
 * The room field is also a list of the rooms you were in last, newest
 * first: it opens when the field is clicked or focused, narrows as you
 * type, and each room can be forgotten from it.
 */
const roomList = $('#room-list')
let roomActive = -1
function showRecent() {
  const typed = roomInput.value.trim().toLowerCase()
  const rooms = store.rooms().filter((r) => !typed || r.code.includes(typed) || document.activeElement !== roomInput || roomList.dataset.all)
  roomList.textContent = ''
  rooms.forEach((r, i) => {
    const li = document.createElement('li')
    li.role = 'option'
    li.className = i === roomActive ? 'active' : ''
    li.dataset.code = r.code
    li.innerHTML = '<span class="code"></span><span class="when"></span><button type="button" class="forget">×</button>'
    li.querySelector('.code').textContent = r.code
    li.querySelector('.when').textContent = ago(r.at)
    li.querySelector('.forget').setAttribute('aria-label', `forget ${r.code}`)
    roomList.append(li)
  })
  return rooms.length
}
function openRooms(all) {
  roomList.dataset.all = all ? '1' : ''
  roomActive = -1
  const any = showRecent()
  roomList.hidden = !any
  roomInput.setAttribute('aria-expanded', String(any > 0))
  // Open upward when the page has no room for the list below the field.
  if (any) {
    roomList.classList.remove('up')
    const below = innerHeight - roomInput.getBoundingClientRect().bottom
    if (roomList.offsetHeight + 12 > below && roomInput.getBoundingClientRect().top > below) roomList.classList.add('up')
  }
}
function closeRooms() {
  roomList.hidden = true
  roomInput.setAttribute('aria-expanded', 'false')
}
roomInput.addEventListener('focus', () => openRooms(true))
roomInput.addEventListener('click', () => { if (roomList.hidden) openRooms(true) })
roomInput.addEventListener('input', () => openRooms(false))
roomInput.addEventListener('blur', () => setTimeout(closeRooms, 120))
roomInput.addEventListener('keydown', (e) => {
  const items = [...roomList.children]
  if (e.key === 'Escape') return closeRooms()
  if (!items.length || roomList.hidden) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    roomActive = (roomActive + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items.forEach((li, i) => li.classList.toggle('active', i === roomActive))
  } else if (e.key === 'Enter' && roomActive >= 0) {
    e.preventDefault()
    roomInput.value = items[roomActive].dataset.code
    closeRooms()
  }
})
// pointerdown, so the choice lands before the field's blur closes the list.
roomList.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  const li = e.target.closest('li')
  if (!li) return
  if (e.target.closest('.forget')) {
    store.forget(li.dataset.code)
    if (!showRecent()) closeRooms()
    return
  }
  roomInput.value = li.dataset.code
  closeRooms()
})

{
  const anchor = $('#landing-settings')
  popover(anchor.querySelector('button'), anchor.querySelector('.popover'), (pop) => {
    pop.replaceChildren(settingsPanel({ identity: false, saved: false }).el)
  })
}

const MIC = `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="4.5" y="0.5" width="5" height="8" rx="2.5" fill="currentColor"/>
  <path d="M2.5 6.5 a4.5 4.5 0 0 0 9 0 M7 11 v2.5 M4.5 13.5 h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <line class="slash" x1="1" y1="13" x2="13" y2="1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
const CAM = `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="0.5" y="3.5" width="9" height="7" rx="1.5" fill="currentColor"/>
  <path d="M9.5 6.2 L13.5 4 V10 L9.5 7.8 Z" fill="currentColor"/>
  <line class="slash" x1="1" y1="13" x2="13" y2="1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`

/**
 * Your microphone and camera start as you last left them — off stays off —
 * which matters most arriving straight from a link, with no preview first.
 * One the page does not have yet is asked for when you turn it on.
 */
function toggleMedia(kind) {
  if (!holds(kind)) return void turnOn(kind)
  if (kind === 'audio') media.toggleAudio()
  else void cameraOn(!media.videoEnabled)
  store.set(`media:${kind}`, kind === 'audio' ? media.audioEnabled : media.videoEnabled)
}

/** Turning the camera back on asks the browser for it again, which can fail like the first time. */
async function cameraOn(on) {
  let failure = null
  const off = media.once('error', (err) => { failure = err })
  await media.setVideoEnabled(on)
  off()
  if (on && !media.videoEnabled) await explain('video', failure)
}

const DEVICE = { audio: 'microphone', video: 'camera' }

/** Whether this page may use the microphone or camera: 'granted', 'prompt' or 'denied'. A browser that cannot say answers 'prompt'. */
async function permission(kind) {
  try { return (await navigator.permissions.query({ name: DEVICE[kind] })).state } catch { return 'prompt' }
}

/** Whether the page has a microphone or camera at all, on or off. */
const holds = (kind) => !!media.stream?.getTracks().some((t) => t.kind === kind)

/**
 * Ask the browser for a microphone and camera, each then set as you last
 * left it. Asking again replaces the stream; in the room the new one is
 * sent in place of the old.
 */
async function acquire(kinds) {
  await media.start({ audio: kinds.includes('audio'), video: kinds.includes('video') })
  media.setAudioEnabled(store.get('media:audio', true) !== false)
  await media.setVideoEnabled(store.get('media:video', true) !== false)
  $('#preview').srcObject = media.stream
}

/** One request at a time: a second tap waits for the first, then finds it done. */
let asking = Promise.resolve()

/**
 * Turn on a microphone or camera the page does not have yet. A blocked one
 * is never asked for again behind your back: the browser refuses at once,
 * and the notice says where to allow it. `auto` is the page itself asking,
 * after you allowed it in the site settings: nothing changes what you last
 * chose, and nothing is said.
 */
function turnOn(kind, { auto = false } = {}) {
  asking = asking.then(async () => {
    if (holds(kind)) return
    if (auto && store.get(`media:${kind}`, true) === false) return
    if (!auto) store.set(`media:${kind}`, true)
    try {
      await acquire(['audio', 'video'].filter((k) => k === kind || holds(k)))
    } catch (err) {
      if (!auto) await explain(kind, err)
    }
    syncToggles()
    cameraReady()
  })
  return asking
}

/** Why a microphone or camera could not be had, in a notice. Saying no to the browser's question needs no answer. */
async function explain(kind, err = null) {
  const name = DEVICE[kind]
  const state = await permission(kind)
  if (state === 'denied') toast(`your ${name} is blocked for this site — allow it in the site settings, by the address bar`)
  else if (err?.name === 'NotFoundError') toast(`no ${name} found on this device`)
  else if (err?.name === 'NotReadableError') toast(`your ${name} is in use by another app`)
  else if (err?.name === 'NotAllowedError' && state === 'granted') toast(`your device is not letting the browser use your ${name} — allow it in its privacy settings`)
  else if (err && err.name !== 'NotAllowedError') toast(`could not start your ${name}`)
}

/** See yourself before going in, and sort out permissions while nobody waits. */
function startPreview() {
  asking = asking.then(async () => {
    try {
      await restoreDevices(media)
      // A blocked one is left alone, so the other still starts.
      const kinds = []
      for (const kind of ['audio', 'video']) if (await permission(kind) !== 'denied') kinds.push(kind)
      if (kinds.length) await acquire(kinds)
    } catch {
      // No camera, or no permission: the room works without one.
    }
    syncToggles()
    cameraReady()
  })
}

// Allowed in the site settings while the page is open: it starts without a reload.
for (const kind of ['audio', 'video']) {
  navigator.permissions?.query({ name: DEVICE[kind] }).then((status) => {
    status.addEventListener('change', () => { if (status.state === 'granted') void turnOn(kind, { auto: true }) })
  }).catch(() => {})
}

/** Set once in the room: what to do when the camera turns up late. */
let cameraReady = () => {}

function syncToggles() {
  const s = media.state()
  const mic = String(s.audioEnabled && holds('audio'))
  const cam = String(s.videoEnabled && holds('video'))
  for (const b of document.querySelectorAll('[data-media=mic], #preview-mic')) b.setAttribute('aria-pressed', mic)
  for (const b of document.querySelectorAll('[data-media=cam], #preview-cam')) b.setAttribute('aria-pressed', cam)
  $('#preview').hidden = cam !== 'true'
  $('#preview-placeholder').hidden = cam === 'true'
  // With the camera on, your character shows small by the button that rolls
  // another; with it off, it fills the preview.
  $('#preview-character').hidden = cam !== 'true'
}
media.on('state', syncToggles)
// Switching camera or microphone makes a new stream; the preview follows it.
media.on('stream', (stream) => { $('#preview').srcObject = stream })
$('#preview-devices').append(devicePickers(media).el)
// The same icons as the Peers window's buttons, drawn larger over the preview.
$('#preview-mic').innerHTML = MIC
$('#preview-cam').innerHTML = CAM
$('#preview-mic').addEventListener('click', () => toggleMedia('audio'))
$('#preview-cam').addEventListener('click', () => toggleMedia('video'))

startPreview()

/** Whether a room is being joined: one at a time, however many presses. */
let entering = false

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const nick = nickInput.value.trim().slice(0, 24)
  const room = normalizeRoom(roomInput.value)
  if (!nick || !room || entering) return
  store.set('nick', nick)
  $('#join-button').disabled = true
  try {
    await enterRoom(room, nick)
  } catch (err) {
    $('#landing-error').textContent = err.message
    $('#join-button').disabled = false
  }
})

/**
 * A link to a room, opened by someone who has been here before, goes
 * straight in: their name, colour, microphone and camera are as they left
 * them. (The page hides the welcome screen before it paints — see the
 * script at the top of index.html.) The first visit still shows it, room
 * filled in, and so does anything that goes wrong.
 */
if (document.documentElement.dataset.straightIn) {
  const nick = store.get('nick', '').trim().slice(0, 24)
  const room = normalizeRoom(roomFromUrl() ?? '')
  const welcome = (message = '') => {
    delete document.documentElement.dataset.straightIn
    $('#landing-error').textContent = message
    $('#join-button').disabled = false
  }
  if (!nick || !room) welcome()
  else {
    $('#join-button').disabled = true
    enterRoom(room, nick).catch((err) => welcome(err.message))
  }
}

// ------------------------------------------------------------------- room

async function enterRoom(code, nick) {
  entering = true
  try {
    await joinRoom(code, nick)
  } catch (err) {
    entering = false
    throw err
  }
}

/** The microphone and camera, drawn for the Peers title bar. */
async function joinRoom(code, nick) {
  await resumeAudio()
  const me = { player: playerId(), nick, colour, character }
  const room = await join({
    room: code,
    appId: 'recreo',
    nick,
    presence: { player: me.player, colour, character, touch: TOUCH, since: Date.now(), ...mediaPresence() },
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
  centreWordmarks()
  // The welcome screen's preview is gone from view; stop it drawing frames.
  $('#preview').srcObject = null
  $('#room-name').textContent = code
  $('#room-chip').title = code // all of it, where a phone has room for only some

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
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleMedia(kind === 'mic' ? 'audio' : 'video') })
    return b
  })
  // A menu beside them: the layout, and which camera and microphone.
  const peersMenu = peersMenuButton({ media, faces: () => faces })
  const facesWin = wm.add({ id: 'faces', title: 'Peers', tone: 'sun', body: facesBody, order: 0, weight: 1.3, tools: [...mediaTools, peersMenu] })
  const faces = new Faces(facesBody, {
    room, media, me, players,
    onSilenced: () => toast(`${TOUCH ? 'tap' : 'click'} anywhere to hear everyone`),
  })
  syncToggles()

  const chatBody = document.createElement('div')
  chatBody.className = 'chat-body'
  wm.add({ id: 'chat', title: 'Chat', tone: 'leaf', body: chatBody, order: 100, weight: 1 })
  const chat = new Chat(chatBody, { room, players })
  chat.selfPlayer = me.player

  const tables = new Tables({ room, me, games, present: (player) => players.stateOf(player) === 'here' })
  const views = new Map() // game id -> {win, view}
  const cursors = new Cursors({ room, desk: $('#desk'), players })
  const live = new Live({ room, tables, deliver: (id, data, seat) => views.get(id)?.view.hear(data, seat) })

  const refreshFaces = () => faces.render()

  // ----------------------------------------------------------- media

  // The camera may arrive after we are already in — permission granted late,
  // or join pressed before the preview had started — so it is sent whenever
  // it appears, not only at the door.
  let sent = null
  let swapped = null // the stream a device switch made of `sent`, carried on the same senders
  const sendCamera = () => {
    if (!media.stream || media.stream === sent || media.stream === swapped) return
    if (sent) room.removeStream(sent)
    sent = media.stream
    room.addStream(sent, { kind: 'camera' })
    faces.stream('self', sent)
  }
  const mediaChanged = () => {
    sendCamera()
    room.updatePresence(mediaPresence())
    refreshFaces()
    void adaptQuality()
  }

  /**
   * Send no more video than the room can use. Faces here are tiles beside
   * a game, so even two people need no more than 640×360 at 20 fps; larger
   * rooms get less, per mirador's profile — every peer is another encode of
   * our camera in a mesh. Applied to the live track, so the camera never
   * blinks; with the bitrate capped and the far side told not to hoard a
   * buffer, as tertulia does over the same plaza.
   */
  let tuned = null
  let tunedStream = null
  async function adaptQuality() {
    const profile = videoProfileFor(room.peers.size)
    const want = { width: Math.min(profile.width, 640), height: Math.min(profile.height, 360), frameRate: Math.min(profile.frameRate, 20), kbps: Math.min(profile.maxBitrateKbps, 500) }
    const key = JSON.stringify(want)
    if (key === tuned && media.stream === tunedStream) return
    tuned = key
    tunedStream = media.stream
    await room.limitBitrate({ video: want.kbps, audio: 48 }).catch(() => {})
    await room.limitPlayoutDelay({ audio: 150, video: 300 }).catch(() => {})
    for (const track of media.stream?.getVideoTracks() ?? []) {
      try {
        await track.applyConstraints({ width: { ideal: want.width }, height: { ideal: want.height }, frameRate: { ideal: want.frameRate } })
      } catch { /* some cameras refuse; the call goes on */ }
    }
  }
  room.on('peer:join', () => void adaptQuality())
  room.on('peer:leave', () => void adaptQuality())
  // Once now, for a camera that started while we were still joining: the
  // presence sent at the door was taken before it existed.
  mediaChanged()
  media.on('state', mediaChanged)
  cameraReady = mediaChanged
  // A new camera or microphone replaces the track in place: nobody else
  // has to renegotiate, and nothing stutters.
  media.on('track', (swaps) => {
    for (const { oldTrack, newTrack } of swaps) room.replaceTrack(oldTrack, newTrack)
    swapped = media.stream
    faces.stream('self', media.stream)
    refreshFaces()
  })

  // ----------------------------------------------------------- people

  // The chat starts when we arrive: someone already here when we came in
  // is not news, so only later arrivals are announced.
  const greeted = new Set()
  const greet = (peer) => {
    if (!peer.nick || greeted.has(peer.id)) return
    if ((peer.presence.since ?? 0) < room.presence.since) return
    greeted.add(peer.id)
    chat.system(`${peer.nick} joined`)
  }

  room.on('peer:join', (peer) => { setTimeout(() => greet(peer), 1500); refreshFaces() })
  /**
   * Two people should never share a colour by accident. Someone who never
   * picked one, finding their default already worn by someone who was here
   * first, takes the next colour nobody is wearing. Only the later arrival
   * moves, so two newcomers cannot keep swapping; a chosen colour is never
   * touched.
   */
  function avoidSameColour() {
    if (store.get('colour', null)) return
    const earlier = [...room.peers.values()].filter((p) => (p.presence.since ?? 0) < room.presence.since)
    const worn = new Set(earlier.map((p) => p.presence.colour).filter(Boolean))
    if (!worn.has(colour)) return
    const everyone = new Set([...room.peers.values()].map((p) => p.presence.colour).filter(Boolean))
    const unworn = PRESETS.filter((c) => !everyone.has(c))
    const free = unworn.length ? randomPreset(unworn) : PRESETS.find((c) => !worn.has(c))
    if (free) setColour(free, { chosen: false })
  }

  room.on('peer:update', (peer) => {
    avoidSameColour()
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
    if (!dropped && peer.presence.player) goodbyes.set(peer.presence.player, Date.now())
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
      // The window's title, seats and status bars plus what the game asks for.
      phoneHeight: (width) => 110 + game.phoneHeight(width - 24),
    })
    const view = new TableView(body, { tables, table, players, me, live })
    views.set(table.id, { win, view })
    dressAll()
  }

  /**
   * With two or more tables of one game open, each is told apart by who
   * sits at it — in its title and in what the chat says of it. With one,
   * the game's name is enough.
   */
  const siblings = (table) => [...tables.tables.values()].filter((t) => t.game === table.game && (!t.closed || t === table))
  const label = (table) => (siblings(table).length > 1 ? views.get(table.id)?.view.who() ?? null : null)
  /** The game as the chat names it: "chess", or "chess (ana vs tomo)". */
  const called = (table) => {
    const extra = label(table)
    return `${gameName(table).toLowerCase()}${extra ? ` (${extra})` : ''}`
  }

  /** A game window's title, its title-bar line, and its close button — only for its players. */
  function dress(table) {
    const entry = views.get(table.id)
    if (!entry) return
    const extra = label(table)
    entry.win.setTitle(extra ? `${gameName(table)} (${extra})` : gameName(table))
    entry.win.setMeta(entry.view.summary({ withPlayers: !extra }))
    // A title that names its players says it all: the line after it goes.
    entry.win.el.classList.toggle('named', !!extra)
    entry.win.setClosable(tables.seatOf(table, me.player) != null)
  }
  /** Every game window: one table's change can change another's title. */
  function dressAll() { for (const id of views.keys()) dress(tables.tables.get(id)) }

  function renderGames() {
    for (const { view } of views.values()) view.render()
    dressAll()
  }

  tables.on('opened', (table, by) => {
    const mine = by === me.player
    showGame(table)
    // Starting a game is wanting to look at it.
    if (mine) wm.focus(views.get(table.id).win, { expand: true })
    if (!mine) chat.system(`${players.nameOf(by)} started a game of ${gameName(table).toLowerCase()}`)
  })
  /**
   * One line in the chat when a game ends, naming who beat whom — said once
   * per ending, by every peer from the same state.
   */
  const announced = new Map() // table id -> the ending last told
  const seen = new Set() // tables we have looked at: endings from before we came are not news
  const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? 'nobody')
  function announceEnding(table) {
    const game = games[table.game]
    const seated = tables.seated(table)
    const names = Object.fromEntries(Object.entries(seated).map(([seat, player]) => [seat, players.nameOf(player)]))
    const result = !table.closed && game.outcome(table.state, names)
    const key = `${table.gen}:${table.moves.length}`
    if (!seen.has(table.id)) {
      seen.add(table.id)
      if (result) announced.set(table.id, key)
      return
    }
    if (!result) return
    if (announced.get(table.id) === key) return
    announced.set(table.id, key)
    const title = called(table)
    const seats = Object.keys(seated).map(Number)
    const winners = (result.winners ?? []).map((seat) => names[seat]).filter(Boolean)
    const losers = seats.filter((seat) => !result.winners?.includes(seat)).map((seat) => names[seat])
    const forfeit = tables.forfeited(table).size ? ' (by forfeit)' : ''
    let line
    if (result.draw) line = `${list(seats.map((seat) => names[seat]))} drew at ${title}`
    else if (seats.length === 1) line = winners.length ? `${winners[0]} finished ${title} — ${result.reason}` : `${losers[0]} gave up on ${title}`
    else if (winners.length > 1) line = `${list(winners)} tied for first at ${title}${losers.length ? `, beating ${list(losers)}` : ''}${forfeit}`
    else if (winners.length === 1) line = `${winners[0]} beat ${list(losers)} at ${title}${forfeit}`
    else line = `the game of ${title} ended — ${result.reason}`
    chat.system(line)
  }

  tables.on('change', (table) => {
    for (const claim of Object.values(table.seats)) players.remember(claim.player, claim.nick)
    if (!views.has(table.id)) showGame(table)
    announceEnding(table)
    const entry = views.get(table.id)
    if (!entry) return
    entry.view.render()
    dressAll()
  })
  tables.on('closed', (table, by) => {
    const entry = views.get(table.id)
    if (!entry) return
    // Named while it still counts among its siblings, before it goes.
    const title = called(table)
    entry.view.destroy()
    wm.remove(entry.win)
    views.delete(table.id)
    dressAll() // the last of its kind may lose its label
    // A game that never began is not news, and a finished one already has
    // its line in the chat; only ending one in progress says who ended it.
    if (table.moves.length === 0 || games[table.game].outcome(table.state, {})) return
    chat.system(by ? `the game of ${title} was ended by ${players.nameOf(by)}` : `the game of ${title} closed — nobody was left playing`)
  })

  // ----------------------------------------------------------- departures

  /**
   * Telling someone who stepped away from someone who has gone. A player
   * who closed their tab said goodbye: if they are not back within a few
   * seconds — a reload comes back sooner — they have left. One who dropped
   * without a word gets longer to come back. Either way, once gone they
   * forfeit and lose their seats; see Tables.depart.
   */
  const LEFT_MS = 10_000
  const DROPPED_MS = 120_000
  const goodbyes = new Map() // player -> when they said goodbye
  const absent = new Map() // seated player -> since when we have not seen them
  setInterval(() => {
    const now = Date.now()
    const seated = new Set()
    for (const table of tables.tables.values()) {
      if (!table.closed) for (const player of Object.values(tables.seated(table))) seated.add(player)
    }
    for (const player of [...absent.keys()]) if (!seated.has(player)) absent.delete(player)
    for (const player of seated) {
      if (players.stateOf(player) === 'here') { absent.delete(player); goodbyes.delete(player); continue }
      if (!absent.has(player)) absent.set(player, now)
      const left = goodbyes.get(player)
      if (left != null ? now - left > LEFT_MS : now - absent.get(player) > DROPPED_MS) tables.depart(player)
    }
  }, 2000)

  // ----------------------------------------------------------- top bar

  const toggleShelf = popover($('#new-table'), $('#shelf-pop'))
  $('#shelf-pop').append(shelf({
    games: Object.fromEntries(Object.entries(games).filter(([id]) => !shelved.has(id))),
    upcoming,
    onPick: (gameId) => {
      toggleShelf(false)
      const table = tables.open(gameId)
      if (!table) { toast(`${TABLES} games at once is the most — end one to start another`); return }
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
      character: () => character,
      onCharacter: setCharacter,
      onNick: (next) => {
        me.nick = next
        room.setNick(next)
        refreshFaces()
        renderGames()
      },
    }).el)
  })

  // On a phone an invite goes out through the share sheet — the messaging
  // apps are where friends are. Elsewhere, or if sharing is declined, the
  // link is copied.
  const copyInvite = async () => {
    const url = inviteUrl(code)
    if (TOUCH && navigator.share) {
      try { await navigator.share({ title: 'recreo', text: `come play in ${code}`, url }); return } catch (err) {
        if (err?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast('invite link copied — send it to your friends')
    } catch {
      toast(url)
    }
  }
  $('#invite').addEventListener('click', copyInvite)

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
    delete document.documentElement.dataset.straightIn
    entering = false
  }

  colourChanged = (next) => {
    me.colour = next
    room.updatePresence({ colour: next })
    refreshFaces()
    renderGames()
  }

  characterChanged = (next) => {
    me.character = next
    room.updatePresence({ character: next })
    refreshFaces()
  }

  chat.system(`welcome to ${code} — invite friends with the button up top`)
  refreshFaces()

  // A handle for the console, and for the test harness.
  window.recreo = { room, tables, wm, players, me, media, cursors, notices }
}

function mediaPresence() {
  const s = media.state()
  return { audio: s.audioEnabled && holds('audio'), video: s.videoEnabled && holds('video') }
}

/** The room's notices, at the bottom of the screen (app/notify.js). */
function toast(text) { notify(text) }
