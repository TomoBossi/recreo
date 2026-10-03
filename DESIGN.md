# recreo — design

Working notes. What is decided, what it implies for the engineering, and the
order things get built in.

## The room

Up to **four** people. In a full mesh everyone uploads their video once per
other person, so upload grows with every arrival; four stays comfortable on a
phone's uplink with small tiles capped at 400 kbps, and four is also the most
a rollback game in the mesh (gomero) supports. A fifth person is told the room
is full: everyone ranks the room by when each player came in, so whoever is
fifth knows it without being told.

Everyone is in one plaza room: video, chat, presence, optionally cursors.
Games happen at **tables** inside the room.

- **Several tables at once.** Two people play chess while three draw, in the
  same call. A table has a game, seats, and whoever is watching.
- **Spectating is the default for anyone not seated.** Every peer receives
  every table's traffic anyway — five people in a mesh, turn-based moves and
  drawing strokes are cheap — so watching a table is only a matter of
  rendering it. Joining a table as a spectator costs nothing to build later.
- **No cheating to defend against.** This is a room of friends. Nothing is
  validated against malice, hidden information may live in everyone's state
  with only the interface hiding it, and the simplest correct design wins.

## Layout: a small window manager

The game is the stage; faces sit beside it; chat is a narrow strip, not a
pane. Everything is a **window**: each table, the video strip, the chat.

- **Tiled mode**, dwm-style: a master area (the focused table) and a stack
  (everything else), arranged automatically.
- **Floating mode**: windows can be moved and resized freely.
- Any window collapses to its title bar.
- Several tables are simply several windows.

The OMGPOP look: bright, chunky, rounded, friendly, a little less rounded and
thinner in the line than the original. Everything drawn from shapes; no
images.

**Phones and touch from the start.** On a narrow screen the windows become
one scrolling column at natural heights, so a board is playable. Nothing
relies on hover: where a mouse previews by hovering, a finger's first tap
previews and a second tap confirms.

## Game state: two modes, chosen per game

**Replicated** — every peer runs the whole game and applies every move. No
host, nobody whose departure ends the game. Fits any game where only one
seat acts at a time (chess, connect four, minigolf's turns), or where actions
commute.

- Moves travel on a reliable, ordered plaza channel per table.
- **Randomness does not force a host.** A seed chosen when the table opens
  feeds a deterministic generator in the game state, so every peer draws the
  same "random" numbers. What forces a host is *concurrent* actions whose
  order matters — two people guessing the word at the same moment.
- Joining late or reconnecting: ask any peer at the table for the current
  state (plaza's `request`/`answer`), then apply moves from there.

**Authoritative** — one peer runs the game; the others send intents and
receive state. For games with racing inputs or real-time simulation.

- The authority broadcasts snapshots often enough that anyone can take over.
- **Handover**: when the authority leaves (after plaza's hold runs out, not
  on a blip), the next one is chosen without discussion — e.g. the
  lowest-id player still at the table — and resumes from the last snapshot.
- Drawing guess: the drawer is the natural authority (their strokes feel
  instant, and "who guessed first" is decided in one place).

The game interface supports both from the start, even though the first two
games only need replicated.

## Identity and seats

plaza's peer id lasts one page load, so a reload would lose a seat. recreo
gives each player a stable id, kept per tab and carried in presence; seats
belong to that id, not to the peer. A dropped peer keeps its seat through
plaza's hold and gets it back on readmission; a reloaded tab reclaims it by
player id. (A duplicated tab copies per-tab storage, so a clash has to be
detected and resolved.)

## First games

1. **Connect four** — replicated. The smallest real game; proves the table,
   seat, spectator and resync machinery.
2. **Chess** — replicated.
3. **Drawing guess** — authoritative, with handover; the drawer is the
   authority.
4. **Minigolf** — replicated, turn-based physics; deterministic integer or
   fixed-point maths so every peer's ball lands in the same place.

## Build order

1. **Shell**: landing page, join by code or invite, camera via mirador, the
   plaza room, video and chat windows, tiled and floating modes.
2. **Tables** and **connect four**: open a table, sit, play, watch, resync on
   join and reconnect.
3. Chess. 4. Drawing guess. 5. Minigolf. 6. Cursors over the unreliable
   channel.

Each step ships with nettest scenarios — several peers in Docker, and a
two-peer run with a phone on mobile data.

## Constraints

Static files on GitHub Pages, no build step, no server. plaza and mirador
are vendored, as tertulia does. Developed locally; not pushed until ready.
