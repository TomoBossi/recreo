/**
 * The rules of chess, as pure functions over plain data.
 *
 * Deterministic and JSON all the way down, as replicated games must be: every
 * peer applies the same moves to the same state and gets the same board.
 *
 * Squares are 0..63, a1 = 0, h1 = 7, a8 = 56. Pieces are two letters, colour
 * then kind: 'wK', 'bP'. A move is { from, to, promo? } with promo one of
 * 'Q' 'R' 'B' 'N'.
 */

const FILES = 'abcdefgh'
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
const ROOK = [[1, 0], [0, 1], [-1, 0], [0, -1]]
const BISHOP = [[1, 1], [-1, 1], [-1, -1], [1, -1]]

export const file = (sq) => sq & 7
export const rank = (sq) => sq >> 3
export const square = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1)
export const name = (sq) => FILES[file(sq)] + (rank(sq) + 1)
const other = (colour) => (colour === 'w' ? 'b' : 'w')

export function initial() {
  return fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
}

/** A position from Forsyth–Edwards notation; used for the start and for tests. */
export function fromFen(fen) {
  const [placement, turn, castling, ep, half, full] = fen.split(' ')
  const board = Array(64).fill(null)
  placement.split('/').forEach((row, i) => {
    let f = 0
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue }
      const colour = ch === ch.toUpperCase() ? 'w' : 'b'
      board[square(f, 7 - i)] = colour + ch.toUpperCase()
      f++
    }
  })
  const state = {
    board,
    turn,
    castling: { wK: castling.includes('K'), wQ: castling.includes('Q'), bK: castling.includes('k'), bQ: castling.includes('q') },
    ep: ep === '-' ? null : square(FILES.indexOf(ep[0]), Number(ep[1]) - 1),
    half: Number(half ?? 0),
    full: Number(full ?? 1),
    seen: {},
    result: null,
    check: false,
    last: null,
  }
  state.seen[key(state)] = 1
  state.check = inCheck(state.board, state.turn)
  return state
}

/** Everything that identifies a position for repetition. */
function key(s) {
  const c = s.castling
  return s.board.map((p) => p ?? '.').join('') + s.turn
    + (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '') + (s.ep ?? '-')
}

/** Is a square attacked by the given colour? */
export function attacked(board, sq, by) {
  const f = file(sq)
  const r = rank(sq)
  const dir = by === 'w' ? -1 : 1 // a pawn attacks from behind the square
  for (const df of [-1, 1]) {
    const from = square(f + df, r + dir)
    if (from >= 0 && board[from] === `${by}P`) return true
  }
  for (const [df, dr] of KNIGHT) {
    const from = square(f + df, r + dr)
    if (from >= 0 && board[from] === `${by}N`) return true
  }
  for (const [df, dr] of KING) {
    const from = square(f + df, r + dr)
    if (from >= 0 && board[from] === `${by}K`) return true
  }
  for (const [dirs, kinds] of [[ROOK, 'RQ'], [BISHOP, 'BQ']]) {
    for (const [df, dr] of dirs) {
      let tf = f + df
      let tr = r + dr
      while (tf >= 0 && tf < 8 && tr >= 0 && tr < 8) {
        const p = board[square(tf, tr)]
        if (p) {
          if (p[0] === by && kinds.includes(p[1])) return true
          break
        }
        tf += df
        tr += dr
      }
    }
  }
  return false
}

export function inCheck(board, colour) {
  const king = board.indexOf(`${colour}K`)
  return king >= 0 && attacked(board, king, other(colour))
}

/** Moves that obey how pieces move, before asking whether the king is safe. */
function pseudo(s) {
  const out = []
  const { board, turn } = s
  const forward = turn === 'w' ? 1 : -1
  const startRank = turn === 'w' ? 1 : 6
  const lastRank = turn === 'w' ? 7 : 0
  const push = (from, to) => {
    if (board[from][1] === 'P' && rank(to) === lastRank) {
      for (const promo of ['Q', 'R', 'B', 'N']) out.push({ from, to, promo })
    } else {
      out.push({ from, to })
    }
  }

  for (let from = 0; from < 64; from++) {
    const p = board[from]
    if (!p || p[0] !== turn) continue
    const f = file(from)
    const r = rank(from)
    switch (p[1]) {
      case 'P': {
        const one = square(f, r + forward)
        if (one >= 0 && !board[one]) {
          push(from, one)
          const two = square(f, r + 2 * forward)
          if (r === startRank && !board[two]) out.push({ from, to: two })
        }
        for (const df of [-1, 1]) {
          const to = square(f + df, r + forward)
          if (to < 0) continue
          if (board[to] && board[to][0] !== turn) push(from, to)
          else if (to === s.ep) out.push({ from, to })
        }
        break
      }
      case 'N':
      case 'K':
        for (const [df, dr] of p[1] === 'N' ? KNIGHT : KING) {
          const to = square(f + df, r + dr)
          if (to >= 0 && board[to]?.[0] !== turn) out.push({ from, to })
        }
        if (p[1] === 'K') castles(s, from, out)
        break
      default:
        for (const [df, dr] of p[1] === 'R' ? ROOK : p[1] === 'B' ? BISHOP : [...ROOK, ...BISHOP]) {
          let tf = f + df
          let tr = r + dr
          while (tf >= 0 && tf < 8 && tr >= 0 && tr < 8) {
            const to = square(tf, tr)
            if (board[to]) {
              if (board[to][0] !== turn) out.push({ from, to })
              break
            }
            out.push({ from, to })
            tf += df
            tr += dr
          }
        }
    }
  }
  return out
}

