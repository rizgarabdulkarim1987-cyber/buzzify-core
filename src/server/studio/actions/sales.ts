import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';
import * as sales from '@/server/studio/services/sales';
import { offerFields, pairingFields, sameOfferRef, sameRef, sameSetRef, setFields, settingsFields, upgradeFields, versionField } from '@/server/studio/services/sales';

/**
 * The Sales tab's changes to a menu's draft (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.4). All need
 * `content.edit`. Upgrades and pairings need smart selling in the restaurant's plan.
 */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

// Upgrades ------------------------------------------------------------------------------------------------------------

export const saveUpgrade = defineAction({
  name: 'sales.saveUpgrade',
  permission: 'content.edit',
  feature: 'selling.smart',
  input: z.object({ menuId: idField, ...upgradeFields }).refine(sameRef),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.saveUpgrade(ctx, input),
});

export const deleteUpgrade = defineAction({
  name: 'sales.deleteUpgrade',
  permission: 'content.edit',
  feature: 'selling.smart',
  input: z.object({ menuId: idField, ruleId: idField, version: versionField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.deleteUpgrade(ctx, input),
});

// Pairings ------------------------------------------------------------------------------------------------------------

export const savePairing = defineAction({
  name: 'sales.savePairing',
  permission: 'content.edit',
  feature: 'selling.smart',
  input: z.object({ menuId: idField, ...pairingFields }).refine(sameRef),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.savePairing(ctx, input),
});

export const deletePairing = defineAction({
  name: 'sales.deletePairing',
  permission: 'content.edit',
  feature: 'selling.smart',
  input: z.object({ menuId: idField, ruleId: idField, version: versionField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.deletePairing(ctx, input),
});

// Sets ----------------------------------------------------------------------------------------------------------------

/** A new set, or a set's price changed, also needs `content.prices`, which the service checks. */
export const saveSet = defineAction({
  name: 'sales.saveSet',
  permission: 'content.edit',
  feature: 'selling.smart',
  input: z.object({ menuId: idField, ...setFields }).refine(sameSetRef),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.saveSet(ctx, input),
});

export const deleteSet = defineAction({
  name: 'sales.deleteSet',
  permission: 'content.edit',
  feature: 'selling.smart',
  input: z.object({ menuId: idField, bundleId: idField, version: versionField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.deleteSet(ctx, input),
});

// Offers --------------------------------------------------------------------------------------------------------------

/** A discount, or a change to one, also needs `content.prices`, which the service checks. */
export const saveOffer = defineAction({
  name: 'sales.saveOffer',
  permission: 'content.edit',
  feature: 'selling.offers',
  input: z.object({ menuId: idField, ...offerFields }).refine(sameOfferRef),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.saveOffer(ctx, input),
});

export const deleteOffer = defineAction({
  name: 'sales.deleteOffer',
  permission: 'content.edit',
  feature: 'selling.offers',
  input: z.object({ menuId: idField, offerId: idField, version: versionField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.deleteOffer(ctx, input),
});

// Settings ------------------------------------------------------------------------------------------------------------

/** The labels and limits apply only as far as the plan includes them; saving them is open to every plan. */
export const saveSettings = defineAction({
  name: 'sales.saveSettings',
  permission: 'content.edit',
  input: z.object({ menuId: idField, ...settingsFields }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.saveSalesSettings(ctx, input),
});

export const reorderOffers = defineAction({
  name: 'sales.reorderOffers',
  permission: 'content.edit',
  feature: 'selling.offers',
  input: z.object({ menuId: idField, order: z.array(idField).max(200) }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => sales.reorderOffers(ctx, input),
});
