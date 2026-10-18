/** The level (normal 50, high 75, top 100) nearest to a stored priority or weight, which older rows may hold as any number. */
export function strengthLevel(value: number): 50 | 75 | 100 {
  return value >= 88 ? 100 : value >= 63 ? 75 : 50;
}
