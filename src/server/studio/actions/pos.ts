import { z } from 'zod';
import { POS_ROLES } from '@/server/domain/pos/permissions';
import { saveProductBasics } from '@/server/pos/catalog-edit';
import { previewPosImport } from '@/server/pos/menu-import';
import { addKitchenSection, removeKitchenSection, renameKitchenSectionIn } from '@/server/pos/kitchen-sections';
import { chooseCatalogMenu as choose, ensureCatalogMenu as ensure } from '@/server/pos/catalog-menu';
import { POS_PAYMENT_METHODS, savePosSettings, settingsChanges } from '@/server/pos/settings';
import {
  addPosStaff,
  changePosStaffRole as changeRole,
  deactivateIn,
  mayAssign,
  reactivateIn,
  refuseRole,
  staffRowRole,
} from '@/server/pos/staff';
import { emailField } from '@/server/studio/auth/fields';
import { passwordProblemMessage } from '@/server/studio/auth/password-policy';
import { createPasswordUser, EmailTakenError, PasswordPolicyError } from '@/server/studio/auth/users';
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
    version: z.number().int().min(0),
  }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const { id, before, after } = await savePosSettings(tx, restaurantId, input);
      ctx.audit({ action: 'pos.settings.update', entityType: 'PosSettings', entityId: id, changes: settingsChanges(before, after) });
      return { version: after.version };
    });
  },
});

export const createPosStaff = defineAction({
  name: 'pos.createStaff',
  permission: null,
  pos: 'staff.manage',
  input: z.object({
    name: z.string().trim().min(1, 'Enter your name').max(120, 'Use at most 120 characters'),
    email: emailField,
    role: z.enum(POS_ROLES),
    // The new person's first password; a till account is always created here, never an existing one attached.
    password: z.string().max(1024, 'Use at most 128 characters').optional(),
  }),
  target: () => TILL,
  run: async (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    if (!mayAssign(pos.role, input.role, null)) throw refuseRole();

    // An existing account is never attached here: that would bind a stranger to this till without their consent and
    // tell the caller which emails have accounts. Without a password it answers exactly like an unknown email.
    if (!input.password) throw new StudioError('INVALID', undefined, { password: 'Choose a password' });
    let userId: string;
    try {
      ({ userId } = await createPasswordUser(ctx.db, {
        email: input.email,
        name: input.name,
        password: input.password,
        locale: ctx.actor.locale,
      }));
    } catch (error) {
      if (error instanceof PasswordPolicyError) throw new StudioError('INVALID', undefined, { password: passwordProblemMessage(error.reason) });
      if (error instanceof EmailTakenError) throw new StudioError('CONFLICT', 'An account with this email already exists');
      throw error;
    }

    try {
      return await ctx.transaction(async (tx) => {
        const { id } = await addPosStaff(tx, { restaurantId, userId, role: input.role });
        ctx.audit({
          action: 'pos.staff.create',
          entityType: 'PosStaff',
          entityId: id,
          changes: { role: { before: null, after: input.role }, email: { before: null, after: input.email } },
        });
        return { staffId: id };
      });
    } catch (error) {
      // The account was made a moment ago for this staff row; without the row it would be an orphan nobody recorded.
      await ctx.db.user.delete({ where: { id: userId } }).catch(() => undefined);
      throw error;
    }
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
  run: (ctx, { names, slug }) => content.createCategory(ctx, { names, slug }),
});

export const posUpdateCategory = defineAction({
  name: 'pos.updateCategory',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ categoryId: idField, version, names: namesField, slug: contentSlugField, isActive: z.boolean() }),
  target: () => CATALOG,
  run: (ctx, input) => content.updateCategory(ctx, input),
});

export const posDeleteCategory = defineAction({
  name: 'pos.deleteCategory',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ categoryId: idField, version }),
  target: () => CATALOG,
  run: (ctx, input) => content.deleteCategory(ctx, input),
});

export const posCreateProduct = defineAction({
  name: 'pos.createProduct',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ categoryId: idField, names: namesField, price: priceField }),
  target: () => CATALOG,
  run: (ctx, input) => content.createProduct(ctx, input),
});

export const posSaveProductBasics = defineAction({
  name: 'pos.saveProductBasics',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ productId: idField, version, names: namesField, price: priceField, categoryId: idField }),
  target: () => CATALOG,
  run: (ctx, input) => saveProductBasics(ctx, input),
});

export const posDeleteProduct = defineAction({
  name: 'pos.deleteProduct',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ productId: idField, version }),
  target: () => CATALOG,
  run: (ctx, input) => content.deleteProduct(ctx, input),
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

// Importing the cashier's old product list ----------------------------------------------------------------------------

export const posImportPreview = defineAction({
  name: 'pos.importPreview',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ fileName: sheetFileNameField, csv: z.string().min(1).max(IMPORT_MAX_BYTES) }),
  target: () => CATALOG,
  run: (ctx, input) => previewPosImport(ctx, input),
});

export const posImportApply = defineAction({
  name: 'pos.importApply',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ importJobId: idField }),
  target: () => CATALOG,
  run: (ctx, input) => applyImport(ctx, input),
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
