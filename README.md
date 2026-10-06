# recreo

A room for you and up to three friends: a video call, a chat, everyone's
cursors if you want them, and small games to play together. Static files,
no server, no build step, no images — everything is drawn from shapes.

Built on [plaza](https://github.com/TomoBossi/plaza) (rooms, connections,
presence, channels) and [mirador](https://github.com/TomoBossi/mirador)
(camera, microphone, who is speaking, layout), both vendored.

## Games

| | kind | seats |
|---|---|---|
| Connect four | turns | 2 |
| Chess | turns, with clocks | 2 |
| Pictionary | authority (one peer keeps time and judges guesses) | 2–4 |

Shelved — kept in `games/` and still working, but not offered (`shelved` in
`games/index.js`): tic-tac-toe, the smallest complete game and the one to copy
when writing a new one; and minigolf (integer physics, nine holes), while it is
reworked.

Several tables can be open at once; anyone not seated is watching. A dropped
connection keeps its seat, and so does a reload.

## Writing a game

A game is a folder under `games/` with one `defineGame()` call: its seats,
its rules, its view and its styles. The room does the rest — tables, seats,
options, spectators, shared pointers, keeping peers in step, rejoining,
endings and forfeits — and gives every game the same tools: boards that
turn for a player or stand on end on a phone, pointers that land on the
same square for everyone, touch handling, live sharing of a move in
progress, a start panel, layout by window size. `games/README.md`
documents the whole interface.

## The room

Everything is a window. **Tiled**, after dwm: the focused table is the
master, the rest stack beside it, and the split can be dragged. **Floating**:
windows move and resize freely. Any window collapses to its title. On a
phone the room is one scrolling column, and nothing relies on hover.

A room holds four. Video is capped for small tiles, so four people stay
inside a phone's uplink.

## Running it

```sh
python3 tools/serve.py            # then open http://127.0.0.1:8000
```

Any static file server works; `tools/serve.py` just makes sure the browser
never runs a stale copy of a file mid-edit.
Open it in two browsers with the same room code. `tools/sync-libs.sh`
refreshes the vendored plaza and mirador from checkouts beside this one.

## Hosting it

The room is plain HTML, CSS and JavaScript modules with relative paths:
put the folder on any static host, at any path — GitHub Pages included —
and it runs. The tests and the course checker are pages too. Node is only
for the scripts that drive browsers from outside — self-play and the network
tests, on Playwright and plaza's harness — never for the room itself.

## Testing it

```sh
sh tools/test.sh                  # rules and the game interface, in a headless browser
node tools/play/golf.mjs          # self-play in real browsers: a desk and a phone
node nettest/run.mjs              # real browsers in containers, broken networks
node nettest/run.mjs --all        # with the slow set: long outages, a phone
```

The tests are a page: open `/test/` in any browser while `tools/serve.py`
runs, or let `tools/test.sh` run it headless. The scripts in `tools/play/`
play each game in Chromium — one player with a mouse, one on a phone-sized
screen with a finger — and photograph every step.
The network tests run on plaza's harness (expected at `../plaza`): each peer
is a real browser, peers find each other through the public trackers, and
networks are broken for real — a forty-second outage mid-game, a reload, a
fifth person turned away, a drawer whose connection dies mid-round.
`DESIGN.md` records the decisions behind all of it.
