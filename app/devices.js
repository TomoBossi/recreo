import { select } from './select.js'
import { store } from './store.js'

/**
 * Pickers for the camera and the microphone: on the welcome screen, before
 * going in, and in the Peers window's menu once inside. A choice is kept in
 * this browser and used again next time.
 *
 * A picker shows only when there is a choice to make — one camera needs no
 * menu — and only for a device the page has; the lists follow devices being
 * plugged in and out.
 */
const KINDS = [
  { kind: 'videoinput', track: 'video', label: 'camera' },
  { kind: 'audioinput', track: 'audio', label: 'microphone' },
]

/**
 * A track the browser took away — its permission revoked from the address
 * bar, or the device unplugged — has ended and stays in the stream looking as
 * if it were still there. Here a microphone is never stopped, only muted, and
 * a camera only when turned off, which is remembered; any other ended track
 * was taken.
 */
const turnedOff = new WeakSet()
const taken = (track) => track.readyState === 'ended' && !turnedOff.has(track)

/** Whether the page has a microphone ('audio') or camera ('video') it can use, on or off. */
export const holds = (media, kind) =>
  !!media.stream?.getTracks().some((t) => t.kind === kind && !taken(t))

const watched = new WeakSet()

/**
 * Notice a track the browser takes away, and say so as a change of state, so
 * everything that shows the microphone and camera shows it gone.
 */
export function watchLoss(media) {
  const watch = () => {
    // The camera turned off here stops its track, and says so as a change of state.
    if (!media.videoEnabled) for (const track of media.stream?.getVideoTracks() ?? []) turnedOff.add(track)
    for (const track of media.stream?.getTracks() ?? []) {
      if (watched.has(track)) continue
      watched.add(track)
      track.addEventListener('ended', () => media.emit('state', media.state()))
    }
  }
  for (const event of ['stream', 'track', 'state']) media.on(event, watch)
  watch()
}

/** Before the camera starts: use the devices chosen last time. */
export async function restoreDevices(media) {
  for (const { kind } of KINDS) {
    const id = store.get(`device:${kind}`, null)
    if (id) await media.useDevice(kind, id).catch(() => {})
  }
}

export function devicePickers(media) {
  const el = document.createElement('div')
  el.className = 'device-pickers'

  const heldKinds = () => KINDS.map(({ track }) => holds(media, track)).join()
  let held = null
  const render = async () => {
    let devices
    try { devices = await media.devices() } catch { return }
    el.textContent = ''
    held = heldKinds()
    for (const { kind, track, label } of KINDS) {
      const list = devices[kind] ?? []
      if (list.length < 2 || !holds(media, track)) continue
      const row = document.createElement('label')
      row.className = 'device-row'
      const name = document.createElement('span')
      name.className = 'device-label'
      name.textContent = label
      const active = list.find((d) => d.active) ?? list[0]
      row.append(name, select({
        value: active.deviceId,
        label,
        choices: list.map((d) => ({ value: d.deviceId, label: d.label })),
        onPick: async (id) => {
          store.set(`device:${kind}`, id)
          await media.useDevice(kind, id).catch(() => {})
          render()
        },
      }))
      el.append(row)
    }
    el.hidden = !el.children.length
  }

  // Labels only appear once the camera has been allowed, and devices come
  // and go: list them again whenever either happens.
  media.on('devices', render)
  media.on('stream', render)
  // And when a device is gained or taken away.
  media.on('state', () => { if (heldKinds() !== held) render() })
  render()
  return { el, render }
}
