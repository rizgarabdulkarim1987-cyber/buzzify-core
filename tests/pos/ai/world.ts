import { randomUUID } from 'node:crypto';
import { baghdadDayOf } from '@/lib/baghdad';
import { writeAiPackage } from '@/server/ai/package';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { createPosItem, createPosPurchase, createPosSupplier, adjustPosStock } from '@/server/studio/actions/pos-inventory';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { dataOf, person, prisma, resetWorld, restaurant, run, type Person } from '../fixture';

/**
 * Test fixtures, not real data: two restaurants with the AI package on, an owner-level manager and a cashier in A, a manager
 * in B, a menu with one product, two tables, a supplier and (on request) a paid order today.
 */

export interface AiWorld {
  a: { id: string };
  b: { id: string };
  manager: Person;
  cashier: Person;
  bManager: Person;
  today: string;
  burger: string;
  tableId: string;
  supplierId: string;
}

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

export async function makeAiWorld(options: { aiOn?: boolean } = {}): Promise<AiWorld> {
  await resetWorld();
  const a = await restaurant('AI Alpha');
  const b = await restaurant('AI Bravo');
  const manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  const bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  if (options.aiOn !== false) {
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 50 });
    await writeAiPackage(prisma(), b.id, { enabled: true, monthlyLimit: 50 });
  }
  const menu = await prisma().menu.create({ data: { restaurantId: a.id, name: 'm', slug: 'ai-menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' } });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  const burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  const tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).id;
  const supplierId = dataOf(await run(manager, createPosSupplier, { name: 'Al-Noor', phone: '07701234567', notes: 'private note' })).supplierId;
  return { a, b, manager, cashier, bManager, today: baghdadDayOf(new Date()), burger, tableId, supplierId };
}

export const newItem = async (w: AiWorld, name: string, unit: 'GRAM' | 'MILLILITER' | 'PIECE' = 'GRAM', reorderLevel = 0) => dataOf(await run(w.manager, createPosItem, { name, unit, reorderLevel })).itemId;

export const stockUp = async (w: AiWorld, itemId: string, quantity: number) => run(w.manager, adjustPosStock, { itemId, quantity, reason: 'opening' });

export const buy = async (w: AiWorld, itemId: string, quantity: number, lineTotal: number) =>
  dataOf(await run(w.manager, createPosPurchase, { clientKey: randomUUID(), supplierId: w.supplierId, invoiceDay: w.today, lines: [{ itemId, quantity, lineTotal }] }));

/** The cashier opens a shift and takes one paid order of `quantity` burgers (5,000 each) at table 1. */
export async function paidOrder(w: AiWorld, quantity: number): Promise<number> {
  await run(w.cashier, openPosShift, { openingFloat: 0 }); // already open on a second call: ignored
  const opened = dataOf(await run(w.cashier, openPosOrder, { tableId: w.tableId }));
  const added = dataOf(await run(w.cashier, addPosLine, { orderId: opened.orderId, productId: w.burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  const total = quantity * 5000;
  dataOf(await run(w.cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: added.version, expectedTotal: total, amountReceived: total }));
  return total;
}

export async function complaint(restaurantId: string, body: string, extra: Record<string, unknown> = {}) {
  return prisma().posComplaint.create({ data: { restaurantId, clientKey: randomUUID(), body, ...extra } });
}
