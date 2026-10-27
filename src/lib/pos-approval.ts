/** What the till screens share about manager approval: the discount reasons and who can approve. Client-safe (no server imports). */

export const DISCOUNT_REASONS = ['MANAGER_DECISION', 'REGULAR_GUEST', 'COMPLAINT', 'STAFF_MEAL', 'OTHER'] as const;
export type DiscountReason = (typeof DISCOUNT_REASONS)[number];

export interface Approver {
  staffId: string;
  name: string;
}
