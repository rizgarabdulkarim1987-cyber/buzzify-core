/** Where a pharmacy definition works: the business and, unless "All branches", the branch. */
export interface PhPlaceInput {
  restaurantId: string;
  branchId?: string;
}

/**
 * The raw input of a pharmacy Server Action with the place put in on the server: any `restaurantId` or `branchId` the
 * browser sent is dropped, and the chosen place (from the signed cookie, checked again) takes their keys. Anything that
 * is not an object becomes just the place, which the definition's schema then refuses.
 */
export function withPlace(raw: unknown, place: PhPlaceInput): Record<string, unknown> {
  const fields = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  delete fields.restaurantId;
  delete fields.branchId;
  return place.branchId === undefined ? { ...fields, restaurantId: place.restaurantId } : { ...fields, restaurantId: place.restaurantId, branchId: place.branchId };
}

/**
 * The raw input of a REPORT read: the business comes from the chosen place on the server (a `restaurantId` from the browser is dropped), but the
 * branch is the person's own filter and stays (ruling R6-15): the place switcher's branch does not narrow a report, because every report has its
 * own branch filter whose default is "all my branches". The report's own checks refuse a branch that is not one of the person's.
 */
export function withBusiness(raw: unknown, restaurantId: string): Record<string, unknown> {
  const fields = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  delete fields.restaurantId;
  return { ...fields, restaurantId };
}
