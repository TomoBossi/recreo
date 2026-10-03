/**
 * How many people a room holds. In a full mesh everyone sends their video to
 * everyone else, so upload grows with each person; four stays comfortable on
 * a phone, and four is also the most a rollback game in the mesh supports.
 * Games may seat anywhere from one player up to this.
 */
export const CAPACITY = 4
