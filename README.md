# recreo

A room for you and up to three friends: a video call, a chat, everyone's
cursors if you want them, and small games to play together. Static files,
no server, no build step, no images — everything is drawn from shapes.

Built on [plaza](https://github.com/TomoBossi/plaza) (rooms, connections,
presence, channels) and [mirador](https://github.com/TomoBossi/mirador)
(camera, microphone, who is speaking, layout), both vendored.

## Games

| | mode | seats |
|---|---|---|
| Connect four | replicated | 2 |
| Chess | replicated | 2 |
| Draw & guess | authoritative (the drawer) | 2–4 |
| Minigolf | replicated, integer physics | 2–4 |

Several tables can be open at once; anyone not seated is watching. A dropped
connection keeps its seat, and so does a reload. `games/README.md` explains
how to add one.

## The room

Everything is a window. **Tiled**, after dwm: the focused table is the
master, the rest stack beside it, and the split can be dragged. **Floating**:
windows move and resize freely. Any window collapses to its title. On a
phone the room is one scrolling column, and nothing relies on hover.

A room holds four. Video is capped for small tiles, so four people stay
inside a phone's uplink.

## Running it

```sh
python3 -m http.server 8000      # then open http://localhost:8000
```

Open it in two browsers with the same room code. `tools/sync-libs.sh`
refreshes the vendored plaza and mirador from checkouts beside this one.

## Testing it

```sh
npm test                          # rules, without a browser
node nettest/run.mjs              # real browsers in containers
node nettest/run.mjs phone-c4     # against a phone (ssh phone, Termux)
```

The network tests run on plaza's harness (expected at `../plaza`): each peer
is a real browser, peers find each other through the public trackers, and
networks are broken for real — a forty-second outage mid-game, a reload, a
fifth person turned away, a drawer whose connection dies mid-round.
`DESIGN.md` records the decisions behind all of it.
