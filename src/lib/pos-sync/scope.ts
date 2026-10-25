/** One person at one restaurant: the key a device keeps its queue and snapshot under. */
export type Scope = string;

export function scopeOf(restaurantId: string, userId: string): Scope {
  return `${restaurantId}:${userId}`;
}
