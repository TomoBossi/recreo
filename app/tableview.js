import { select } from './select.js'

/**
 * One table, drawn: its seats, its game, a line saying what is happening, and
 * whoever is watching.
 *
 * Everyone in the room sees every table. Sitting down is what makes you a
 * player; until then you are watching, which is the same picture without the
 * ability to move.
 */
export class TableView {
  constructor(body, { tables, table, players, me, live }) {
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
        <div class="ask forfeit-ask" hidden>
          <span>give up this game?</span>
          <button class="btn small berry yes">forfeit</button>
          <button class="btn small no">keep playing</button>
        </div>
        <div class="seats"></div>
        <div class="stage"><div class="outcome" hidden></div></div>
        <div class="status" data-cursor-anchor="status"><span class="text"></span><button class="btn small sun rematch" data-cursor-anchor="rematch" hidden>rematch</button></div>
      </div>`
    this.seatsEl = body.querySelector('.seats')
    this.statusText = body.querySelector('.status .text')
    this.rematchBtn = body.querySelector('.rematch')
    this.rematchBtn.addEventListener('click', () => tables.rematch(table.id))
    this.ask = body.querySelector('.ask')
    this.ask.querySelector('.yes').addEventListener('click', () => tables.close(table.id))
    this.ask.querySelector('.no').addEventListener('click', () => { this.ask.hidden = true })
    this.forfeitAsk = body.querySelector('.forfeit-ask')
    this.forfeitAsk.querySelector('.yes').addEventListener('click', () => { this.forfeitAsk.hidden = true; tables.forfeit(table.id) })
    this.forfeitAsk.querySelector('.no').addEventListener('click', () => { this.forfeitAsk.hidden = true })

    // The end of a game, said to each player in their own terms. Closing it
    // keeps it closed until the next game ends.
    this.outcomeEl = body.querySelector('.outcome')
    this.outcomeSeen = null
    this.outcomeEl.addEventListener('click', (e) => {
      if (!e.target.closest('.close')) return
      this.outcomeSeen = this.#outcomeKey()
      this.outcomeEl.hidden = true
    })

    const view = this
    this.view = this.game.view.mount(body.querySelector('.stage'), {
      // A game whose pieces are just "you" draws them in each player's colour.
      get colours() { return view.colours() },
      play: (move) => tables.play(table.id, move),
      intend: (intent) => tables.intend(table.id, intent),
      // Only a seated player's sharing reaches anyone.
      share: (data) => { if (tables.seatOf(table, me.player) != null) live?.share(table.id, data) },
      get mySeat() { return tables.seatOf(table, me.player) },
    })
    this.render()
  }

  /** Something a player at this table is in the middle of: an aim, a stroke. */
  hear(data, seat) {
    this.view.hear?.(data, seat)
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
  /** Who is at the table: "ana vs tomo", "ana, tomo, lu", or that it waits. */
  who() {
    const seated = Object.values(this.names())
    return seated.length ? seated.join(this.game.seats === 2 ? ' vs ' : ', ') : 'waiting for players'
  }

  /**
   * The line in the window's title bar. When the title already names the
   * players — several tables of one game — it says only who is watching.
   */
  summary({ withPlayers = true } = {}) {
    const watching = this.watchers().length
    const parts = [withPlayers ? this.who() : null, watching ? `${watching} watching` : null].filter(Boolean)
    return parts.join(' · ')
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
    const out = tables.forfeited(table)
    const playing = tables.inProgress(table)
    if (!tables.canForfeit(table)) this.forfeitAsk.hidden = true

    this.seatsEl.textContent = ''
    let shownSeats = 0
    for (let seat = 0; seat < game.seats; seat++) {
      const claim = table.seats[seat]
      // A seat nobody sat in, mid-game, is not a place anyone can take:
      // it is left out rather than shown as an empty chair.
      if (!claim?.player && playing && !out.has(seat)) continue
      if (shownSeats++) {
        const vs = document.createElement('span')
        vs.className = 'vs'
        vs.textContent = game.seats === 2 ? 'vs' : '·'
        this.seatsEl.append(vs)
      }
      const chip = document.createElement('span')
      chip.className = 'seat'
      chip.dataset.cursorAnchor = `seat-${seat}`
      chip.innerHTML = `<span class="piece"></span><span class="who"></span>`
      chip.querySelector('.piece').style.background = this.colours()[seat]
      if (!claim?.player && playing) {
        // Mid-game the game plays on with whoever started it.
        chip.classList.add('empty', 'closed')
        chip.querySelector('.who').textContent = `${claim?.nick ?? 'player'} left`
      } else if (!claim?.player) {
        chip.classList.add('empty')
        chip.querySelector('.who').textContent = 'join'
        chip.setAttribute('role', 'button')
        chip.tabIndex = 0
        chip.addEventListener('click', () => tables.sit(table.id, seat))
      } else {
        const state = this.players.stateOf(claim.player)
        const note = out.has(seat) ? ' (forfeited)' : state === 'here' ? '' : state === 'reconnecting' ? ' (reconnecting)' : ' (away)'
        chip.querySelector('.who').textContent = names[seat] + note
        chip.classList.toggle('turn', turn === seat)
        chip.classList.toggle('away', state !== 'here')
        chip.classList.toggle('out', out.has(seat))
        if (claim.player === me.player) {
          // Mid-game, getting up means giving up; otherwise it is just leaving.
          const giveUp = playing && !out.has(seat)
          const b = document.createElement('button')
          b.className = 'btn small'
          b.textContent = giveUp ? 'forfeit' : 'leave'
          b.addEventListener('click', () => {
            if (giveUp) { this.ask.hidden = true; this.forfeitAsk.hidden = false } else tables.stand(table.id)
          })
          chip.append(b)
        }
      }
      this.seatsEl.append(chip)
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
    else if (turn != null && !table.seats[turn]?.player) status = `${names[turn] ?? `seat ${turn + 1}`} is empty — join to play it`
    else if (turn != null && turn === mySeat) status = 'your turn!'
    else if (away && away !== 'here') status = `waiting for ${names[turn]} to come back…`
    this.statusText.textContent = status
    // Turn-based games end when nobody is to move; a game that runs itself
    // offers its own way to play again.
    this.rematchBtn.hidden = !(!game.ownRestart && game.mode !== 'authoritative' && turn === null && mySeat != null)

    this.#renderOutcome(names, mySeat)

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
      group.dataset.cursorAnchor = `option-${option.id}`
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = option.label
      group.append(label)
      if (editable && option.choices.length > 3) {
        // Many choices: a dropdown, which stays open across re-renders.
        group.append(select({
          value: chosen[option.id],
          choices: option.choices,
          label: option.label,
          open: this.openOption === option.id,
          onToggle: (open) => { this.openOption = open ? option.id : this.openOption === option.id ? null : this.openOption },
          onPick: (value) => { this.openOption = null; tables.setOption(table.id, option.id, value) },
        }))
      } else if (editable) {
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

  /** Which game ended: a new round or a rematch is a new key. */
  #outcomeKey() {
    return `${this.table.gen}:${this.table.moves.length}`
  }

  /** The end-of-game card: you win, you lose, a draw — or, watching, who won. */
  #renderOutcome(names, mySeat) {
    const result = this.game.outcome(this.table.state, names)
    const key = this.#outcomeKey()
    if (!result || this.outcomeSeen === key) { this.outcomeEl.hidden = true; this.outcomeShown = null; return }
    if (this.outcomeShown === key) return // already up; don't replay its entrance
    this.outcomeShown = key
    const winners = result.winners ?? []
    const who = winners.map((seat) => names[seat] ?? `player ${seat + 1}`)
    const mine = mySeat != null && this.table.seats[mySeat]?.player === this.me.player
    let title
    let mood
    if (result.draw) { title = "it's a draw"; mood = 'draw' }
    else if (mine && winners.includes(mySeat)) { title = winners.length > 1 ? 'a tie for first!' : 'you win!'; mood = 'win' }
    else if (mine) { title = 'you lose'; mood = 'lose' }
    else if (who.length) { title = `${who.join(' & ')} ${who.length > 1 ? 'win' : 'wins'}!`; mood = 'win' }
    else { title = 'game over'; mood = 'draw' }
    // Namespaced: a bare "draw" would collide with Pictionary's .draw.
    this.outcomeEl.className = `outcome mood-${mood}`
    this.outcomeEl.dataset.cursorAnchor = 'outcome'
    this.outcomeEl.innerHTML = '<button class="close" aria-label="close">×</button><b class="title"></b><span class="reason"></span>'
    this.outcomeEl.querySelector('.title').textContent = title
    this.outcomeEl.querySelector('.reason').textContent = result.reason ?? ''
    this.outcomeEl.hidden = false
  }

  /** Ending is for everyone, so it asks first — inline, not in a dialog. */
  askClose() { this.forfeitAsk.hidden = true; this.ask.hidden = false }

  destroy() { this.view.destroy() }
}
