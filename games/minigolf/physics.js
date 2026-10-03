/**
 * Minigolf's physics: the course and how a ball rolls on it.
 *
 * Integer arithmetic throughout — no Math.sin, no floats in anything that
 * decides where a ball stops — because every peer runs this and must stop
 * every ball in exactly the same place. A shot is the integer vector the
 * player pulled back, so there is nothing for two machines to round
 * differently.
 */

export const UNIT = 100           // simulation units per course unit
export const W = 1000
export const H = 600
export const BALL = 11            // radius, course units
export const CUP = 17
export const MAX_SPEED = 1400     // units per tick; walls are thicker than a tick's travel
export const FRICTION = 984       // per mille kept each tick
export const BOUNCE = 780         // per mille kept off a wall
export const STOP = 18            // below this speed a ball rests
export const SINK_SPEED = 900     // faster than this, a ball rides over the cup
export const MAX_STROKES = 8
export const MAX_TICKS = 2400


/**
 * The course. Walls and water are rectangles [x, y, w, h] in course units;
 * the outer border is always there.
 */
export const HOLES = [
  { name: 'straight on', par: 2, tee: [120, 300], cup: [870, 300], walls: [], water: [] },
  { name: 'the dogleg', par: 3, tee: [120, 480], cup: [860, 120],
    walls: [[300, 220, 400, 380]], water: [] },
  { name: 'the pond', par: 3, tee: [110, 120], cup: [880, 470],
    walls: [[440, 0, 30, 380], [600, 220, 30, 380]], water: [[680, 60, 220, 120]] },
  { name: 'the gauntlet', par: 4, tee: [110, 300], cup: [890, 300],
    walls: [[260, 0, 40, 250], [260, 350, 40, 250], [480, 150, 40, 300], [700, 0, 40, 250], [700, 350, 40, 250]],
    water: [[380, 0, 80, 120], [380, 480, 80, 120]] },
]

export const BORDER = 24
export const outer = [[0, 0, W, BORDER], [0, H - BORDER, W, BORDER], [0, 0, BORDER, H], [W - BORDER, 0, BORDER, H]]

const inRect = (x, y, [rx, ry, rw, rh], pad = 0) => x > (rx - pad) * UNIT && x < (rx + rw + pad) * UNIT && y > (ry - pad) * UNIT && y < (ry + rh + pad) * UNIT


/**
 * Roll a ball from a position with a velocity until it rests, sinks or
 * drowns. Returns every position along the way (for drawing) and the end.
 * Pure integer arithmetic: the same on every machine, always.
 */
export function roll(hole, [x, y], [vx, vy]) {
  const walls = [...outer, ...hole.walls]
  const path = [[x, y]]
  const cx = hole.cup[0] * UNIT
  const cy = hole.cup[1] * UNIT
  for (let t = 0; t < MAX_TICKS; t++) {
    let nx = x + vx
    let ny = y + vy
    for (const wall of walls) {
      if (!inRect(nx, ny, wall, BALL)) continue
      // Bounce off whichever side was crossed this tick.
      if (!inRect(x, ny, wall, BALL)) { vy = -Math.trunc(vy * BOUNCE / 1000); ny = y } else if (!inRect(nx, y, wall, BALL)) { vx = -Math.trunc(vx * BOUNCE / 1000); nx = x } else {
        vx = -Math.trunc(vx * BOUNCE / 1000); vy = -Math.trunc(vy * BOUNCE / 1000); nx = x; ny = y
      }
    }
    x = nx
    y = ny
    vx = Math.trunc(vx * FRICTION / 1000)
    vy = Math.trunc(vy * FRICTION / 1000)
    path.push([x, y])
    const dx = x - cx
    const dy = y - cy
    const speed2 = vx * vx + vy * vy
    if (dx * dx + dy * dy < (CUP * UNIT) ** 2 && speed2 < SINK_SPEED ** 2) return { path, end: [cx, cy], sunk: true }
    for (const pond of hole.water) {
      if (inRect(x, y, pond)) return { path, end: null, drowned: true }
    }
    if (speed2 < STOP * STOP) break
  }
  return { path, end: [x, y] }
}

/** Clamp a pulled-back vector to the strongest shot allowed, in integers. */
export function clampShot(dx, dy) {
  dx = Math.trunc(dx)
  dy = Math.trunc(dy)
  const len2 = dx * dx + dy * dy
  if (len2 <= MAX_SPEED * MAX_SPEED) return [dx, dy]
  // Integer square root, so the length is the same everywhere.
  let len = Math.floor(Math.sqrt(len2))
  while (len * len > len2) len--
  while ((len + 1) * (len + 1) <= len2) len++
  return [Math.trunc(dx * MAX_SPEED / len), Math.trunc(dy * MAX_SPEED / len)]
}
