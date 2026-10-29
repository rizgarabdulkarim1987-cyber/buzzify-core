import { z } from 'zod';
import { guardedAi } from '@/server/ai/ai-error-code';
import { menuImportInput } from '@/server/ai/menu-import';
import { bringAiPhotos, previewAiMenuImport, translateAiMenu } from '@/server/studio/services/imports-ai';
import { printerAddressAllowed } from '@/server/domain/pos/bridge-protocol';
import { POS_ROLES } from '@/server/domain/pos/permissions';
import { saveProductBasics } from '@/server/pos/catalog-edit';
import { publishAfter } from '@/server/pos/catalog-publish';
import { previewPosImport } from '@/server/pos/menu-import';
import { createAreaIn, createTablesIn, deleteAreaIn, deleteTableIn, MAX_TABLES_PER_CALL, moveTableIn, renameAreaIn } from '@/server/pos/floor';
import { addKitchenSection, removeKitchenSection, renameKitchenSectionIn } from '@/server/pos/kitchen-sections';
import { isUniqueViolation, refuse } from '@/server/pos/errors';
import { removePrinterIn, savePrinterIn } from '@/server/pos/printers';
import { chooseCatalogMenu as choose, ensureCatalogMenu as ensure } from '@/server/pos/catalog-menu';
import { POS_PAYMENT_METHODS, savePosSettings, settingsChanges } from '@/server/pos/settings';
import { releaseHeldRequestsIn } from '@/server/pos/customer-orders';
import { delegates } from '@/server/data/tenant-db';
import {
  changePosStaffRole as changeRole,
  deactivateIn,
  mayAssign,
  reactivateIn,
  refuseRole,
  staffRowRole,
} from '@/server/pos/staff';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { setProductAvailability } from '@/server/studio/services/availability';
import { applyImport, discardImport, IMPORT_MAX_BYTES, sheetFileNameField } from '@/server/studio/services/imports';
import * as content from '@/server/studio/services/content';
import { contentSlugField, idField, namesField, priceField } from '@/server/studio/services/content';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The cashier's own settings and staff, behind the same framework as the Studio: a till permission instead of a Studio
 * one, and the restaurant is the person's own (their staff row or OWNER membership), never read from the input.
 */

const TILL = { kind: 'pos' } as const;
/** The same, confined to the restaurant's product-list menu and holding the Studio's content permissions there. */
const CATALOG = { kind: 'pos', catalog: true } as const;
const version = z.number().int().min(1);
const sectionName = z.string().trim().min(1, 'Enter a name').max(60, 'Use at most 60 characters');

const percent = z.number().int().min(0).max(100);

/** The restaurant and person the framework has resolved for a till action. */
function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const updatePosSettings = defineAction({
  name: 'pos.updateSettings',
  permission: null,
  pos: 'settings.manage',
  input: z.object({
    serviceRatePercent: percent,
    taxRatePercent: percent,
    enabledPaymentMethods: z.array(z.enum(POS_PAYMENT_METHODS)).min(1).max(POS_PAYMENT_METHODS.length),
    tableRingMinutes: z.number().int().min(1).max(1440),
    kitchenPrintEnabled: z.boolean(),
    kitchenScreenEnabled: z.boolean(),
    qrOrderingEnabled: z.boolean(),
    takeawayEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    complaintsEnabled: z.boolean(),
    // 0 switches the idle sign-out off.
    idleMinutes: z.number().int().min(0).max(240),
    requireApproval: z.boolean(),
    captainApproval: z.boolean().default(false),
    // The payable total rounds to a multiple of this many dinars; 0 switches rounding off.
    roundingStep: z.union([z.literal(0), z.literal(250), z.literal(500), z.literal(1000)]).default(0),
    usdEnabled: z.boolean().default(false),
    usdRate: z.number().int().min(0).max(100_000).default(0),
    invoiceName: z.string().trim().max(120, 'Use at most 120 characters').default(''),
    invoiceAddress: z.string().trim().max(120, 'Use at most 120 characters').default(''),
    invoicePhone: z.string().trim().max(120, 'Use at most 120 characters').default(''),
    invoiceTaxNumber: z.string().trim().max(120, 'Use at most 120 characters').default(''),
    invoiceFooter: z.string().trim().max(120, 'Use at most 120 characters').default(''),
    version: z.number().int().min(0),
  }).refine((input) => !input.usdEnabled || input.usdRate > 0, { message: 'Enter the dollar rate', path: ['usdRate'] }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const { id, before, after } = await savePosSettings(tx, restaurantId, input);
      ctx.audit({ action: 'pos.settings.update', entityType: 'PosSettings', entityId: id, changes: settingsChanges(before, after) });
      // Switching captain approval off releases the orders still held for the captain.
      if (before.captainApproval && !after.captainApproval) {
        const released = await releaseHeldRequestsIn(delegates(tx), restaurantId);
        if (released > 0) ctx.audit({ action: 'pos.request.release', entityType: 'PosSettings', entityId: id, changes: { released: { before: null, after: released } } });
      }
      return { version: after.version };
    });
  },
});

