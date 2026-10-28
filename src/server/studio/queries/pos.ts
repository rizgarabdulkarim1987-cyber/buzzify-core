import { z } from 'zod';
import { baghdadMonthOf } from '@/lib/baghdad';
import { effectiveStatus } from '@/server/domain/billing/subscriptions';
import { readFloor } from '@/server/pos/floor';
import { readOrderView } from '@/server/pos/orders';
import { readKitchenQueue, readKitchenScope, readKitchenTicket } from '@/server/pos/kitchen';
import { dayField, readDailyReport, readShiftReport } from '@/server/pos/report';
import { readBoard } from '@/server/pos/board';
import { readReceipt } from '@/server/pos/payments';
import { listOpenShifts, readShiftSummary } from '@/server/pos/shifts';
import { canPos } from '@/server/domain/pos/permissions';
import { StudioError } from '@/server/studio/framework/result';
import { idField } from '@/server/studio/services/content';
import { catalogMenuOf } from '@/server/pos/catalog-menu';
import { loadTillCatalog } from '@/server/pos/till-catalog';
import { listPrintersIn } from '@/server/pos/printers';
import { readPosSettings } from '@/server/pos/settings';
import { listKitchenSections } from '@/server/pos/kitchen-sections';
import { listPosStaff } from '@/server/pos/staff';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { tree } from '@/server/studio/queries/content';

/** The cashier's settings and staff, read for the person's own restaurant (never one named by the input). */

const TILL = { kind: 'pos' } as const;

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
  return ctx.restaurantId;
}

export const posSettings = defineQuery({
  name: 'pos.settings',
  permission: null,
  pos: 'settings.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => readPosSettings(ctx.db, restaurantOf(ctx)),
});

/** The printers, for every role: the till prints with them, only settings managers change them. */
export const posPrinters = defineQuery({
  name: 'pos.printers',
  permission: null,
  pos: 'pin.own',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => listPrintersIn(ctx.db, restaurantOf(ctx)),
});

export const posSectionList = defineQuery({
  name: 'pos.sectionList',
  permission: null,
  pos: 'settings.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => listKitchenSections(ctx.db, restaurantOf(ctx)),
});

export const posStaff = defineQuery({
  name: 'pos.staff',
  permission: null,
  pos: 'staff.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => listPosStaff(ctx.db, restaurantOf(ctx)),
});

