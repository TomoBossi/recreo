import { Emitter } from 'plaza'

/**
 * The tables in the room: which games are open, who sits where, and every
 * move made — held by every peer, and merged the same way by all of them
 * whatever order things arrive in.
 *
 * A table is plain data, so it can be sent whole to someone who arrives late
 * or comes back from a dropped connection, and merged into whatever they
 * already have:
 *
 *   - Seats are claims ordered by a logical clock, ties broken by player id.
 *     Two people grabbing the same seat at once settle on the same winner on
 *     every machine, without asking each other.
 *   - Moves are numbered. In a game where only one seat acts at a time, there
 *     is only ever one candidate for the next number, so every peer applies
 *     the same moves in the same order.
 *   - The exception is a forfeit, which anyone seated can make at any time
 *     and so can race the move it interrupts. A forfeit beats an ordinary
 *     move for the same number, and between two forfeits the lower seat
 *     goes first; whoever applied the loser rewinds and replays.
 *   - A rematch starts a new generation with a fresh seed, and the higher
 *     generation always wins a merge.
 *   - Options are claims too, one per option, ordered the same way as seats.
 *     The first move records the options it was played under, so every peer
 *     starts the game from the same ones, whatever arrived when.
 *   - Closing is final.
 *
 * Nothing here defends against a peer lying. This is a room of friends.
 *
 * Games plug in through a small interface (see games/README.md). A game
 * declares its mode; this file runs `replicated` games, where every peer
 * runs the whole game. `authoritative` games, where one peer runs it and the
 * rest send intents, share the same tables, seats and sync.
 *
 * @fires change (table)   anything about a table changed
 * @fires opened (table, byPlayer)
 * @fires closed (table, byPlayer)
 * @fires moved  (table, move)
 */
export class Tables extends Emitter {
  /** @type {Map<string, object>} */
  tables = new Map()
  #clock = 0
  #pending = new Map() // tableId -> moves that arrived ahead of their turn
  #ticker = null

