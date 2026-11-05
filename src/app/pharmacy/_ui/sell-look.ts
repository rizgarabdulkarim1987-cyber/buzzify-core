/**
 * The Sell screen's look on a big screen: how search, results, cart and pay bar are arranged. A per-device choice kept in a cookie the
 * server reads (so the first paint is already the chosen look), like the restaurant cashier's `pos-desk`. Phones keep their own layout.
 * Pharmacy products have no photos, so there is no "photo" look; Classic is today's arrangement.
 */
export const LOOKS = ['classic', 'rows', 'cards', 'split', 'board', 'register', 'stack'] as const;
export type SellLook = (typeof LOOKS)[number];
export const DEFAULT_LOOK: SellLook = 'classic';
export const LOOK_COOKIE = 'ph-look';

export function lookOf(value: string | undefined): SellLook {
  return (LOOKS as readonly string[]).includes(value ?? '') ? (value as SellLook) : DEFAULT_LOOK;
}
