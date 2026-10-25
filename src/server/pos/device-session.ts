import { cookies } from 'next/headers';
import { getPrisma } from '@/server/data/prisma';
import { cashierSubscriptionOf } from './subscription';
import { DEVICE_COOKIE } from './device-cookie';
import { listPinStaff, resolveDevice } from './pin';

/** The live shared device this request's browser holds, if any (from the HttpOnly cookie). */
export async function currentDevice() {
  return resolveDevice(getPrisma(), (await cookies()).get(DEVICE_COOKIE)?.value);
}

/** The switch screen's data: the device and who can pick themselves on it; null when the browser holds no live device. */
export async function switchScreenData() {
  const device = await currentDevice();
  return device ? { deviceName: device.name, staff: await listPinStaff(getPrisma(), device) } : null;
}

/** Whether the signed-in till person has set a quick PIN (never the PIN itself). */
export async function hasOwnPin(actor: { restaurantId: string; userId: string }): Promise<boolean> {
  const row = await getPrisma().posStaff.findFirst({
    where: { restaurantId: actor.restaurantId, userId: actor.userId, deactivatedAt: null },
    select: { pinHash: true },
  });
  return row?.pinHash != null;
}

/** The restaurant's Cashier subscription as the settings page states it. */
export const currentCashierSubscription = (restaurantId: string) => cashierSubscriptionOf(getPrisma(), restaurantId);
