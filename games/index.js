/** Every game recreo knows, by id. */
import connect4 from './connect4.js'

export const games = Object.fromEntries([connect4].map((g) => [g.id, g]))

/** Games still to come, shown on the shelf so the room says what is next. */
export const upcoming = [
  { id: 'chess', name: 'Chess', tone: 'grape' },
  { id: 'draw', name: 'Draw & guess', tone: 'berry' },
  { id: 'golf', name: 'Minigolf', tone: 'leaf' },
]
