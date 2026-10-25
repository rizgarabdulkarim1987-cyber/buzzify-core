import { cookies } from 'next/headers';
import { getPrisma } from '@/server/data/prisma';
import { DEVICE_COOKIE } from './device-cookie';
import { resolveDevice } from './pin';

/** The live shared device this request's browser holds, if any (from the HttpOnly cookie). */
export async function currentDevice() {
  return resolveDevice(getPrisma(), (await cookies()).get(DEVICE_COOKIE)?.value);
}
