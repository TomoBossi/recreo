/**
 * Minigolf's physics: how a ball rolls on a course.
 *
 * Integer arithmetic throughout — no Math.sin, no floats in anything that
 * decides where a ball stops — because every peer runs this and must stop
 * every ball in exactly the same place. A shot is an integer vector, the
 * windmill's turn an integer count of ticks, so there is nothing for two
 * machines to round differently.
 *
 * Positions are in hundredths of a course unit; a course is 1000 × 600.
 */

export const UNIT = 100           // simulation units per course unit
export const W = 1000
export const H = 600
export const BORDER = 24          // the wooden frame round every course
export const TPS = 120            // ticks per second, when a shot is played out
export const BALL = 11            // radius, course units
export const CUP = 17
export const MAX_SPEED = 1400     // units per tick
const STEP = 350                  // the furthest a ball moves between collision checks
const ROLL = 6                    // speed a rolling ball loses each tick, as on a real green
const DRAG = 3                    // and per mille more, so hard shots settle a little sooner
const SAND_ROLL = 34              // sand stops a ball quickly
const SAND_DRAG = 25
const BOUNCE = 760                // per mille of speed kept off a wall
const SPRING = 1150               // and off a bumper, which kicks
const SAIL = 300                  // and off a windmill's sail, which only knocks it back a little
const STOP = 12                   // below this speed a ball rests
const SINK_SPEED = 470            // faster than this, a ball catches the lip and runs on
const LIP = 820                   // per mille kept by a ball that runs over the cup
const DROP = CUP - 5              // its centre must pass this close to the cup's to fall
const WELL = CUP + 5              // a ball this close is drawn in: nothing rests on the lip
const PULL = 9                    // how hard the cup draws it
const MOUTH = 15                  // a tunnel swallows a ball whose centre comes this close
const RAIL = 7                    // half a rail's thickness
export const MAX_TICKS = 2600
export const MAX_STROKES = 8

