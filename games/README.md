# Writing a game for recreo

A game is a module whose default export describes it. recreo handles the
table, the seats, the spectators, keeping every peer in step, and bringing
back whoever drops out. The game handles its rules and its picture.

```js
export default {
  id: 'connect4',            // stable; it travels between peers
  name: 'Connect four',
  tone: 'sky',               // the window's colour: sun berry leaf grape tang sky
  seats: 2,                  // how many players sit at it
  mode: 'replicated',        // see below
  seatColours: ['var(--berry)', 'var(--sun)'],

  init({ seed, seats }),     // -> the starting state
  turn(state),               // -> the seat to move, 'any' if any seated player may,
                             //    or null once the game is over
  minSeats,                  // optional: fewest players to begin (defaults to seats)
  ownRestart,                // optional: true if the game offers its own "play again"
  legal(state, move, seat),  // -> may this seat make this move now?
  apply(state, move, seat),  // -> the next state; never mutates its argument
  status(state, names),      // -> one line for the bar under the board
  view,                      // { mount(el, ctx) -> { update(state, info), destroy() } }
}
```

## Rules must be deterministic

In `replicated` mode every peer runs the game, applying the same moves in
the same order. `init`, `legal` and `apply` must therefore give the same
answer on every machine: no `Math.random()`, no clocks, no floating point
whose last bit could differ. Randomness comes from `seed`, through a
generator kept in the state, so every peer draws the same numbers.

States and moves are plain JSON: a late arrival is sent the moves so far and
replays them.

## Modes

- `replicated` — every peer runs the whole game. For anything where only one
  seat acts at a time (whoever's turn it is), or where actions commute.
- `authoritative` — one peer runs the game and the others send it intents.
  For games where simultaneous actions race and the order decides something,
  such as two people guessing the same word at once. The authority is handed
  over if it leaves.

## The view

`mount(el, ctx)` draws into `el`. `ctx` has:

- `mySeat` — this player's seat, or null for a spectator
- `play(move)` — make a move; ignored unless it is legal and our turn
- `colours` — the seat colours

`update(state, info)` is called whenever anything changes; `info` carries
`mySeat`, `turn`, `names` (seat -> display name) and `last` (the most recent
move record, to animate).

Draw with shapes. recreo has no images.
