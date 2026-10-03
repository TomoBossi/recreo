/** Every game recreo knows, by id. */
import connect4 from './connect4.js'
import chess from './chess.js'
import draw from './draw.js'

export const games = Object.fromEntries([connect4, chess, draw].map((g) => [g.id, g]))

/** Games still to come, shown on the shelf so the room says what is next. */
export const upcoming = [
  { id: 'golf', name: 'Minigolf', tone: 'leaf' },
]
