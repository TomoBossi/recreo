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
 *   - A rematch starts a new generation with a fresh seed, and the higher
 *     generation always wins a merge.
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
 * @fires closed (table)
 * @fires moved  (table, move)
 */
export class Tables extends Emitter {
  /** @type {Map<string, object>} */
  tables = new Map()
  #clock = 0
  #pending = new Map() // tableId -> moves that arrived ahead of their turn

  constructor({ room, me, games }) {
    super()
    this.room = room
    this.me = me
    this.games = games

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

  play(tableId, move) {
    const table = this.tables.get(tableId)
    if (!table || table.closed) return false
    const game = this.games[table.game]
    const seat = this.seatOf(table, this.me.player)
    // Nobody moves until every seat is taken: a game against an empty chair
    // is just one person clicking.
    if (Object.keys(this.seated(table)).length < game.seats) return false
    if (seat == null || game.turn(table.state) !== seat || !game.legal(table.state, move, seat)) return false
    const record = { n: table.moves.length, seat, move, player: this.me.player }
    this.#applyMove(table, record)
    this.channel.send({ t: 'move', id: tableId, gen: table.gen, ...record })
    return true
  }

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
    this.#close(table)
    this.channel.send({ t: 'close', id: tableId })
  }

  // ---------------------------------------------------------------- queries

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
      case 'move':
        if (!table) return void this.syncWith(peerId)
        if (msg.gen !== table.gen) {
          if (msg.gen > table.gen) void this.syncWith(peerId)
          return
        }
        this.#offerMove(table, { n: msg.n, seat: msg.seat, move: msg.move, player: msg.player }, peerId)
        return
      case 'rematch':
        if (!table) return void this.syncWith(peerId)
        if (msg.gen > table.gen) this.#rematch(table, { gen: msg.gen, seed: msg.seed })
        return
      case 'close':
        if (table) this.#close(table)
    }
  }

  /**
   * Take a move from a peer: the next one is applied, one we already have is
   * ignored, and one from further ahead means we missed something — it waits
   * while we ask the sender for the whole table.
   */
  #offerMove(table, record, peerId) {
    if (record.n < table.moves.length) return
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

  #applyMove(table, record) {
    const game = this.games[table.game]
    if (!game.legal(table.state, record.move, record.seat)) return
    table.moves.push(record)
    table.state = game.apply(table.state, record.move, record.seat)
    this.emit('moved', table, record)
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
    table.state = this.#initial(table)
    this.#pending.delete(table.id)
    this.emit('change', table)
  }

  #close(table) {
    table.closed = true
    this.emit('closed', table)
    this.emit('change', table)
  }

  #initial(table) {
    return this.games[table.game].init({ seed: table.seed, seats: this.games[table.game].seats })
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
      table = { ...theirs, seats: {}, moves: [], closed: false }
      table.state = this.#initial(table)
      this.tables.set(table.id, table)
    }

    for (const [seat, claim] of Object.entries(theirs.seats ?? {})) {
      this.#clock = Math.max(this.#clock, claim.clock ?? 0)
      const current = table.seats[seat]
      if (!current || later(claim, current)) table.seats[seat] = claim
    }

    if (theirs.gen > table.gen) {
      table.gen = theirs.gen
      table.seed = theirs.seed
      table.moves = []
      table.state = this.#initial(table)
    }
    if (theirs.gen === table.gen && (theirs.moves?.length ?? 0) > table.moves.length) {
      for (const record of theirs.moves.slice(table.moves.length)) this.#applyMove(table, record)
    }

    if (theirs.closed && !table.closed) this.#close(table)
    this.emit('change', table)
  }

  #plain(t) {
    return { id: t.id, game: t.game, by: t.by, at: t.at, gen: t.gen, seed: t.seed, seats: t.seats, moves: t.moves, closed: t.closed }
  }
}

/** Is claim a later than claim b? Logical clock first, player id to break ties. */
function later(a, b) {
  return a.clock > b.clock || (a.clock === b.clock && String(a.who) > String(b.who))
}

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}
