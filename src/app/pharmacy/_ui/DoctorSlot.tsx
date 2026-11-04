/**
 * The place where the AI Doctor appears on the home screen and the sale screen. It renders nothing today: the AI Doctor
 * plan fills it in (it hands items to the sale screen through `cart-bridge.ts` or `?add=`).
 */
export function DoctorSlot({ where }: { where: 'home' | 'sell' }): null {
  void where;
  return null;
}
