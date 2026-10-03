/**
 * One table, drawn: its seats, its game, a line saying what is happening, and
 * whoever is watching.
 *
 * Everyone in the room sees every table. Sitting down is what makes you a
 * player; until then you are watching, which is the same picture without the
 * ability to move.
 */
export class TableView {
  constructor(body, { tables, table, players, me }) {
    this.tables = tables
    this.table = table
    this.players = players
    this.me = me
    this.game = tables.games[table.game]

    body.innerHTML = `
      <div class="table">
        <div class="ask" hidden>
          <span>end this game for everyone?</span>
          <button class="btn small berry yes">end it</button>
          <button class="btn small no">keep playing</button>
        </div>
        <div class="seats"></div>
        <div class="stage"></div>
        <div class="status"><span class="text"></span><button class="btn small sun rematch" hidden>rematch</button></div>
      </div>`
    this.seatsEl = body.querySelector('.seats')
    this.statusText = body.querySelector('.status .text')
    this.rematchBtn = body.querySelector('.rematch')
    this.rematchBtn.addEventListener('click', () => tables.rematch(table.id))
    this.ask = body.querySelector('.ask')
    this.ask.querySelector('.yes').addEventListener('click', () => tables.close(table.id))
    this.ask.querySelector('.no').addEventListener('click', () => { this.ask.hidden = true })

    const view = this
    this.view = this.game.view.mount(body.querySelector('.stage'), {
      // A game whose pieces are just "you" draws them in each player's colour.
      get colours() { return view.colours() },
      play: (move) => tables.play(table.id, move),
      intend: (intent) => tables.intend(table.id, intent),
      get mySeat() { return tables.seatOf(table, me.player) },
    })
    this.render()
  }

  /** Each seat's colour: the game's own, or its player's when the game says so. */
  colours() {
    const own = this.game.seatColours
    if (!this.game.playerColours) return own
    return own.map((c, seat) => {
      const player = this.table.seats[seat]?.player
      return player ? this.players.colourOf(player) : c
    })
  }

  /** Seat index -> display name, for the game's status line. */
  names() {
    const out = {}
    for (const [seat, player] of Object.entries(this.tables.seated(this.table))) {
      out[seat] = this.players.nameOf(player)
    }
    return out
  }

  /** A short summary for the window's title bar. */
  summary() {
    const names = this.names()
    const seated = Object.values(names)
    const watching = this.watchers().length
    const who = seated.length ? seated.join(this.game.seats === 2 ? ' vs ' : ', ') : 'waiting for players'
    return watching ? `${who} · ${watching} watching` : who
  }

  watchers() {
    const seated = new Set(Object.values(this.tables.seated(this.table)))
    return this.players.list().filter((p) => !seated.has(p.player))
  }

  render() {
    const { table, game, tables, me } = this
    const mySeat = tables.seatOf(table, me.player)
    const rawTurn = game.turn(table.state)
    const turn = rawTurn === 'any' ? undefined : rawTurn
    const names = this.names()

    this.seatsEl.textContent = ''
    for (let seat = 0; seat < game.seats; seat++) {
      const claim = table.seats[seat]
      const chip = document.createElement('span')
      chip.className = 'seat'
      chip.innerHTML = `<span class="piece"></span><span class="who"></span>`
      chip.querySelector('.piece').style.background = this.colours()[seat]
      if (!claim?.player) {
        chip.classList.add('empty')
        chip.querySelector('.who').textContent = 'join'
        chip.setAttribute('role', 'button')
        chip.tabIndex = 0
        chip.addEventListener('click', () => tables.sit(table.id, seat))
      } else {
        const state = this.players.stateOf(claim.player)
        chip.querySelector('.who').textContent = names[seat] + (state === 'here' ? '' : state === 'reconnecting' ? ' (reconnecting)' : ' (away)')
        chip.classList.toggle('turn', turn === seat)
        chip.classList.toggle('away', state !== 'here')
        if (claim.player === me.player) {
          const stand = document.createElement('button')
          stand.className = 'btn small'
          stand.textContent = 'leave'
          stand.addEventListener('click', () => tables.stand(table.id))
          chip.append(stand)
        }
      }
      this.seatsEl.append(chip)
      if (seat < game.seats - 1) {
        const vs = document.createElement('span')
        vs.className = 'vs'
        vs.textContent = game.seats === 2 ? 'vs' : '·'
        this.seatsEl.append(vs)
      }
    }
    if (game.options.length) this.seatsEl.append(this.#options())
    const watchers = this.watchers()
    const w = document.createElement('span')
    w.className = 'watchers'
    w.textContent = watchers.length ? `watching: ${watchers.map((p) => p.nick).join(', ')}` : ''
    this.seatsEl.append(w)

    const enough = Object.keys(this.tables.seated(table)).length >= (game.minSeats ?? game.seats)
    const everyoneSeated = game.mode === 'authoritative' || enough
    let status = game.status(table.state, names)
    const toMove = turn != null ? table.seats[turn]?.player : null
    const away = toMove && this.players.stateOf(toMove)
    if (!enough && table.moves.length === 0) status = 'waiting for players'
    else if (turn != null && turn === mySeat) status = 'your turn!'
    else if (away && away !== 'here') status = `waiting for ${names[turn]} to come back…`
    this.statusText.textContent = status
    // Turn-based games end when nobody is to move; a game that runs itself
    // offers its own way to play again.
    this.rematchBtn.hidden = !(!game.ownRestart && game.mode !== 'authoritative' && turn === null && mySeat != null)

    this.view.update(table.state, {
      mySeat: everyoneSeated ? mySeat : null,
      turn,
      names,
      last: table.moves.at(-1) ?? null,
    })
  }

  /**
   * The game's options, beside the seats: buttons while they can change and
   * you are seated, otherwise just what was chosen.
   */
  #options() {
    const { table, game, tables } = this
    const chosen = tables.optionsOf(table)
    const editable = tables.canSetOptions(table)
    const box = document.createElement('span')
    box.className = 'table-options'
    for (const option of game.options) {
      const group = document.createElement('span')
      group.className = 'table-option'
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = option.label
      group.append(label)
      if (editable) {
        const seg = document.createElement('span')
        seg.className = 'segmented'
        for (const choice of option.choices) {
          const b = document.createElement('button')
          b.className = 'btn small'
          b.textContent = choice.label
          b.setAttribute('aria-pressed', String(chosen[option.id] === choice.value))
          b.addEventListener('click', () => tables.setOption(table.id, option.id, choice.value))
          seg.append(b)
        }
        group.append(seg)
      } else {
        const value = document.createElement('b')
        value.textContent = option.choices.find((c) => c.value === chosen[option.id])?.label ?? ''
        group.append(value)
      }
      box.append(group)
    }
    return box
  }

  /** Ending is for everyone, so it asks first — inline, not in a dialog. */
  askClose() { this.ask.hidden = false }

  destroy() { this.view.destroy() }
}