function castles(s, from, out) {
  const { board, turn, castling } = s
  const home = turn === 'w' ? 0 : 56
  if (from !== home + 4 || s.check) return
  const enemy = other(turn)
  if (castling[`${turn}K`] && !board[home + 5] && !board[home + 6] && board[home + 7] === `${turn}R`
    && !attacked(board, home + 5, enemy) && !attacked(board, home + 6, enemy)) {
    out.push({ from, to: home + 6 })
  }
  if (castling[`${turn}Q`] && !board[home + 3] && !board[home + 2] && !board[home + 1] && board[home] === `${turn}R`
    && !attacked(board, home + 3, enemy) && !attacked(board, home + 2, enemy)) {
    out.push({ from, to: home + 2 })
  }
}

/** The board after a move, without any bookkeeping. */
function moved(board, move, ep) {
  const next = board.slice()
  const p = next[move.from]
  next[move.to] = move.promo ? p[0] + move.promo : p
  next[move.from] = null
  if (p[1] === 'P' && move.to === ep) next[square(file(move.to), rank(move.from))] = null
  if (p[1] === 'K' && Math.abs(move.to - move.from) === 2) {
    const kingside = move.to > move.from
    const rookFrom = kingside ? move.from + 3 : move.from - 4
    const rookTo = kingside ? move.from + 1 : move.from - 1
    next[rookTo] = next[rookFrom]
    next[rookFrom] = null
  }
  return next
}

/** Every legal move in a position. */
export function legalMoves(s) {
  if (s.result) return []
  return pseudo(s).filter((m) => !inCheck(moved(s.board, m, s.ep), s.turn))
}

export function isLegal(s, move) {
  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)) return false
  return legalMoves(s).some((m) => m.from === move.from && m.to === move.to && (m.promo ?? null) === (move.promo ?? null))
}

/** The position after a legal move, with check and the game's end worked out. */
export function play(s, move) {
  const p = s.board[move.from]
  const capture = !!s.board[move.to] || (p[1] === 'P' && move.to === s.ep)
  const board = moved(s.board, move, s.ep)

  const castling = { ...s.castling }
  if (p[1] === 'K') { castling[`${p[0]}K`] = false; castling[`${p[0]}Q`] = false }
  for (const [sq, right] of [[0, 'wQ'], [7, 'wK'], [56, 'bQ'], [63, 'bK']]) {
    if (move.from === sq || move.to === sq) castling[right] = false
  }

  const next = {
    board,
    turn: other(s.turn),
    castling,
    ep: p[1] === 'P' && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : null,
    half: p[1] === 'P' || capture ? 0 : s.half + 1,
    full: s.turn === 'b' ? s.full + 1 : s.full,
    seen: { ...s.seen },
    result: null,
    check: false,
    last: { from: move.from, to: move.to },
  }
  const k = key(next)
  next.seen[k] = (next.seen[k] ?? 0) + 1
  next.check = inCheck(board, next.turn)

  const replies = pseudo(next).some((m) => !inCheck(moved(next.board, m, next.ep), next.turn))
  if (!replies) next.result = next.check ? { winner: s.turn } : { draw: 'stalemate' }
  else if (next.half >= 100) next.result = { draw: 'the fifty-move rule' }
  else if (next.seen[k] >= 3) next.result = { draw: 'threefold repetition' }
  else if (insufficient(board)) next.result = { draw: 'insufficient material' }
  return next
}

/** Nobody can possibly mate: kings alone, or with a single minor piece. */
function insufficient(board) {
  const rest = board.filter((p) => p && p[1] !== 'K')
  return rest.length === 0 || (rest.length === 1 && 'BN'.includes(rest[0][1]))
}

/** Count leaf positions to a depth — the standard check of a move generator. */
export function perft(s, depth) {
  if (depth === 0) return 1
  let n = 0
  for (const m of pseudo(s)) {
    const board = moved(s.board, m, s.ep)
    if (inCheck(board, s.turn)) continue
    if (depth === 1) { n++; continue }
    n += perft(play({ ...s, seen: {} }, m), depth - 1)
  }
  return n
}