  constructor({ room, me, games, present = () => true }) {
    super()
    this.room = room
    this.me = me
    this.games = games
    this.present = present

    // An authority runs its games' clocks: rounds that end, turns that pass.
    this.#ticker = setInterval(() => this.#tick(), TICK_MS)

    this.channel = room.channel('recreo:tables')
    this.channel.on('message', (msg, peerId) => this.#receive(msg, peerId))

    // Anyone can be asked for everything they know.
    room.answer('recreo:tables', () => this.snapshot())

    // And everyone who arrives or comes back is asked in turn: they may know
    // things we missed, as we may know things they did.
    const sync = (peer) => void this.syncWith(peer.id)
    room.on('peer:join', sync)
    room.on('peer:reconnected', sync)
  }

  /** Ask one peer for everything it knows about tables, and merge it. */
  async syncWith(peerId) {
    try {
      const theirs = await this.room.request('recreo:tables', null, { target: peerId, timeout: 8000 })
      if (Array.isArray(theirs)) for (const t of theirs) this.#merge(t)
    } catch {
      // They left or never answered; the next arrival brings another chance.
    }
  }

  snapshot() {
    return [...this.tables.values()].map((t) => this.#plain(t))
  }

  // ---------------------------------------------------------------- actions

  open(gameId) {
    const game = this.games[gameId]
    if (!game) throw new Error(`no game called ${gameId}`)
    const table = {
      id: `${this.me.player.slice(0, 6)}-${Date.now().toString(36)}`,
      game: gameId,
      by: this.me.player,
      at: Date.now(),
      gen: 0,
      seed: randomSeed(),
      seats: {},
      options: {},
      moves: [],
      closed: false,
    }
    this.#merge(table)
    this.channel.send({ t: 'open', table: this.#plain(this.tables.get(table.id)) })
    this.emit('opened', this.tables.get(table.id), this.me.player)
    return this.tables.get(table.id)
  }

  sit(tableId, seat) { this.#claim(tableId, seat, this.me.player) }

  stand(tableId) {
    const table = this.tables.get(tableId)
    const seat = table && this.seatOf(table, this.me.player)
    if (seat != null) this.#claim(tableId, seat, null)
  }

  /** Choose an option before the game starts. Anyone seated may. */
  setOption(tableId, id, value) {
    const table = this.tables.get(tableId)
    if (!table || table.closed || !this.canSetOptions(table)) return false
    const option = this.games[table.game].options.find((o) => o.id === id)
    if (!option?.choices.some((c) => c.value === value) || this.optionsOf(table)[id] === value) return false
    const claim = { value, clock: ++this.#clock, who: this.me.player }
    this.#applyOption(table, id, claim)
    this.channel.send({ t: 'option', id: tableId, key: id, ...claim })
    return true
  }

  play(tableId, move) {
    const table = this.tables.get(tableId)
    if (!table || table.closed) return false
    const game = this.games[table.game]
    if (game.mode === 'authoritative') return this.intend(tableId, move)
    const seat = this.seatOf(table, this.me.player)
    // Nobody moves until the table has its players: a game against an empty
    // chair is just one person clicking.
    if (Object.keys(this.seated(table)).length < (game.minSeats ?? game.seats)) return false
    // 'any' is a game saying anyone seated may move now — to start it, say.
    const turn = game.turn(table.state)
    if (seat == null || (turn !== 'any' && turn !== seat) || !game.legal(table.state, move, seat)) return false
    const record = this.#record(table, seat, move)
    this.#applyMove(table, record)
    this.channel.send({ t: 'move', id: tableId, gen: table.gen, ...record })
    return true
  }

  /**
   * Give up the game we sit at. The game's own rules say what follows: the
   * other player winning, or the game playing on without us.
   */
  forfeit(tableId) {
    const table = this.tables.get(tableId)
    if (!table || table.closed || !this.canForfeit(table)) return false
    const game = this.games[table.game]
    const seat = this.seatOf(table, this.me.player)
    if (game.mode === 'authoritative') return this.intend(tableId, { forfeit: true })
    const record = this.#record(table, seat, { forfeit: seat, at: Date.now() })
    this.#applyMove(table, record)
    this.channel.send({ t: 'move', id: tableId, gen: table.gen, ...record })
    return true
  }

  /**
   * Ask an authoritative game to do something: a guess, a stroke, a start.
   * Everyone hears it; only the authority acts on it, by turning it into
   * moves that everyone then applies in the order the authority gave them.
   */
  intend(tableId, intent) {
    const table = this.tables.get(tableId)
    if (!table || table.closed) return false
    const seat = this.seatOf(table, this.me.player)
    if (seat == null) return false
    if (this.isAuthority(table)) this.#decide(table, intent, seat)
    else this.channel.send({ t: 'intent', id: tableId, gen: table.gen, intent, seat, player: this.me.player })
    return true
  }

  /**
   * Who runs an authoritative table: whatever the game says, given who is
   * seated and who is here — so every peer works out the same answer, and
   * when the authority leaves the next one takes over without discussion.
   */
  authorityOf(table) {
    const game = this.games[table.game]
    if (game.mode !== 'authoritative') return null
    const seated = this.seated(table)
    const here = Object.keys(seated).map(Number).filter((seat) => this.present(seated[seat]))
    const seat = game.authority(table.state, here)
    return seat == null ? null : seated[seat] ?? null
  }

  isAuthority(table) { return this.authorityOf(table) === this.me.player }

  rematch(tableId) {
    const table = this.tables.get(tableId)
    if (!table || table.closed) return
    const next = { gen: table.gen + 1, seed: randomSeed() }
    this.#rematch(table, next)
    this.channel.send({ t: 'rematch', id: tableId, ...next })
  }

  close(tableId) {
    const table = this.tables.get(tableId)
    if (!table || table.closed) return
    this.#close(table, this.me.player)
    this.channel.send({ t: 'close', id: tableId, by: this.me.player })
  }

  // ---------------------------------------------------------------- queries

  /** Seats that have forfeited the game under way, or the one just ended. */
  forfeited(table) {
    return table.out ?? new Set()
  }

  /** Whether a game is under way: begun, not over. */
  inProgress(table) {
    const game = this.games[table.game]
    return table.moves.length > 0 && !table.closed && !game.outcome(table.state, {})
  }

  canForfeit(table) {
    const seat = this.seatOf(table, this.me.player)
    return seat != null && this.inProgress(table) && !this.forfeited(table).has(seat)
  }

  /** Option id -> chosen value, defaults filled in. */
  optionsOf(table) {
    const game = this.games[table.game]
    // Once a game has started under some options, those are the ones it uses.
    const played = !game.optionsOpen && table.moves[0]?.options
    const out = {}
    for (const o of game.options) {
      const value = played ? played[o.id] : table.options?.[o.id]?.value
      out[o.id] = o.choices.some((c) => c.value === value) ? value : o.default
    }
    return out
  }

  /** Whether options can change now: before the first move, or when the game says. */
  optionsOpen(table) {
    const game = this.games[table.game]
    if (!game.options.length || table.closed) return false
    return game.optionsOpen ? !!game.optionsOpen(table.state) : table.moves.length === 0
  }

  canSetOptions(table) {
    return this.optionsOpen(table) && this.seatOf(table, this.me.player) != null
  }

  /** The seat a player holds at a table, or null. */
  seatOf(table, player) {
    for (const [seat, claim] of Object.entries(table.seats)) {
      if (claim.player === player) return Number(seat)
    }
    return null
  }

  /** Seat index -> player id, for every seat that is taken. */
  seated(table) {
    const out = {}
    for (const [seat, claim] of Object.entries(table.seats)) if (claim.player) out[seat] = claim.player
    return out
  }

  // --------------------------------------------------------------- internals

  #claim(tableId, seat, player) {
    const table = this.tables.get(tableId)
    if (!table || table.closed) return
    const game = this.games[table.game]
    if (seat < 0 || seat >= game.seats) return
    // One seat per player per table: standing up from any other comes first.
    if (player) {
      const current = this.seatOf(table, player)
      if (current === seat) return
      if (current != null) this.#claim(tableId, current, null)
      if (table.seats[seat]?.player) return // taken; ask them to stand
    }
    const claim = { player, clock: ++this.#clock, who: this.me.player }
    this.#applyClaim(table, seat, claim)
    this.channel.send({ t: 'seat', id: tableId, seat, ...claim })
  }

  #receive(msg, peerId) {
    if (!msg || typeof msg !== 'object') return
    const table = this.tables.get(msg.id)
    switch (msg.t) {
      case 'open':
        if (msg.table && !this.tables.has(msg.table.id)) {
          this.#merge(msg.table)
          this.emit('opened', this.tables.get(msg.table.id), msg.table.by)
        }
        return
      case 'seat':
        if (!table) return void this.syncWith(peerId)
        this.#clock = Math.max(this.#clock, msg.clock ?? 0)
        this.#applyClaim(table, msg.seat, { player: msg.player ?? null, clock: msg.clock, who: msg.who })
        return
      case 'option':
        if (!table) return void this.syncWith(peerId)
        this.#clock = Math.max(this.#clock, msg.clock ?? 0)
        this.#applyOption(table, msg.key, { value: msg.value, clock: msg.clock, who: msg.who })
        return
      case 'move':
        if (!table) return void this.syncWith(peerId)
        if (msg.gen !== table.gen) {
          if (msg.gen > table.gen) void this.syncWith(peerId)
          return
        }
        this.#offerMove(table, { n: msg.n, seat: msg.seat, move: msg.move, player: msg.player, ...(msg.options ? { options: msg.options } : {}) }, peerId)
        return
      case 'intent':
        if (!table || msg.gen !== table.gen) return
        if (this.isAuthority(table) && table.seats[msg.seat]?.player === msg.player) this.#decide(table, msg.intent, msg.seat)
        return
      case 'rematch':
        if (!table) return void this.syncWith(peerId)
        if (msg.gen > table.gen) this.#rematch(table, { gen: msg.gen, seed: msg.seed })
        return
      case 'close':
        if (table) this.#close(table, msg.by)
    }
  }

  /**
   * Take a move from a peer: the next one is applied, one we already have is
   * ignored, and one from further ahead means we missed something — it waits
   * while we ask the sender for the whole table.
   */
  #offerMove(table, record, peerId) {
    if (record.n < table.moves.length) {
      const ours = table.moves[record.n]
      if (!same(ours, record) && beats(record, ours)) this.#rewind(table, [...table.moves.slice(0, record.n), record])
      return
    }
    if (record.n > table.moves.length) {
      const waiting = this.#pending.get(table.id) ?? []
      waiting.push(record)
      this.#pending.set(table.id, waiting)
      void this.syncWith(peerId)
      return
    }
    this.#applyMove(table, record)
    // Anything that was waiting on this one can follow it.
    const waiting = (this.#pending.get(table.id) ?? []).sort((a, b) => a.n - b.n)
    for (const next of waiting) {
      if (next.n === table.moves.length) this.#applyMove(table, next)
    }
    this.#pending.set(table.id, waiting.filter((m) => m.n >= table.moves.length))
  }

  /** As the authority: turn an intent into moves, apply them, send them. */
  #decide(table, intent, seat) {
    const game = this.games[table.game]
    if (intent?.forfeit) {
      if (this.inProgress(table) && !this.forfeited(table).has(seat)) this.#append(table, { forfeit: seat, at: Date.now() })
      return
    }
    for (const move of game.decide(table.state, intent, seat, this.#context(table)) ?? []) this.#append(table, move)
  }

  #append(table, move) {
    const record = this.#record(table, null, move)
    this.#applyMove(table, record)
    this.channel.send({ t: 'move', id: table.id, gen: table.gen, ...record })
  }

  /** A new move; the first of a game carries the options it starts under. */
  #record(table, seat, move) {
    const record = { n: table.moves.length, seat, move, player: this.me.player }
    if (record.n === 0 && this.games[table.game].options.length) record.options = this.optionsOf(table)
    return record
  }

  #context(table) {
    const seated = this.seated(table)
    return {
      now: Date.now(),
      options: this.optionsOf(table),
      seated: Object.keys(seated).map(Number).sort((a, b) => a - b),
      here: Object.keys(seated).map(Number).filter((seat) => this.present(seated[seat])).sort((a, b) => a - b),
    }
  }

  #tick() {
    for (const table of this.tables.values()) {
      const game = this.games[table.game]
      if (table.closed || game.mode !== 'authoritative' || !game.tick || !this.isAuthority(table)) continue
      for (const move of game.tick(table.state, this.#context(table)) ?? []) this.#append(table, move)
    }
  }

  #applyMove(table, record, { quiet = false } = {}) {
    const game = this.games[table.game]
    // The first move says which options the game began with: start from those.
    if (record.n === 0 && record.options) table.state = this.#initial(table, record.options)
    const forfeit = record.move?.forfeit
    const over = !!game.outcome(table.state, {})
    if (forfeit != null) {
      // Only for one's own seat, and only while the game is on.
      if (over || (game.mode !== 'authoritative' && record.seat !== forfeit)) return
      table.moves.push(record)
      table.state = game.forfeit(table.state, forfeit, { at: record.move.at })
      ;(table.out ??= new Set()).add(forfeit)
    } else {
      // An authoritative game's moves come from its authority, already decided.
      if (game.mode !== 'authoritative' && !game.legal(table.state, record.move, record.seat)) return
      // A table can host round after round; forfeits count for one round.
      if (over) table.out = new Set()
      table.moves.push(record)
      table.state = game.apply(table.state, record.move, record.seat)
    }
    if (quiet) return
    this.emit('moved', table, record)
    this.emit('change', table)
  }

  /**
   * Start the game over from these moves: a forfeit won a race, so the move
   * it beat — and anything after it — never happened. If that dropped our
   * own forfeit, we make it again.
   */
  #rewind(table, records) {
    const dropped = table.moves.filter((r) => !records.some((k) => same(k, r)))
    table.moves = []
    table.out = new Set()
    table.state = this.#initial(table)
    this.#pending.delete(table.id)
    for (const record of records) this.#applyMove(table, record, { quiet: true })
    this.emit('change', table)
    if (dropped.some((r) => r.move?.forfeit != null && r.player === this.me.player)) this.forfeit(table.id)
  }

  #applyOption(table, id, claim) {
    table.options ??= {}
    const current = table.options[id]
    if (current && !later(claim, current)) return
    table.options[id] = claim
    // Before the first move the starting state depends on the options.
    if (table.moves.length === 0) table.state = this.#initial(table)
    this.emit('change', table)
  }

  #applyClaim(table, seat, claim) {
    const current = table.seats[seat]
    if (current && !later(claim, current)) return
    table.seats[seat] = claim
    this.emit('change', table)
  }