/** The menus a restaurant may pick its product list from, and the one it has picked. */
export const posCatalogMenu = defineQuery({
  name: 'pos.catalogMenu',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const [chosen, menus] = await Promise.all([
      catalogMenuOf(ctx.db, restaurantId),
      ctx.db.menu.findMany({
        where: { restaurantId, status: { not: 'ARCHIVED' } },
        select: { id: true, name: true, currency: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { chosenId: chosen?.id ?? null, menus };
  },
});

/** The product list as the till's catalog page edits it: the menu's categories with their products and versions, and the sections. */
export const posCatalogEditor = defineQuery({
  name: 'pos.catalogEditor',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({}),
  target: () => ({ kind: 'pos', catalog: true }) as const,
  run: async (ctx) => {
    if (ctx.menuId === null) throw new Error('A till query ran without a restaurant');
    const [catalog, sections] = await Promise.all([tree.run(ctx, { menuId: ctx.menuId }), listKitchenSections(ctx.db, restaurantOf(ctx))]);
    const restaurantId = restaurantOf(ctx);
    const [categorySettings, productSettings] = await Promise.all([
      ctx.db.posCategorySetting.findMany({ where: { restaurantId }, select: { categoryId: true, sectionId: true } }),
      ctx.db.posProductSetting.findMany({ where: { restaurantId }, select: { productId: true, sectionId: true, soldOutOverride: true, barcode: true } }),
    ]);
    return {
      menuId: ctx.menuId,
      catalog,
      sections,
      categorySections: Object.fromEntries(categorySettings.map((row) => [row.categoryId, row.sectionId])),
      productSettings: Object.fromEntries(productSettings.map((row) => [row.productId, { sectionId: row.sectionId, soldOutOverride: row.soldOutOverride, barcode: row.barcode }])),
    };
  },
});

/**
 * The Super Admin's view of the cashier across the platform: every restaurant that has a Cashier subscription or till
 * staff, with the subscription as it is now, its active staff and whether a catalog menu is chosen. Read-only; the till
 * itself belongs to the restaurant's own people.
 */
export const posOverview = defineQuery({
  name: 'pos.overview',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx) => {
    const now = new Date();
    const [subscriptions, staff, settings, aiPackages, aiUsage] = await Promise.all([
      ctx.db.subscription.findMany({
        where: { applicationId: 'cashier' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { restaurantId: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
      }),
      ctx.db.posStaff.groupBy({ by: ['restaurantId'], where: { deactivatedAt: null }, _count: { _all: true } }),
      ctx.db.posSettings.findMany({ where: { catalogMenuId: { not: null } }, select: { restaurantId: true } }),
      ctx.db.posAiPackage.findMany({ select: { restaurantId: true, enabled: true, monthlyLimit: true } }),
      ctx.db.posAiUsageMonth.findMany({ where: { month: baghdadMonthOf(now) }, select: { restaurantId: true, requests: true } }),
    ]);
    const aiOf = new Map(aiPackages.map((row) => [row.restaurantId, row]));
    const aiUsed = new Map(aiUsage.map((row) => [row.restaurantId, row.requests]));
    const newest = new Map<string, (typeof subscriptions)[number]>();
    for (const row of subscriptions) if (!newest.has(row.restaurantId)) newest.set(row.restaurantId, row);
    const staffOf = new Map(staff.map((row) => [row.restaurantId, row._count._all]));
    const chosen = new Set(settings.map((row) => row.restaurantId));
    const ids = [...new Set([...newest.keys(), ...staffOf.keys()])];
    const restaurants = await ctx.db.restaurant.findMany({
      where: { id: { in: ids }, sector: 'FOOD' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    return {
      rows: restaurants.map((restaurant) => {
        const subscription = newest.get(restaurant.id);
        return {
          id: restaurant.id,
          name: restaurant.name,
          status: subscription ? effectiveStatus(subscription, now) : ('NONE' as const),
          staff: staffOf.get(restaurant.id) ?? 0,
          catalogChosen: chosen.has(restaurant.id),
          ai: { enabled: aiOf.get(restaurant.id)?.enabled ?? false, limit: aiOf.get(restaurant.id)?.monthlyLimit ?? 0, used: aiUsed.get(restaurant.id) ?? 0 },
        };
      }),
    };
  },
});

/** The floor: areas with their tables. Every till role that takes orders reads it; changing it needs settings.manage. */
export const posFloor = defineQuery({
  name: 'pos.floor',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => readFloor(ctx.db, restaurantOf(ctx)),
});

/** One order with its lines and totals, for the order screen. */
export const posOrder = defineQuery({
  name: 'pos.order',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField }),
  target: () => TILL,
  run: async (ctx, { orderId }) => {
    const view = await readOrderView(ctx.db, restaurantOf(ctx), orderId);
    if (!view) throw new StudioError('NOT_FOUND');
    return view;
  },
});

/** What the till sells: the catalog menu as it is now, for the order screen. Null when no catalog menu is chosen. */
export const posTillCatalog = defineQuery({
  name: 'pos.tillCatalog',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => loadTillCatalog(ctx.db, restaurantOf(ctx)),
});

/** The person's own open shift (its id), or none. */
export const posMyShift = defineQuery({
  name: 'pos.myShift',
  permission: null,
  pos: 'shift.use',
  allowLapsed: true,
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    if (ctx.pos === null) throw new Error('A till query ran without a restaurant');
    const shift = await ctx.db.posShift.findFirst({ where: { restaurantId: restaurantOf(ctx), userId: ctx.pos.userId, closedAt: null }, select: { id: true, openedAt: true } });
    return { shiftId: shift?.id ?? null, openedAt: shift?.openedAt ?? null, readAt: new Date() };
  },
});

/** One shift with its sales, expenses and drawer count. A cashier reads only their own. */
export const posShift = defineQuery({
  name: 'pos.shift',
  permission: null,
  pos: 'shift.use',
  allowLapsed: true,
  input: z.object({ shiftId: idField }),
  target: () => TILL,
  run: async (ctx, { shiftId }) => {
    if (ctx.pos === null) throw new Error('A till query ran without a restaurant');
    const summary = await readShiftSummary(ctx.db, restaurantOf(ctx), shiftId);
    if (!summary) throw new StudioError('NOT_FOUND');
    if (summary.shift.userId !== ctx.pos.userId && !canPos(ctx.pos.role, 'report.view')) throw new StudioError('FORBIDDEN');
    return summary;
  },
});

/** Every shift still open, for the people who read reports. */
export const posOpenShifts = defineQuery({
  name: 'pos.openShifts',
  permission: null,
  pos: 'report.view',
  allowLapsed: true,
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => ({ shifts: await listOpenShifts(ctx.db, restaurantOf(ctx)) }),
});

/** The receipt of a paid order, from the totals frozen when it was paid. */
export const posReceipt = defineQuery({
  name: 'pos.receipt',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField, paymentId: idField.optional() }),
  target: () => TILL,
  run: async (ctx, { orderId, paymentId }) => {
    const receipt = await readReceipt(ctx.db, restaurantOf(ctx), orderId, paymentId);
    if (!receipt) throw new StudioError('NOT_FOUND');
    return receipt;
  },
});

/** The tables board: every table with its state and total, the area tabs and today's sales. */
export const posBoard = defineQuery({
  name: 'pos.board',
  permission: null,
  pos: 'order.handle',
  input: z.object({ areaId: idField.optional() }),
  target: () => TILL,
  run: (ctx, { areaId }) => readBoard(ctx.db, restaurantOf(ctx), { areaId }),
});

function kitchenActor(ctx: QueryContext) {
  if (ctx.pos === null) throw new Error('A till query ran without a restaurant');
  return { userId: ctx.pos.userId, role: ctx.pos.role };
}

/** What the kitchen screen may show this person: the kitchen switches and the section they are tied to. */
export const posKitchenScope = defineQuery({
  name: 'pos.kitchenScope',
  permission: null,
  pos: 'kitchen.view',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => readKitchenScope(ctx.db, restaurantOf(ctx), kitchenActor(ctx)),
});

/** The kitchen screen: cards of sent lines still to cook and cancellations still to be seen. */
export const posKitchenQueue = defineQuery({
  name: 'pos.kitchenQueue',
  permission: null,
  pos: 'kitchen.view',
  input: z.object({ sectionId: idField.nullable().optional() }),
  target: () => TILL,
  run: async (ctx, input) => ({ cards: await readKitchenQueue(ctx.db, restaurantOf(ctx), kitchenActor(ctx), input), readAt: new Date() }),
});

const ticketInput = z.object({ orderId: idField, batch: z.number().int().min(1).max(2_147_483_647).optional() });

/** The kitchen ticket of one round, for the kitchen. */
export const posKitchenTicket = defineQuery({
  name: 'pos.kitchenTicket',
  permission: null,
  pos: 'kitchen.view',
  input: ticketInput,
  target: () => TILL,
  run: (ctx, input) => readKitchenTicket(ctx.db, restaurantOf(ctx), kitchenActor(ctx), input),
});

/** The same ticket, for the cashier who sends or reprints it. */
export const posOrderKitchenTicket = defineQuery({
  name: 'pos.orderKitchenTicket',
  permission: null,
  pos: 'order.handle',
  input: ticketInput,
  target: () => TILL,
  run: (ctx, input) => readKitchenTicket(ctx.db, restaurantOf(ctx), kitchenActor(ctx), input),
});

/** One shift's sales, discounts, cancellations and cash count. */
export const posShiftReport = defineQuery({
  name: 'pos.shiftReport',
  permission: null,
  pos: 'report.view',
  allowLapsed: true,
  input: z.object({ shiftId: idField }),
  target: () => TILL,
  run: (ctx, { shiftId }) => readShiftReport(ctx.db, restaurantOf(ctx), shiftId),
});

/** The report of one Baghdad day: its shifts and their totals. */
export const posDailyReport = defineQuery({
  name: 'pos.dailyReport',
  permission: null,
  pos: 'report.view',
  allowLapsed: true,
  input: z.object({ day: dayField }),
  target: () => TILL,
  run: (ctx, { day }) => readDailyReport(ctx.db, restaurantOf(ctx), { day }),
});
