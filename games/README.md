# Writing a game for recreo

A game is a folder here: an `index.js` whose default export is one
`defineGame()` call, and usually a `style.css` beside it. recreo handles the
table, the seats, the options, the spectators, everyone's pointers, keeping
every peer in step, bringing back whoever drops out, and saying who won. The
game handles its rules and its picture. Nothing about networking, ever.

Everything is plain HTML, CSS and JavaScript modules, loaded as they are by
the browser from static hosting. No build step, no packages, no images: a
game draws itself from shapes.

```
games/
  kit/              shared by every game
    define.js       defineGame(): checks a game's description, fills in defaults
    svg.js          board(), shape(), pointIn(), escape(), INK, PAPER
    lobby.js        startPanel(): "start!" / "waiting" / "play again" over a board
    random.js       next(), int(), pick(): a seeded generator kept in the state
    sound.js        sound.play(), countdown(): sounds made by Web Audio, no files
  tictactoe/        the smallest complete game: copy this one to start
  connect4/         turns, two seats, tap-to-preview on touchscreens
  chess/            turns, two seats, a board turned for black, clocks beside it
  minigolf/         turns, one to four seats, integer physics, a board that stands on end
  pictionary/       authority, two to four seats, word lists, an option, live drawing
  index.js          the list of games: one import line each
```

## Adding a game

1. Copy `tictactoe/` to a new folder named after the game's id.
2. Change the id, name, rules, view, styles and icon.
3. Add one import line to `games/index.js`.
4. `sh tools/test.sh` checks every registered game against the interface
   (or open `/test/` in a browser).
