import { defineAction } from '@/server/studio/framework/action';
import * as billing from '@/server/studio/services/billing';

/**
 * Billing writes (docs/superpowers/plans/2026-10-22-business-core-in-menu.md, Task 3). Only the platform owner holds
 * `plans.manage`, so only they set the products and their prices, start trials, change plans, cancel, reactivate and
 * record the payments they have received. The target is the platform, so anyone else is refused before any restaurant is
 * looked at; a restaurant's own rows are written on a client scoped to it (`transactionIn`), which files the audit rows
 * under it and finds none of another restaurant's subscriptions or payments.
 */

const PLATFORM = { kind: 'platform' } as const;

export const setApplication = defineAction({
  name: 'billing.setApplication',
  permission: 'plans.manage',
  input: billing.applicationInput,
  target: () => PLATFORM,
  run: (ctx, input) => ctx.transaction((tx) => billing.setApplication(tx, ctx, input)),
});

export const setPrices = defineAction({
  name: 'billing.setPrices',
  permission: 'plans.manage',
  input: billing.pricesInput,
  target: () => PLATFORM,
  run: (ctx, input) => ctx.transaction((tx) => billing.setPrices(tx, ctx, input)),
});

export const startTrial = defineAction({
  name: 'billing.startTrial',
  permission: 'plans.manage',
  input: billing.trialInput,
  target: () => PLATFORM,
  run: (ctx, input) => ctx.transactionIn({ restaurantId: input.restaurantId }, (tx) => billing.startTrial(tx, ctx, input, new Date())),
});

export const changePlan = defineAction({
  name: 'billing.changePlan',
  permission: 'plans.manage',
  input: billing.changePlanInput,
  target: () => PLATFORM,
  run: (ctx, input) => ctx.transactionIn({ restaurantId: input.restaurantId }, (tx) => billing.changePlan(tx, ctx, input, new Date())),
});

export const cancel = defineAction({
  name: 'billing.cancel',
  permission: 'plans.manage',
  input: billing.cancelInput,
  target: () => PLATFORM,
  run: (ctx, input) => ctx.transactionIn({ restaurantId: input.restaurantId }, (tx) => billing.cancel(tx, ctx, input, new Date())),
});

export const reactivate = defineAction({
  name: 'billing.reactivate',
  permission: 'plans.manage',
  input: billing.reactivateInput,
  target: () => PLATFORM,
  run: (ctx, input) => ctx.transactionIn({ restaurantId: input.restaurantId }, (tx) => billing.reactivate(tx, ctx, input, new Date())),
});

export const recordPayment = defineAction({
  name: 'billing.recordPayment',
  permission: 'plans.manage',
  input: billing.paymentInput,
  target: () => PLATFORM,
  run: (ctx, input) => ctx.transactionIn({ restaurantId: input.restaurantId }, (tx) => billing.recordPayment(tx, ctx, input, new Date())),
});
