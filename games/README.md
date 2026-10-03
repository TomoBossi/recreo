# Writing a game for recreo

A game is a folder here with an `index.js` whose default export is one
`defineGame()` call. recreo handles the table, the seats, the options, the
spectators, keeping every peer in step, and bringing back whoever drops out.
The game handles its rules and its picture. Nothing about networking, ever.

```
games/
  kit/            shared by every game
    define.js     defineGame(): checks a game's description, fills in defaults
    svg.js        shape(), board(), pointIn(), escape(), INK, PAPER
    lobby.js      startPanel(): "start!" / "waiting" / "play again" over a board
    random.js     next(), int(), pick(): a seeded generator kept in the state
  tictactoe/      the smallest complete game: copy this one to start
  connect4/       turns, two seats
  chess/          turns, two seats, rules in their own file
  minigolf/       turns, one to four seats, physics in their own file
  pictionary/     authority, two to four seats, word lists, an option
  index.js        the list of games: one import line each
```

## Adding a game

1. Copy `tictactoe/` to a new folder named after the game's id.
2. Change the id, name, rules, view and icon.
3. Add one import line to `games/index.js`.
4. `npm test` checks every registered game against the interface.

## defineGame

```js
export default defineGame({
  id: 'tictactoe',          // lowercase letters, digits, dashes; travels between peers
  name: 'Tic-tac-toe',
  tone: 'tang',             // window colour: sun berry leaf grape tang sky
  kind: 'turns',            // or 'authority', below
  seats: 2,                 // or { min: 1, max: 4 }; from 1 up to the room's 4
  pieces: ['#ff5d8f', '#2fa4e6'],  // a colour per seat, or 'players' for each player's own
  options: { ... },         // optional, below
  rules,                    // functions, below
  view,                     // (el, ctx) => { update(state, info), destroy() }
  icon: '<rect …/>',        // SVG shapes in a 56×44 box, for the shelf
})
```

A mistake — a missing rule, six seats, a default that is not a choice — fails
when the game loads, with a message naming the game.

## Two kinds of game

**`turns`** — every peer runs the whole game and applies every move. For
anything where one seat acts at a time, or where actions commute.

```js
rules = {
  init({ seed, seats, options }),  // -> the starting state
  turn(state),                     // -> the seat to move, 'any', or null when over
  legal(state, move, seat),        // -> may this seat make this move now?
  apply(state, move, seat),        // -> the next state; never change the argument
  status(state, names),            // -> one line for the bar under the board
}
```

**`authority`** — one peer runs the game, turning everyone's intents into
moves; everyone applies the moves. For games where simultaneous actions
race: two people typing the right word at the same moment. If the authority
leaves, the next player takes over.

```js
rules = {
  init({ seed, seats, options }),
  decide(state, intent, seat, { now, seated, here, options }),  // -> moves
  apply(state, move),
  status(state, names),
  tick(state, { now, here, options }),  // optional: moves the clock makes, run every 400ms
  authority(state, here),               // optional: which seat runs it (default: lowest here)
}
```

## Rules must agree everywhere

Every peer applies the same moves in the same order, so `init`, `legal` and
`apply` must give the same answer on every machine: no `Math.random()`, no
`Date.now()`, no floating point whose last bit could differ. Randomness comes
from `seed`, through `kit/random.js`, with the generator kept in the state.
Times come in moves, stamped by whoever made them.

States and moves are plain JSON: a late arrival is sent the moves so far and
replays them.

## Seats, starting, playing again

A fixed number of seats starts when they are all taken and ends with the
room's rematch button. A range of seats needs someone to say "start": put a
`kit/lobby.js` start panel over the board, and the game offers its own "play
again" (`restart: 'own'` or `'rematch'` overrides either).

## Options

Choices made at the table before the game starts, shown beside the seats,
changed by anyone seated:

```js
options: {
  words: { label: 'words', choices: { en: 'English', es: 'Español' }, default: 'en' },
}
```

The chosen values reach the rules as `init({ options })`, and in an
authority game as `decide(…, { options })` and `tick({ options })`. They can
change until the first move. A game that plays round after round can open
them between rounds with `rules.optionsOpen(state)`, and then reads them in
`decide` when a round starts.

## The view

`view(el, ctx)` draws into `el` and returns `{ update, destroy }`.

- `ctx.play(move)` makes a move (in an authority game, sends it as an intent)
- `ctx.intend(intent)` sends an intent to the authority
- `ctx.colours` the seat colours, each player's own when `pieces: 'players'`
- `ctx.mySeat` this viewer's seat, or null for a spectator

`update(state, info)` runs whenever anything changes. `info` has `mySeat`,
`turn`, `names` (seat -> display name) and `last` (the latest move, to
animate).

Draw with shapes; recreo has no images. A board that turns round for one
player marks its turning group with `data-cursor-space`, so everyone's
pointers land on the same square.
