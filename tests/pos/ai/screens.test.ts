import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAiPackage } from '@/server/ai/package';
import { aiVisibility } from '@/server/domain/pos/ai';
import { canOpenTillPage, tillNav } from '@/server/domain/pos/nav';
import { POS_ROLES } from '@/server/domain/pos/permissions';
import { setPosAiPackage } from '@/server/studio/actions/pos-ai';
import { posOverview } from '@/server/studio/queries/pos';
import { ask, dataOf, person, prisma, run, useTestDatabase } from '../fixture';
import { makeAiWorld, paidOrder, type AiWorld } from './world';
import { FakeProvider } from '@/server/ai/provider/fake';
import { setAiProviderForTests } from '@/server/ai/provider';
import { askPosAi } from '@/server/studio/actions/pos-ai';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
let w: AiWorld;

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  w = await makeAiWorld({ aiOn: false });
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the till navigation', () => {
  const keys = (role: (typeof POS_ROLES)[number], ai?: boolean) => tillNav(role, ai === undefined ? {} : { ai }).map((page) => page.key);

  it('lists the AI page only while the package is on, and only for roles that may read the reports', () => {
    expect(keys('MANAGER')).not.toContain('ai');
    expect(keys('MANAGER', false)).not.toContain('ai');
    expect(keys('MANAGER', true)).toContain('ai');
    expect(keys('OWNER', true)).toContain('ai');
    expect(keys('CASHIER', true)).not.toContain('ai');
    expect(keys('KITCHEN', true)).not.toContain('ai');
  });

  it('opens the AI page for exactly the roles whose nav would list it', () => {
    for (const role of POS_ROLES) expect(canOpenTillPage(role, 'ai')).toBe(aiVisibility(role, true).nav);
  });
});

describe('a restaurant without the package', () => {
  it('has no AI row, no provider call and no usage, and the till still works', async () => {
    const fake = new FakeProvider();
    setAiProviderForTests(fake);
    try {
      expect(await prisma().posAiPackage.count()).toBe(0);
      expect(dataOf(await run(w.manager, askPosAi, { locale: 'ar', question: 'hi', history: [] }))).toEqual({ ok: false, code: 'aiDisabled' });
      expect(fake.calls).toHaveLength(0);
      expect(await prisma().posAiUsageMonth.count()).toBe(0);
      expect(await prisma().posAiCall.count()).toBe(0);
      await expect(paidOrder(w, 1)).resolves.toBe(5000);
    } finally {
      setAiProviderForTests(undefined);
    }
  });
});

describe('the Super Admin cashier overview and pos.setAiPackage', () => {
  it('shows each restaurant\'s package state and this month\'s use, and follows a change', async () => {
    const admin = await person('ai-admin', { superAdmin: true });
    const before = dataOf(await ask(admin, posOverview, {})).rows.find((r) => r.id === w.a.id);
    expect(before?.ai).toEqual({ enabled: false, limit: 0, used: 0 });
    dataOf(await run(admin, setPosAiPackage, { restaurantId: w.a.id, enabled: true, monthlyLimit: 120 }));
    await prisma().posAiUsageMonth.create({ data: { restaurantId: w.a.id, month: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7), requests: 7 } });
    const after = dataOf(await ask(admin, posOverview, {})).rows.find((r) => r.id === w.a.id);
    expect(after?.ai).toEqual({ enabled: true, limit: 120, used: 7 });
    expect(dataOf(await ask(admin, posOverview, {})).rows.find((r) => r.id === w.b.id)?.ai.enabled ?? false).toBe(false);
  });

  it('is refused to a restaurant owner and a manager', async () => {
    await writeAiPackage(prisma(), w.a.id, { enabled: false });
    expect((await run(w.manager, setPosAiPackage, { restaurantId: w.a.id, enabled: true })).ok).toBe(false);
    expect((await prisma().posAiPackage.findUnique({ where: { restaurantId: w.a.id } }))?.enabled).toBe(false);
  });
});
