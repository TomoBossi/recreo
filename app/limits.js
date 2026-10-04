/**
 * How many people a room holds. In a full mesh everyone sends their video to
 * everyone else, so upload grows with each person; four stays comfortable on
 * a phone, and four is also the most a rollback game in the mesh supports.
 * Games may seat anywhere from one player up to this.
 */
export const CAPACITY = 4

/**
 * How many games a room has open at once. Everyone can be at a game of their
 * own with one more to spare; more than that is only clutter.
 */
export const TABLES = 5
