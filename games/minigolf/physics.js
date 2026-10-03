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
export const ROLL = 6             // speed a rolling ball loses each tick, as on a real green
export const DRAG = 3             // and per mille more, so hard shots settle a little sooner
export const BOUNCE = 760         // per mille kept off a wall
export const STOP = 12            // below this speed a ball rests
export const SINK_SPEED = 460     // faster than this, a ball catches the lip and runs on
export const LIP = 820            // per mille kept by a ball that runs over the cup
export const DROP = CUP - 5       // its centre must pass this close to the cup's to fall
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

/** Integer square root, so a length is the same on every machine. */
export function isqrt(n) {
  let r = Math.floor(Math.sqrt(n))
  while (r * r > n) r--
  while ((r + 1) * (r + 1) <= n) r++
  return r
}

/** How close the move from (x, y) to (nx, ny) passes to (cx, cy), squared. */
function nearest2(x, y, nx, ny, cx, cy) {
  const dx = nx - x
  const dy = ny - y
  const len2 = dx * dx + dy * dy
  let px = nx
  let py = ny
  if (len2 > 0) {
    const along = Math.min(len2, Math.max(0, (cx - x) * dx + (cy - y) * dy))
    px = x + Math.trunc(dx * along / len2)
    py = y + Math.trunc(dy * along / len2)
  }
  return (px - cx) ** 2 + (py - cy) ** 2
}

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
  let lipped = false
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
    // The cup, checked along the whole move so a quick ball cannot hop it:
    // slow and true, it drops; too fast, it catches the lip and runs on.
    const speed = isqrt(vx * vx + vy * vy)
    const over = nearest2(x, y, nx, ny, cx, cy) < (DROP * UNIT) ** 2
    if (over && speed < SINK_SPEED) { path.push([nx, ny]); return { path, end: [cx, cy], sunk: true } }
    if (over && !lipped) { vx = Math.trunc(vx * LIP / 1000); vy = Math.trunc(vy * LIP / 1000) }
    lipped = over
    x = nx
    y = ny
    path.push([x, y])
    for (const pond of hole.water) {
      if (inRect(x, y, pond)) return { path, end: null, drowned: true }
    }
    // Rolling: a steady loss, plus a little drag at speed.
    const slower = speed - ROLL - Math.trunc(speed * DRAG / 1000)
    if (slower < STOP) break
    vx = Math.trunc(vx * slower / speed)
    vy = Math.trunc(vy * slower / speed)
  }
  return { path, end: [x, y] }
}

/** Clamp a pulled-back vector to the strongest shot allowed, in integers. */
export function clampShot(dx, dy) {
  dx = Math.trunc(dx)
  dy = Math.trunc(dy)
  const len2 = dx * dx + dy * dy
  if (len2 <= MAX_SPEED * MAX_SPEED) return [dx, dy]
  const len = isqrt(len2)
  return [Math.trunc(dx * MAX_SPEED / len), Math.trunc(dy * MAX_SPEED / len)]
}