5. Play it against yourself in two browsers (see [Trying it](#trying-it)).

## defineGame

```js
export default defineGame({
  id: 'tictactoe',          // lowercase letters, digits, dashes; travels between peers
  name: 'Tic-tac-toe',
  styles: new URL('./style.css', import.meta.url),  // the game's own CSS, loaded with it
  tone: 'tang',             // window colour: sun berry leaf grape tang sky
  kind: 'turns',            // or 'authority', below
  seats: 2,                 // or { min: 1, max: 4 }; from 1 up to the room's 4
  pieces: ['#ff5d8f', '#2fa4e6'],  // a colour per seat, or 'players' for each player's own
  options: { ... },         // optional, below
  rules,                    // functions, below
  view,                     // (el, ctx) => { update, hear?, destroy }
  phoneHeight: (w) => w,    // optional: the stage's height in a phone's column, below
  restart: 'own',           // optional: 'own' or 'rematch', below
  icon: '<rect …/>',        // SVG shapes in a 56×44 box, for the shelf
})
```

A mistake — a missing rule, six seats, a default that is not a choice, a
`styles` that is not a URL — fails when the game loads, with a message
naming the game.

## Two kinds of game

**`turns`** — every peer runs the whole game and applies every move. For
anything where one seat acts at a time, or where actions commute.

```js
rules = {
  init({ seed, seats, options }),        // -> the starting state
  turn(state),                           // -> the seat to move, 'any', or null when over
  legal(state, move, seat),              // -> may this seat make this move now?
  apply(state, move, seat),              // -> the next state; never change the argument
  status(state, names, { seat }),        // -> one line for the bar under the board
  outcome(state, names),                 // -> null, or { winners, draw?, reason } once over
  forfeit(state, seat, { at }),          // -> the state after a seat gives up
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
  status(state, names, { seat }),
  outcome(state, names),
  forfeit(state, seat, { at }),
  tick(state, { now, here, options }),  // optional: moves the clock makes, run every 400ms
  authority(state, here),               // optional: which seat runs it (default: lowest here)
}
```

`names` maps each seat to its player's display name. `status` is told who
is reading it: a game that words its line differently for that player —
"your putt!" — is shown as it wrote it; otherwise the room tells whoever is
to move "your turn!", "waiting for ana to come back…" while their turn
waits on someone who dropped, and so on.

## Rules must agree everywhere

Every peer applies the same moves in the same order, so `init`, `legal` and
`apply` must give the same answer on every machine:

- no `Math.random()`: randomness comes from `seed`, through `kit/random.js`,
  with the generator kept in the state;
- no `Date.now()`: a time is part of a move, stamped by whoever made it —
  chess sends how long a move took, minigolf sends where the windmill stood
  when the ball was struck;
- no floating point whose last bit could differ between machines in
  anything that decides the game: minigolf's physics is integers
  throughout, square roots included (`isqrt` in `minigolf/physics.js`).

States and moves are plain JSON: a late arrival is sent the moves so far and
replays them.

## Endings and forfeits

Every game says how it ended. `outcome` returns `null` while the game is on,
then `{ winners: [seat…], draw?: true, reason }` — `reason` is a few words,
"four in a row", "ana forfeited", "18 strokes, par 16". The room turns it
into a card over the board for each viewer — "you win!", "you lose", "it's a
draw", or "tomo wins!" for someone watching — and a line in the chat.

Anyone seated can forfeit while a game is on; their seat offers it in place
of "leave". `forfeit` says what that means in this game:

- a duel ends, and the other player wins;
- with more players the game can drop the seat and play on, keeping their
  score as it stood (minigolf, Pictionary) — and end early if only one
  player is left.

A forfeiter never counts among the winners. A forfeit can arrive at any
time, not only on the forfeiter's turn; recreo settles one that races
another move the same way on every peer. A player who closes their tab, or
whose connection stays down for two minutes, forfeits on their own.

## Seats, starting, playing again

A fixed number of seats starts when they are all taken, and ends with the
room's rematch button. A range of seats needs someone to say "start": put a
start panel over the board, and the game offers its own "play again".
`restart: 'own'` or `'rematch'` overrides either.

```js
import { startPanel } from '../kit/lobby.js'
const lobby = startPanel(el, { onStart: () => ctx.play({ type: 'start', order: seated }), startLabel: 'tee off!' })
lobby.update({ open, seated, min, mine, again, extra })   // extra: markup above, a scorecard say
```

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
change until the first move, and then hold for the table's life, play again
included. A game that plays round after round can open them between rounds
with `rules.optionsOpen(state)`, and then reads them in `decide` when a
round starts.

## The view

`view(el, ctx)` draws into `el` — the stage, the area between the seats and
the status line — and returns:

```js
{
  update(state, info),   // whenever anything changes
  hear(data, seat),      // optional: something another player is in the middle of
  destroy(),             // the table closed: remove listeners, timers, frames
}
```

`ctx` is the view's way out:

| | |
|---|---|
| `ctx.play(move)` | make a move (in an authority game, sends it as an intent) |
| `ctx.intend(intent)` | send an intent to the authority |
| `ctx.share(data)` | show everyone else what you are in the middle of, below |
| `ctx.colours` | the seat colours, each player's own when `pieces: 'players'` |
| `ctx.mySeat` | this viewer's seat, or null for a spectator |

`info` has `mySeat` (null until the game can begin, and for spectators),
`turn`, `names` and `last` (the latest move record). To animate a move,
compare the state with the one before: a new disc falls, a new mark draws
itself in, a new shot rolls out. Someone arriving late gets the current
state in one update, with nothing before it to compare against, and sees
the board as it stands.

### Sharing what is in progress

A move is final; what leads up to it often is worth seeing too — the aim
being pulled back before a putt, a pointer hovering over a column.

```js
ctx.share([dx, dy])     // as it changes; a few dozen times a second at most
ctx.share(null)         // done: let go, or cancelled
view.hear(data, seat)   // on everyone else's screen
```

It is not a move: it changes no state, a late arrival never sees it, and a
lost message is simply replaced by the next, so it travels unreliably and is
thinned to about thirty a second. Only seated players' sharing is passed on,
with the seat they hold. Anything JSON fits; keep it small. Minigolf shares
the shot being aimed and draws it faintly on the others' screens.

## Boards

Most games draw an SVG board with `board()` from `kit/svg.js`. It sizes
itself to whatever room the window leaves, keeps its shape, and gives the
game a space to draw in, in the board's own coordinates:

```js
const b = board(el, { width: 1000, height: 600, pad: 6, className: 'golf', fit: true, onTurn })
b.space.innerHTML = '…'      // draw here, in 0…width × 0…height
b.point(e)                   // a pointer event, in board coordinates
b.turn(180)                  // turn the board round (chess, for black)
b.upright(x, y)              // a transform keeping a label at (x, y) upright
b.margin({ right: 270 })     // room round the board, for layers that never turn
b.svg                        // the root: those layers go here (chess's clocks)
b.angle                      // how the board is turned now: 0, 90, 180 or 270
```

**Pointers.** Everyone's cursor is drawn over the game, and travels in board
coordinates: `b.space` carries `data-cursor-space`, so a pointer over e4 is
over e4 on every screen, whichever way each player sees the board, however
big their window. The letterboxing round a board is not shared: leaving the
board is leaving. Controls outside the board that everyone has — a start
button, a scoreboard — opt in with `data-cursor-anchor="name"`, and a
pointer over one lands on the same control, at the same spot in it, for
everyone. (The seats, options, status line and end-of-game card already
do.)

**Turning.** A game turns its board for a player with `b.turn()`; chess
turns it for whoever plays black. `fit: true` lets a board wider than it is
tall stand on end when its window is the other shape — a course on a phone
held upright — turning a quarter so its left edge is at the bottom. `onTurn`
is called when the angle changes, for a game with labels to keep upright
with `b.upright()`. Clicks need no translating: `b.point(e)` and the
board's own elements are already in board coordinates.

## Touch and pointers

Use pointer events: one code path for mice, pens and fingers.

- **A drag over a stage is input**, never a scroll or a zoom: the stage and
  everything in it has `touch-action: none`. A part that should scroll — a
  log, a list — gets the class `scrolls`, and scrolls up and down.
- **Fingers do not hover.** Anything shown on hover needs a touch
  equivalent. Connect four's convention: a mouse previews by hovering and
  commits by clicking; a finger's first tap previews and a second tap on
  the same column commits.
- **Drags** should `setPointerCapture`, so a drag that leaves the board
  keeps going. A drag that can be called off (minigolf's aim) stops on
  Escape, a right click, or `pointercancel`.
- **Measure gestures on the screen**, not in board units, when their size
  matters to the hand: minigolf's full-power pull is 180 pixels on a phone
  and on a monitor alike.

## Layout

The stage is positioned and clips what it holds. A `board()` fills it with a
12px margin. Panels over the board share the start panel's look with the
class `game-panel` (Pictionary's word choice and reveal). The room draws the
end-of-game card itself.

The stage is a CSS container named `stage`, so a game lays itself out by the
size of its own window — on a phone, in a narrow tiled column, or in a big
floating window alike:

```css
@container stage (max-width: 560px) { .draw-main { flex-direction: column; } }
```

On a phone the windows stack in one scrolling column, each as tall as it
asks. A game whose stage is not a roughly square board says how tall it
wants to be for a given width, in CSS pixels:

```js
phoneHeight: (width) => width * 0.7 + 330    // Pictionary: the paper, then scores and guesses
phoneHeight: (width) => width * 1012 / 612   // minigolf: the course stood on end
```

## Styles

A game's CSS lives in its own `style.css`, named in `styles`, and is loaded
when the game is. Prefix selectors with the game's own class (`.golf …`,
`.draw-…`) so games never collide. Use the room's variables — `--ink`,
`--panel`, `--sun`, `--berry`, `--leaf`, `--field`, `--text`,
`--text-soft`, `--line`, `--font` — and a game follows the room into dark
mode for free. SVG uses `INK` and `PAPER` from `kit/svg.js` for outlines
and paper.

## Sound

The room already sounds every control — a click down and up, two notes
for a choice, a slide for a switch — so a game's buttons need nothing. A control can ask for another sound with
`data-sound="select"`, or for none with `data-sound="none"`.

For what happens in the game itself, `kit/sound.js`:

```js
import { sound, countdown } from '../kit/sound.js'
sound.play('tick')                 // press release select on off message tick tock last
const ticks = countdown()          // a clock's last five seconds: tick, tock… and a brighter last
ticks.update(msLeft)               // whenever the clock is redrawn; it sounds each second once
```

Every sound is made on the spot from tones and filtered noise — no files —
and follows the player's setting (on, quiet, off). Nothing plays before
the page's first click, which browsers require. `tools/sounds/` plays and
draws every sound, for tuning them by ear; a new one is a few lines in
`SOUNDS`.

## Motion and the battery

A room runs for hours on phones, so a still game must cost nothing.

- **Nothing animates forever.** A flourish plays a few times and rests. The
  exception is motion the game is played by, like minigolf's windmill;
  mark it with the class `essential`.
- **Less motion, when asked.** Under `prefers-reduced-motion`, every
  animation on a stage jumps to its end — a mark drawn, a disc landed —
  except those marked `essential`. Write animations whose end state is the
  right picture, and this costs nothing extra.
- **Timers only while they show something changing.** Chess's clocks tick
  only while one is counting down; Pictionary's only during a timed phase.
  `requestAnimationFrame` loops only while something moves, and stop.
- **Redraw what changed.** Pictionary appends new strokes instead of
  redrawing the drawing.

## Trying it

```sh
python3 tools/serve.py                    # the room at http://127.0.0.1:8000, never stale
sh tools/test.sh                          # every game against the interface, and their rules
node tools/play/golf.mjs                  # two players, desk and phone, putting round the course
```

`tools/play/` has scripts that play each game in real browsers — one player
at a desk with a mouse, one on a phone with a finger — and photograph every
step into `tools/shots/play/`; they need Playwright (`npm install` in
`tools/`). The tests are a page, `/test/`, and so is minigolf's course
checker, `/tools/golf/`: that each hole can be sunk, that no ball ends
inside a wall, and what par a decent player makes. The game itself needs
nothing.
