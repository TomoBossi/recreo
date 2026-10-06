/**
 * Every game recreo knows. A game is a folder with an index.js whose default
 * export is a defineGame() call; adding one means adding a line here.
 */
import connect4 from './connect4/index.js'
import chess from './chess/index.js'
import pictionary from './pictionary/index.js'
import minigolf from './minigolf/index.js'
import tictactoe from './tictactoe/index.js'

export const games = Object.fromEntries([connect4, chess, pictionary, minigolf, tictactoe].map((g) => [g.id, g]))

/** Games still to come, shown on the shelf so the room says what is next. */
export const upcoming = []

/**
 * Games kept but not offered: off the shelf, so nobody opens a new table,
 * yet still known, so a table someone already has open keeps working.
 */
export const shelved = new Set(['minigolf', 'tictactoe'])
