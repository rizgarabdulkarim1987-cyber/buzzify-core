import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDishCounts } from '@/server/data/dish-counts';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

/** The numbers on a dish card: paid till quantities and the permanent view totals (docs/superpowers/specs/2026-10-30-menu-dish-counts-design.md). */

const prisma = testPrisma();
let x: Awaited<ReturnType<typeof createMenuFixture>>;
let other: Awaited<ReturnType<typeof createMenuFixture>>;
let next = 0;

/** One order with one line of `quantity` of the product; paid and refunded as asked. */
async function sale(productId: string | null, quantity: number, { paid = true, cancelled = false, refunded = false, restaurantId = x.restaurant.id }: { paid?: boolean; cancelled?: boolean; refunded?: boolean; restaurantId?: string } = {}) {
  next += 1;
  const order = await prisma.posOrder.create({ data: { restaurantId, number: next } });
  const payment = paid
    ? await prisma.posPayment.create({ data: { restaurantId, orderId: order.id, method: 'CASH', amountReceived: 0, totalsSnapshot: {} } })
    : null;
  if (payment && refunded) {
    await prisma.posPaymentReversal.create({ data: { restaurantId, paymentId: payment.id, orderId: order.id, method: 'CASH', amount: 0, reason: 'test' } });
  }
  await prisma.posOrderLine.create({
    data: { restaurantId, orderId: order.id, productId, nameSnapshot: 'x', unitPriceSnapshot: 100, quantity, paymentId: payment?.id ?? null, cancelledAt: cancelled ? new Date() : null },
  });
}
const views = (productId: string, count: number, menuId = x.menu.id) => prisma.productViewTotal.create({ data: { menuId, productId, views: count } });

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, 'counts-x', { publish: false });
  other = await createMenuFixture(prisma, 'counts-y', { publish: false });
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('loadDishCounts', () => {
  it('sums the quantities of paid lines and adds the view total', async () => {
    await sale(x.product.id, 2);
    await sale(x.product.id, 3);
    await views(x.product.id, 40);
    expect((await loadDishCounts(prisma, x.menu.id)).get(x.product.id)).toEqual({ orders: 5, views: 40 });
  });

  it('does not count unpaid, cancelled or refunded lines', async () => {
    await sale(x.product.id, 1);
    await sale(x.product.id, 7, { paid: false });
    await sale(x.product.id, 7, { cancelled: true });
    await sale(x.product.id, 7, { refunded: true });
    expect((await loadDishCounts(prisma, x.menu.id)).get(x.product.id)?.orders).toBe(1);
  });

  it('leaves out a dish with views but no paid order', async () => {
    await views(x.product.id, 12);
    await sale(x.product.id, 1, { paid: false });
    expect((await loadDishCounts(prisma, x.menu.id)).has(x.product.id)).toBe(false);
  });

  it('ignores lines of another menu and lines whose dish is gone', async () => {
    await sale(other.product.id, 4, { restaurantId: other.restaurant.id });
    await sale(null, 4);
    expect((await loadDishCounts(prisma, x.menu.id)).size).toBe(0);
    expect((await loadDishCounts(prisma, other.menu.id)).get(other.product.id)?.orders).toBe(4);
  });

  it('keeps views per menu', async () => {
    await sale(x.product.id, 1);
    await views(x.product.id, 9);
    await views(x.product.id, 500, other.menu.id);
    expect((await loadDishCounts(prisma, x.menu.id)).get(x.product.id)?.views).toBe(9);
  });

  it('reads a menu of 300 dishes with one grouped query on the till lines', async () => {
    for (let k = 0; k < 300; k++) {
      await prisma.product.create({ data: { menuId: x.menu.id, categoryId: x.category.id, slug: `bulk-${k}`, basePrice: 100, translations: { en: { name: `B${k}` } } } });
    }
    await sale(x.product.id, 1);
    let grouped = 0;
    const counted = Object.create(prisma, {
      posOrderLine: {
        value: Object.create(prisma.posOrderLine, {
          groupBy: { value: (...args: Parameters<typeof prisma.posOrderLine.groupBy>) => { grouped += 1; return (prisma.posOrderLine.groupBy as (...a: unknown[]) => unknown)(...args); } },
        }),
      },
    });
    const result = await loadDishCounts(counted, x.menu.id);
    expect(result.get(x.product.id)?.orders).toBe(1);
    expect(grouped).toBe(1);
  });
});