/** Integer square root, so a length is the same on every machine. */
export function isqrt(n) {
  if (n <= 0) return 0
  let r = Math.floor(Math.sqrt(n))
  while (r * r > n) r--
  while ((r + 1) * (r + 1) <= n) r++
  return r
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const u = (v) => v * UNIT

/**
 * A hole's shapes in simulation units, ready to collide with: computed once
 * per hole and kept.
 *
 * In course units, a hole has:
 *   tee, cup        [x, y]
 *   walls           rectangles [x, y, w, h]
 *   posts           round, solid [x, y, r]
 *   bumpers         round and springy [x, y, r]
 *   rails           straight wooden rails [x1, y1, x2, y2]
 *   water, sand     rectangles [x, y, w, h] or circles [x, y, r]
 *   slopes          { at: [x, y, w, h], push: [dx, dy] } — speed gained per tick
 *   tunnels         [inX, inY, outX, outY] — in at one end, out at the other, same speed
 *   mill            { hub: [x, y], gate: [x, y, w, h], quarter, open } — sails turn a
 *                   quarter every `quarter` ticks; the gate is clear for the first
 *                   `open` ticks of each quarter, and a sail blocks it for the rest
 */
const compiled = new WeakMap()
export function compile(hole) {
  const hit = compiled.get(hole)
  if (hit) return hit
  const rect = ([x, y, w, h]) => ({ x: u(x), y: u(y), w: u(w), h: u(h) })
  const area = (a) => (a.length === 4 ? { rect: rect(a) } : { x: u(a[0]), y: u(a[1]), r: u(a[2]) })
  const frame = [[0, 0, W, BORDER], [0, H - BORDER, W, BORDER], [0, 0, BORDER, H], [W - BORDER, 0, BORDER, H]]
  const solids = [
    ...[...frame, ...(hole.walls ?? [])].map((r) => ({ kind: 'wall', ...rect(r) })),
    ...(hole.posts ?? []).map(([x, y, r]) => ({ kind: 'post', cx: u(x), cy: u(y), r: u(r) })),
    ...(hole.bumpers ?? []).map(([x, y, r], i) => ({ kind: 'bumper', i, cx: u(x), cy: u(y), r: u(r) })),
    ...(hole.rails ?? []).map(([x1, y1, x2, y2]) => ({ kind: 'rail', x1: u(x1), y1: u(y1), x2: u(x2), y2: u(y2) })),
  ]
  const mill = hole.mill && { ...rect(hole.mill.gate), kind: 'sail', quarter: hole.mill.quarter, open: hole.mill.open }
  const c = {
    solids,
    mill,
    water: (hole.water ?? []).map(area),
    sand: (hole.sand ?? []).map(area),
    slopes: (hole.slopes ?? []).map((s) => ({ ...rect(s.at), push: s.push })),
    tunnels: (hole.tunnels ?? []).map(([ax, ay, bx, by]) => ({ ax: u(ax), ay: u(ay), bx: u(bx), by: u(by) })),
    cup: [u(hole.cup[0]), u(hole.cup[1])],
  }
  compiled.set(hole, c)
  return c
}

/** The point of a solid nearest to (x, y), and how far the ball must keep from it. */
function nearest(s, x, y) {
  if (s.kind === 'wall' || s.kind === 'sail') return [clamp(x, s.x, s.x + s.w), clamp(y, s.y, s.y + s.h), u(BALL)]
  if (s.kind === 'rail') {
    const dx = s.x2 - s.x1
    const dy = s.y2 - s.y1
    const len2 = dx * dx + dy * dy
    const along = clamp((x - s.x1) * dx + (y - s.y1) * dy, 0, len2)
    return [s.x1 + Math.trunc(dx * along / len2), s.y1 + Math.trunc(dy * along / len2), u(BALL + RAIL)]
  }
  // Round: the centre, kept a radius further off.
  return [s.cx, s.cy, u(BALL) + s.r]
}

const inside = (a, x, y) => (a.rect
  ? x > a.rect.x && x < a.rect.x + a.rect.w && y > a.rect.y && y < a.rect.y + a.rect.h
  : (x - a.x) ** 2 + (y - a.y) ** 2 < a.r * a.r)

/** Whether the windmill's gate is shut at this tick of its turn. */
export const shut = (mill, tick) => tick % mill.quarter >= mill.open

/**
 * Roll a ball from a position with a velocity until it rests, sinks or
 * drowns. `phase` is where the windmill stood when the ball was struck.
 *
 * Returns every position, tick by tick, for drawing; the end; and what
 * happened on the way — walls and bumpers hit, tunnels taken — with the
 * tick each happened at, for the picture and its sounds.
 */
export function roll(hole, [x, y], [vx, vy], phase = 0) {
  const c = compile(hole)
  const path = [[x, y]]
  const events = []
  const [cx, cy] = c.cup
  let lipped = false
  let tunnelled = -1 // the tunnel just left, ignored until the ball is clear of its end
  let stillSince = null // where a slow ball was when it last slowed, to tell crawling from stuck

  for (let t = 0; t < MAX_TICKS; t++) {
    let speed = isqrt(vx * vx + vy * vy)
    const steps = Math.max(1, Math.ceil(speed / STEP))
    const solids = c.mill && shut(c.mill, phase + t) ? [...c.solids, c.mill] : c.solids
    let mx = 0
    let my = 0
    for (let k = 1; k <= steps; k++) {
      // Each step moves its share of the tick, the shares adding up exactly.
      const sx = Math.trunc(vx * k / steps) - mx
      const sy = Math.trunc(vy * k / steps) - my
      mx += sx
      my += sy
      x += sx
      y += sy
      for (const s of solids) {
        const [qx, qy, reach] = nearest(s, x, y)
        const dx = x - qx
        const dy = y - qy
        const d2 = dx * dx + dy * dy
        // Clear of it — or swallowed whole by a sail coming down, which the ball passes under.
        if (d2 >= reach * reach || d2 === 0) continue
        const d = isqrt(d2)
        x = qx + Math.trunc(dx * reach / d)
        y = qy + Math.trunc(dy * reach / d)
        const vn = vx * dx + vy * dy
        if (vn >= 0) continue // already moving away
        const keep = s.kind === 'bumper' ? SPRING : s.kind === 'sail' ? SAIL : BOUNCE
        vx -= Math.trunc((1000 + keep) * vn / d2 * dx / 1000)
        vy -= Math.trunc((1000 + keep) * vn / d2 * dy / 1000)
        // A hard knock is worth a sound; a graze along a wall is not.
        if (s.kind === 'bumper' || s.kind === 'sail' || -vn > 160 * d) events.push({ t, kind: s.kind, i: s.i, power: Math.min(1000, Math.trunc(-vn / d)) })
      }
      // The cup, checked every step so a quick ball cannot hop it: slow
      // and true, it drops; too fast, it catches the lip and runs on.
      const near2 = (x - cx) ** 2 + (y - cy) ** 2
      const over = near2 < u(DROP) ** 2
      if (over && speed < SINK_SPEED) {
        path.push([x, y])
        events.push({ t, kind: 'sink' })
        return { path, end: [cx, cy], sunk: true, events }
      }
      if (over && !lipped) {
        vx = Math.trunc(vx * LIP / 1000)
        vy = Math.trunc(vy * LIP / 1000)
        events.push({ t, kind: 'lip' })
      }
      lipped = over
      // A tunnel mouth swallows the ball and puts it out the other end.
      for (let i = 0; i < c.tunnels.length; i++) {
        const n = c.tunnels[i]
        if (i === tunnelled) {
          if ((x - n.bx) ** 2 + (y - n.by) ** 2 > u(MOUTH + BALL) ** 2) tunnelled = -1
          continue
        }
        if ((x - n.ax) ** 2 + (y - n.ay) ** 2 < u(MOUTH) ** 2) {
          x = n.bx
          y = n.by
          tunnelled = i
          events.push({ t, kind: 'tunnel', i })
          break
        }
      }
    }
    path.push([x, y])

    for (const pond of c.water) {
      if (inside(pond, x, y)) {
        events.push({ t, kind: 'water' })
        return { path, end: null, drowned: true, events }
      }
    }

    // Rolling: a steady loss, plus a little drag at speed; much more in sand.
    const sandy = c.sand.some((a) => inside(a, x, y))
    speed = isqrt(vx * vx + vy * vy)
    const slower = speed - (sandy ? SAND_ROLL : ROLL) - Math.trunc(speed * (sandy ? SAND_DRAG : DRAG) / 1000)
    if (slower <= 0) {
      vx = 0
      vy = 0
    } else {
      vx = Math.trunc(vx * slower / speed)
      vy = Math.trunc(vy * slower / speed)
    }
    // Then what pulls: the cup draws in a ball that comes close, so none
    // rests on its lip, and slopes push downhill.
    let pushed = false
    const near2 = (x - cx) ** 2 + (y - cy) ** 2
    if (near2 < u(WELL) ** 2) {
      const d = Math.max(1, isqrt(near2))
      vx += Math.trunc((cx - x) * PULL / d)
      vy += Math.trunc((cy - y) * PULL / d)
      pushed = true
    }
    for (const s of c.slopes) {
      if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h) {
        vx += s.push[0]
        vy += s.push[1]
        pushed = true
      }
    }
    if (slower < STOP) {
      // A ball that stops where nothing pushes it rests. One that a slope
      // keeps pressing into a wall, going nowhere, rests too.
      if (!pushed) return { path, end: [x, y], events }
      if (stillSince == null) stillSince = { t, x, y }
      else if (t - stillSince.t > TPS / 2) {
        if ((x - stillSince.x) ** 2 + (y - stillSince.y) ** 2 < u(3) ** 2) return { path, end: [x, y], events }
        stillSince = { t, x, y }
      }
    } else stillSince = null
    speed = isqrt(vx * vx + vy * vy)
    if (speed > MAX_SPEED) {
      vx = Math.trunc(vx * MAX_SPEED / speed)
      vy = Math.trunc(vy * MAX_SPEED / speed)
    }
  }
  return { path, end: [x, y], events }
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
