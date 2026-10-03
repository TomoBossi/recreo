import { select } from './select.js'
import { store } from './store.js'

/**
 * Pickers for the camera and the microphone: on the welcome screen, before
 * going in, and in the Peers window's menu once inside. A choice is kept in
 * this browser and used again next time.
 *
 * A picker shows only when there is a choice to make — one camera needs no
 * menu — and the lists follow devices being plugged in and out.
 */
const KINDS = [
  { kind: 'videoinput', label: 'camera' },
  { kind: 'audioinput', label: 'microphone' },
]

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

  const render = async () => {
    let devices
    try { devices = await media.devices() } catch { return }
    el.textContent = ''
    for (const { kind, label } of KINDS) {
      const list = devices[kind] ?? []
      if (list.length < 2) continue
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
  render()
  return { el, render }
}