export const changePosStaffRole = defineAction({
  name: 'pos.changeStaffRole',
  permission: null,
  pos: 'staff.manage',
  input: z.object({ staffId: z.string().min(1).max(100), role: z.enum(POS_ROLES) }),
  target: () => TILL,
  run: (ctx, { staffId, role }) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      if (!mayAssign(pos.role, role, await staffRowRole(tx, staffId))) throw refuseRole();
      const result = await changeRole(tx, { restaurantId, actingUserId: pos.userId, staffId, role });
      ctx.audit({ action: 'pos.staff.role', entityType: 'PosStaff', entityId: result.id, changes: { role: { before: result.before, after: result.after } } });
      return { staffId: result.id };
    });
  },
});

export const setPosStaffActive = defineAction({
  name: 'pos.setStaffActive',
  permission: null,
  pos: 'staff.manage',
  input: z.object({ staffId: z.string().min(1).max(100), active: z.boolean() }),
  target: () => TILL,
  run: (ctx, { staffId, active }) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const current = await staffRowRole(tx, staffId);
      if (!mayAssign(pos.role, current, current)) throw refuseRole();
      const args = { restaurantId, actingUserId: pos.userId, staffId };
      const result = active ? await reactivateIn(tx, args) : await deactivateIn(tx, args);
      ctx.audit({
        action: active ? 'pos.staff.reactivate' : 'pos.staff.deactivate',
        entityType: 'PosStaff',
        entityId: result.id,
        changes: { active: { before: !active, after: active } },
      });
      return { staffId: result.id };
    });
  },
});

export const ensureCatalogMenu = defineAction({
  name: 'pos.ensureCatalogMenu',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => ensure(ctx),
});

export const chooseCatalogMenu = defineAction({
  name: 'pos.chooseCatalogMenu',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ menuId: z.string().min(1).max(100) }),
  target: () => TILL,
  run: (ctx, { menuId }) => choose(ctx, menuId),
});

// The product list, edited by the Studio's own content services -------------------------------------------------------

export const posCreateCategory = defineAction({
  name: 'pos.createCategory',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ names: namesField, slug: contentSlugField.optional() }),
  target: () => CATALOG,
  run: (ctx, { names, slug }) => publishAfter(ctx, () => content.createCategory(ctx, { names, slug })),
});

export const posUpdateCategory = defineAction({
  name: 'pos.updateCategory',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ categoryId: idField, version, names: namesField, slug: contentSlugField, isActive: z.boolean() }),
  target: () => CATALOG,
  run: (ctx, input) => publishAfter(ctx, () => content.updateCategory(ctx, input)),
});

export const posDeleteCategory = defineAction({
  name: 'pos.deleteCategory',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ categoryId: idField, version }),
  target: () => CATALOG,
  run: (ctx, input) => publishAfter(ctx, () => content.deleteCategory(ctx, input)),
});

