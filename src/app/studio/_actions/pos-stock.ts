'use server';

import * as complaints from '@/server/studio/actions/pos-complaints';
import * as inventory from '@/server/studio/actions/pos-inventory';
import { invoke } from '@/server/studio/framework/invoke';

/** Server Actions for the stock, purchase and complaint screens: each forwards to the framework, which checks the person. */

export async function createPosItem(input: unknown) {
  return invoke(inventory.createPosItem, input);
}

export async function updatePosItem(input: unknown) {
  return invoke(inventory.updatePosItem, input);
}

export async function adjustPosStock(input: unknown) {
  return invoke(inventory.adjustPosStock, input);
}

export async function recordPosWaste(input: unknown) {
  return invoke(inventory.recordPosWaste, input);
}

export async function recordPosStockCount(input: unknown) {
  return invoke(inventory.recordPosStockCount, input);
}

export async function setPosRecipe(input: unknown) {
  return invoke(inventory.setPosRecipe, input);
}

export async function createPosSupplier(input: unknown) {
  return invoke(inventory.createPosSupplier, input);
}

export async function updatePosSupplier(input: unknown) {
  return invoke(inventory.updatePosSupplier, input);
}

export async function createPosPurchase(input: unknown) {
  return invoke(inventory.createPosPurchase, input);
}

export async function voidPosPurchase(input: unknown) {
  return invoke(inventory.voidPosPurchase, input);
}

export async function setPosPurchasePaid(input: unknown) {
  return invoke(inventory.setPosPurchasePaid, input);
}

export async function setPosComplaintStatus(input: unknown) {
  return invoke(complaints.setPosComplaintStatus, input);
}

export async function addPosComplaintNote(input: unknown) {
  return invoke(complaints.addPosComplaintNote, input);
}

export async function removePosComplaintContact(input: unknown) {
  return invoke(complaints.removePosComplaintContact, input);
}
