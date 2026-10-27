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