export const posCreateProduct = defineAction({
  name: 'pos.createProduct',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ categoryId: idField, names: namesField, price: priceField }),
  target: () => CATALOG,
  run: (ctx, input) => publishAfter(ctx, () => content.createProduct(ctx, input)),
});

export const posSaveProductBasics = defineAction({
  name: 'pos.saveProductBasics',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ productId: idField, version, names: namesField, price: priceField, categoryId: idField }),
  target: () => CATALOG,
  run: (ctx, input) => publishAfter(ctx, () => saveProductBasics(ctx, input)),
});

export const posDeleteProduct = defineAction({
  name: 'pos.deleteProduct',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ productId: idField, version }),
  target: () => CATALOG,
  run: (ctx, input) => publishAfter(ctx, () => content.deleteProduct(ctx, input)),
});

export const posSetAvailability = defineAction({
  name: 'pos.setAvailability',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ productId: idField, isAvailable: z.boolean().optional(), isHidden: z.boolean().optional() }),
  target: () => CATALOG,
  run: (ctx, input) => setProductAvailability(ctx, input),
});

// Kitchen sections and the till's own settings on categories and products ---------------------------------------------

export const createKitchenSection = defineAction({
  name: 'pos.createKitchenSection',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ name: sectionName }),
  target: () => TILL,
  run: (ctx, { name }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const { id } = await addKitchenSection(tx, restaurantId, name);
      ctx.audit({ action: 'pos.section.create', entityType: 'PosKitchenSection', entityId: id, changes: { name: { before: null, after: name } } });
      return { sectionId: id };
    });
  },
});

export const renameKitchenSection = defineAction({
  name: 'pos.renameKitchenSection',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ sectionId: idField, name: sectionName }),
  target: () => TILL,
  run: (ctx, { sectionId, name }) =>
    ctx.transaction(async (tx) => {
      const { id, before } = await renameKitchenSectionIn(tx, sectionId, name);
      if (before !== name) ctx.audit({ action: 'pos.section.rename', entityType: 'PosKitchenSection', entityId: id, changes: { name: { before, after: name } } });
      return { sectionId: id };
    }),
});

export const deleteKitchenSection = defineAction({
  name: 'pos.deleteKitchenSection',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ sectionId: idField }),
  target: () => TILL,
  run: (ctx, { sectionId }) =>
    ctx.transaction(async (tx) => {
      const row = await removeKitchenSection(tx, sectionId);
      ctx.audit({ action: 'pos.section.delete', entityType: 'PosKitchenSection', entityId: row.id, changes: { name: { before: row.name, after: null } } });
      return { deleted: true as const };
    }),
});

// Printers -------------------------------------------------------------------------------------------------------------

export const savePosPrinter = defineAction({
  name: 'pos.savePrinter',
  permission: null,
  pos: 'settings.manage',
  input: z
    .object({
      printerId: idField.optional(),
      name: sectionName,
      role: z.enum(['RECEIPT', 'KITCHEN']),
      transport: z.enum(['NETWORK', 'FILE']),
      address: z.string().trim().max(200, 'Use at most 200 characters'),
      paperWidth: z.union([z.literal(58), z.literal(80)]),
      cut: z.boolean(),
      drawerPin: z.union([z.literal(2), z.literal(5)]).nullable(),
      isDefault: z.boolean(),
      sectionId: idField.nullable(),
    })
    .refine((input) => printerAddressAllowed(input.transport, input.address), { message: 'Enter the printer address', path: ['address'] }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx
      .transaction(async (tx) => {
        const { id, created } = await savePrinterIn(tx, restaurantId, input);
        ctx.audit({ action: created ? 'pos.printer.create' : 'pos.printer.update', entityType: 'PosPrinter', entityId: id, changes: { name: { before: null, after: input.name } } });
        return { printerId: id };
      })
      .catch((error: unknown) => {
        // Two saves that both make a receipt printer the default: the partial unique index lets one win.
        throw isUniqueViolation(error) ? refuse('CONFLICT', 'Another printer was just made the default. Try again') : error;
      });
  },
});

