import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';
import * as sales from '@/server/studio/services/sales';
import { pairingFields, sameRef, upgradeFields, versionField } from '@/server/studio/services/sales';

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