  #rematch(table, { gen, seed }) {
    table.gen = gen
    table.seed = seed
    table.moves = []
    table.out = new Set()
    table.state = this.#initial(table)
    this.#pending.delete(table.id)
    this.emit('change', table)
  }

  #close(table, by = null) {
    table.closed = true
    table.closedBy ??= by
    this.emit('closed', table, table.closedBy)
    this.emit('change', table)
  }

  #initial(table, options = this.optionsOf(table)) {
    const game = this.games[table.game]
    return game.init({ seed: table.seed, seats: game.seats, options })
  }

  /**
   * Merge what someone else knows about a table into what we know.
   *
   * Order-independent by construction: closing is final, a higher generation
   * replaces a lower one, the later claim for each seat wins, and within one
   * generation the longer move list wins — the shorter is always a prefix of
   * it, because only one seat can make each move.
   */
  #merge(theirs) {
    if (!theirs?.id || !this.games[theirs.game]) return
    let table = this.tables.get(theirs.id)
    if (!table) {
      table = { ...theirs, seats: {}, options: {}, moves: [], closed: false }
      table.state = this.#initial(table)
      this.tables.set(table.id, table)
    }

    for (const [seat, claim] of Object.entries(theirs.seats ?? {})) {
      this.#clock = Math.max(this.#clock, claim.clock ?? 0)
      const current = table.seats[seat]
      if (!current || later(claim, current)) table.seats[seat] = claim
    }

    for (const [id, claim] of Object.entries(theirs.options ?? {})) {
      this.#clock = Math.max(this.#clock, claim.clock ?? 0)
      const current = table.options[id]
      if (!current || later(claim, current)) table.options[id] = claim
    }
    if (table.moves.length === 0) table.state = this.#initial(table)

    if (theirs.gen > table.gen) {
      table.gen = theirs.gen
      table.seed = theirs.seed
      table.moves = []
      table.out = new Set()
      table.state = this.#initial(table)
    }
    if (theirs.gen === table.gen && theirs.moves?.length) {
      // Where the two histories part, a forfeit may have won a race.
      const split = theirs.moves.findIndex((r, i) => i < table.moves.length && !same(r, table.moves[i]))
      if (split >= 0) {
        if (beats(theirs.moves[split], table.moves[split])) this.#rewind(table, theirs.moves)
      } else if (theirs.moves.length > table.moves.length) {
        for (const record of theirs.moves.slice(table.moves.length)) this.#applyMove(table, record)
      }
    }

    if (theirs.closed && !table.closed) this.#close(table, theirs.closedBy ?? null)
    this.emit('change', table)
  }

  #plain(t) {
    return { id: t.id, game: t.game, by: t.by, at: t.at, gen: t.gen, seed: t.seed, seats: t.seats, options: t.options ?? {}, moves: t.moves, closed: t.closed, closedBy: t.closedBy ?? null }
  }
}

/** Two move records are the same move by the same player. */
function same(a, b) {
  return a && b && a.player === b.player && a.seat === b.seat && JSON.stringify(a.move) === JSON.stringify(b.move)
}

/** For one move number: a forfeit beats an ordinary move, and the lower seat's forfeit another. */
function beats(a, b) {
  const fa = a?.move?.forfeit
  const fb = b?.move?.forfeit
  if (fa == null) return false
  return fb == null || fa < fb
}

/** Is claim a later than claim b? Logical clock first, player id to break ties. */
function later(a, b) {
  return a.clock > b.clock || (a.clock === b.clock && String(a.who) > String(b.who))
}

/** How often an authority runs its games' clocks. */
const TICK_MS = 400

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}