export const removePosPrinter = defineAction({
  name: 'pos.removePrinter',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ printerId: idField }),
  target: () => TILL,
  run: (ctx, { printerId }) =>
    ctx.transaction(async (tx) => {
      const row = await removePrinterIn(tx, printerId);
      ctx.audit({ action: 'pos.printer.delete', entityType: 'PosPrinter', entityId: row.id, changes: { name: { before: row.name, after: null } } });
      return { deleted: true as const };
    }),
});

/** Opening the drawer with no sale is allowed with a reason, and always leaves a trace. */
export const openPosDrawer = defineAction({
  name: 'pos.openDrawer',
  permission: null,
  pos: 'shift.use',
  input: z.object({ reason: z.string().trim().min(1, 'Enter a reason').max(200, 'Use at most 200 characters') }),
  target: () => TILL,
  run: (ctx, { reason }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async () => {
      ctx.audit({ action: 'pos.drawer.open', entityType: 'PosDrawer', entityId: restaurantId, changes: { reason: { before: null, after: reason } } });
      return { opened: true as const };
    });
  },
});

/** A receipt printed again is not a new sale; it is recorded so a copy can be told from the original. */
export const logPosReprint = defineAction({
  name: 'pos.logReprint',
  permission: null,
  pos: 'order.handle',
  input: z.object({ paymentId: idField }),
  target: () => TILL,
  run: (ctx, { paymentId }) =>
    ctx.transaction(async (tx) => {
      const payment = await tx.posPayment.findFirst({ where: { id: paymentId }, select: { id: true } });
      if (!payment) throw new StudioError('NOT_FOUND');
      ctx.audit({ action: 'pos.receipt.reprint', entityType: 'PosPayment', entityId: payment.id, changes: {} });
      return { logged: true as const };
    }),
});

/** A copy printed while the till was offline, recorded when it syncs: the order's payment, found by the order. */
export const logPosOrderReprint = defineAction({
  name: 'pos.logOrderReprint',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField }),
  target: () => TILL,
  run: (ctx, { orderId }) =>
    ctx.transaction(async (tx) => {
      const payment = await tx.posPayment.findFirst({ where: { orderId }, orderBy: { paidAt: 'desc' }, select: { id: true } });
      if (!payment) throw new StudioError('NOT_FOUND');
      ctx.audit({ action: 'pos.receipt.reprint', entityType: 'PosPayment', entityId: payment.id, changes: {} });
      return { logged: true as const };
    }),
});

