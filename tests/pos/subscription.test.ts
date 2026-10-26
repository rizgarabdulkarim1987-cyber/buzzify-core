import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cashierSubscriptionOf } from '@/server/pos/subscription';
import { registerPosDevice, revokePosDevice } from '@/server/studio/actions/pos-pin';
import { posDevices } from '@/server/studio/queries/pos-pin';
import { ask, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase } from './fixture';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => {
  useTestDatabase();
});
beforeEach(resetWorld);
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the settings page’s subscription line', () => {
  it('reads the live state of the restaurant’s own Cashier subscription', async () => {
    const a = await restaurant('Sub A');
    const view = await cashierSubscriptionOf(prisma(), a.id);
    expect(view?.state).toBe('ACTIVE');
    expect(new Date(view!.until).getTime()).toBeGreaterThan(Date.now());
  });

  it('shows grace once the period has run out, before any job has moved the row', async () => {
    const a = await restaurant('Sub B');
    const view = await cashierSubscriptionOf(prisma(), a.id, new Date(Date.now() + 27 * 86_400_000));
    expect(view?.state).toBe('GRACE');
  });

  it('is null for a restaurant with no Cashier subscription and never shows another restaurant’s', async () => {
    const a = await restaurant('Sub C');
    const b = await restaurant('Sub D', 'none');
    expect(await cashierSubscriptionOf(prisma(), b.id)).toBeNull();
    expect(await cashierSubscriptionOf(prisma(), a.id)).not.toBeNull();
  });
});

describe('the devices query', () => {
  it('lists live devices of the manager’s own restaurant and none of the token', async () => {
    const a = await restaurant('Dev A');
    const b = await restaurant('Dev B');
    const ma = await person('ma', { staff: [a.id, 'MANAGER'] });
    const mb = await person('mb', { staff: [b.id, 'MANAGER'] });
    dataOf(await run(ma, registerPosDevice, { name: 'Till A' }));
    const other = dataOf(await run(mb, registerPosDevice, { name: 'Till B' }));
    const list = dataOf(await ask(ma, posDevices, {}));
    expect(list.map((d) => d.name)).toEqual(['Till A']);
    expect(JSON.stringify(list)).not.toContain('token');
    dataOf(await run(mb, revokePosDevice, { deviceId: other.deviceId }));
    expect(dataOf(await ask(mb, posDevices, {}))).toEqual([]);
  });
});