/** Which kitchen section a category belongs to (null: none). The category and the section must both be this restaurant's. */
export const posSetCategorySection = defineAction({
  name: 'pos.setCategorySection',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ categoryId: idField, sectionId: idField.nullable() }),
  target: () => CATALOG,
  run: (ctx, { categoryId, sectionId }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      if (!(await tx.category.findFirst({ where: { id: categoryId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      if (sectionId !== null && !(await tx.posKitchenSection.findFirst({ where: { id: sectionId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      const row = await tx.posCategorySetting.findFirst({ where: { categoryId }, select: { id: true, sectionId: true } });
      if (row) await tx.posCategorySetting.updateMany({ where: { id: row.id }, data: { sectionId } });
      else await tx.posCategorySetting.create({ data: { categoryId, restaurantId, sectionId } });
      const before = row?.sectionId ?? null;
      if (before !== sectionId) ctx.audit({ action: 'pos.category.section', entityType: 'PosCategorySetting', entityId: categoryId, changes: { sectionId: { before, after: sectionId } } });
      return { categoryId };
    });
  },
});

/** A product's own kitchen section (null: its category's) and the till-only sold-out switch. */
export const posSetProductSetting = defineAction({
  name: 'pos.setProductSetting',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ productId: idField, sectionId: idField.nullable(), soldOutOverride: z.boolean() }),
  target: () => CATALOG,
  run: (ctx, { productId, sectionId, soldOutOverride }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      if (!(await tx.product.findFirst({ where: { id: productId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      if (sectionId !== null && !(await tx.posKitchenSection.findFirst({ where: { id: sectionId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      const row = await tx.posProductSetting.findFirst({ where: { productId }, select: { id: true, sectionId: true, soldOutOverride: true } });
      if (row) await tx.posProductSetting.updateMany({ where: { id: row.id }, data: { sectionId, soldOutOverride } });
      else await tx.posProductSetting.create({ data: { productId, restaurantId, sectionId, soldOutOverride } });
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if ((row?.sectionId ?? null) !== sectionId) changes.sectionId = { before: row?.sectionId ?? null, after: sectionId };
      if ((row?.soldOutOverride ?? false) !== soldOutOverride) changes.soldOutOverride = { before: row?.soldOutOverride ?? false, after: soldOutOverride };
      if (Object.keys(changes).length > 0) ctx.audit({ action: 'pos.product.setting', entityType: 'PosProductSetting', entityId: productId, changes });
      return { productId };
    });
  },
});

/** The code a scanner reads for a product (empty clears it). One product per code in a restaurant. */
export const posSetProductBarcode = defineAction({
  name: 'pos.setProductBarcode',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ productId: idField, barcode: z.string().trim().max(120, 'Use at most 120 characters') }),
  target: () => CATALOG,
  run: (ctx, { productId, barcode: typed }) => {
    const { restaurantId } = till(ctx);
    const barcode = typed === '' ? null : typed;
    const attempt = () =>
      ctx.transaction(async (tx) => {
        if (!(await tx.product.findFirst({ where: { id: productId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
        if (barcode !== null && (await tx.posProductSetting.findFirst({ where: { barcode, productId: { not: productId } }, select: { id: true } }))) throw refuse('CONFLICT', 'This barcode belongs to another product');
        const row = await tx.posProductSetting.findFirst({ where: { productId }, select: { id: true, barcode: true } });
        if (row) await tx.posProductSetting.updateMany({ where: { id: row.id }, data: { barcode } });
        else await tx.posProductSetting.create({ data: { productId, restaurantId, barcode } });
        if ((row?.barcode ?? null) !== barcode) ctx.audit({ action: 'pos.product.barcode', entityType: 'PosProductSetting', entityId: productId, changes: { barcode: { before: row?.barcode ?? null, after: barcode } } });
        return { productId };
      });
    // A unique violation means a save raced this one: either for the same product (its row now exists) or for the same code
    // (another product now holds it). One more attempt tells them apart with the ordinary checks, so the message is always the true one.
    return attempt()
      .catch((error: unknown) => (isUniqueViolation(error) ? attempt() : Promise.reject(error)))
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? refuse('CONFLICT', 'This barcode belongs to another product') : error;
      });
  },
});

// Importing the cashier's old product list ----------------------------------------------------------------------------

export const posImportPreview = defineAction({
  name: 'pos.importPreview',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ fileName: sheetFileNameField, csv: z.string().min(1).max(IMPORT_MAX_BYTES) }),
  target: () => CATALOG,
  run: (ctx, input) => previewPosImport(ctx, input),
});

/** The same reading as the Studio's, for the product list: a photo, a PDF or a link into the usual preview. */
export const posImportAiPreview = defineAction({
  name: 'pos.importAiPreview',
  permission: null,
  pos: 'catalog.manage',
  input: menuImportInput,
  target: () => CATALOG,
  run: (ctx, input) => guardedAi(() => previewAiMenuImport(ctx, input)),
});

/** The Studio's picture step, for the product list. */
export const posImportAiPhotos = defineAction({
  name: 'pos.importAiPhotos',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ importJobId: idField }),
  target: () => CATALOG,
  run: (ctx, input) => bringAiPhotos(ctx, input),
});

/** The Studio's translation step, for the product list. */
export const posImportAiTranslate = defineAction({
  name: 'pos.importAiTranslate',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ importJobId: idField }),
  target: () => CATALOG,
  run: (ctx, input) => guardedAi(() => translateAiMenu(ctx, input), { refuseAsError: true }),
});

export const posImportApply = defineAction({
  name: 'pos.importApply',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ importJobId: idField }),
  target: () => CATALOG,
  run: (ctx, input) => publishAfter(ctx, () => applyImport(ctx, input)),
});

export const posImportDiscard = defineAction({
  name: 'pos.importDiscard',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ importJobId: idField }),
  target: () => CATALOG,
  run: async (ctx, input) => {
    await discardImport(ctx, input);
    return { discarded: true as const };
  },
});

// The floor: areas and tables ------------------------------------------------------------------------------------------

const areaName = z.string().trim().min(1, 'Enter a name').max(60, 'Use at most 60 characters');
const tableNumber = z.number().int().min(1).max(100_000);

export const createPosArea = defineAction({
  name: 'pos.createArea',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ name: areaName }),
  target: () => TILL,
  run: (ctx, { name }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const { id } = await createAreaIn(tx, restaurantId, name);
      ctx.audit({ action: 'pos.area.create', entityType: 'PosArea', entityId: id, changes: { name: { before: null, after: name } } });
      return { areaId: id };
    });
  },
});

export const renamePosArea = defineAction({
  name: 'pos.renameArea',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ areaId: idField, name: areaName }),
  target: () => TILL,
  run: (ctx, { areaId, name }) =>
    ctx.transaction(async (tx) => {
      const { id, before } = await renameAreaIn(tx, areaId, name);
      if (before !== name) ctx.audit({ action: 'pos.area.rename', entityType: 'PosArea', entityId: id, changes: { name: { before, after: name } } });
      return { areaId: id };
    }),
});

export const deletePosArea = defineAction({
  name: 'pos.deleteArea',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ areaId: idField }),
  target: () => TILL,
  run: (ctx, { areaId }) =>
    ctx.transaction(async (tx) => {
      const area = await deleteAreaIn(tx, areaId);
      ctx.audit({ action: 'pos.area.delete', entityType: 'PosArea', entityId: area.id, changes: { name: { before: area.name, after: null }, tables: { before: area.tables, after: 0 } } });
      return { deleted: true as const };
    }),
});

export const createPosTables = defineAction({
  name: 'pos.createTables',
  permission: null,
  pos: 'settings.manage',
  input: z
    .object({ areaId: idField, from: tableNumber, to: tableNumber })
    .refine((v) => v.from <= v.to, { message: 'The first number must not exceed the last', path: ['to'] })
    .refine((v) => v.to - v.from + 1 <= MAX_TABLES_PER_CALL, { message: 'Create at most 200 tables at a time', path: ['to'] }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const { count } = await createTablesIn(tx, restaurantId, input);
      ctx.audit({ action: 'pos.tables.create', entityType: 'PosArea', entityId: input.areaId, changes: { from: { before: null, after: input.from }, to: { before: null, after: input.to } } });
      return { count };
    });
  },
});

export const deletePosTable = defineAction({
  name: 'pos.deleteTable',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ tableId: idField }),
  target: () => TILL,
  run: (ctx, { tableId }) =>
    ctx.transaction(async (tx) => {
      const table = await deleteTableIn(tx, tableId);
      ctx.audit({ action: 'pos.table.delete', entityType: 'PosTable', entityId: table.id, changes: { number: { before: table.number, after: null } } });
      return { deleted: true as const };
    }),
});

export const movePosTable = defineAction({
  name: 'pos.moveTable',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ tableId: idField, areaId: idField }),
  target: () => TILL,
  run: (ctx, { tableId, areaId }) =>
    ctx.transaction(async (tx) => {
      const { id, from } = await moveTableIn(tx, tableId, areaId);
      if (from !== areaId) ctx.audit({ action: 'pos.table.move', entityType: 'PosTable', entityId: id, changes: { areaId: { before: from, after: areaId } } });
      return { tableId: id };
    }),
});

