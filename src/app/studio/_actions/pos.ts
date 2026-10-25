'use server';

import * as pos from '@/server/studio/actions/pos';
import * as delivery from '@/server/studio/actions/pos-delivery';
import * as kitchen from '@/server/studio/actions/pos-kitchen';
import * as orders from '@/server/studio/actions/pos-orders';
import * as payments from '@/server/studio/actions/pos-payments';
import * as requests from '@/server/studio/actions/pos-requests';
import * as shifts from '@/server/studio/actions/pos-shifts';
import { invoke } from '@/server/studio/framework/invoke';

export async function updatePosSettings(input: unknown) {
  return invoke(pos.updatePosSettings, input);
}

export async function createPosStaff(input: unknown) {
  return invoke(pos.createPosStaff, input);
}

export async function changePosStaffRole(input: unknown) {
  return invoke(pos.changePosStaffRole, input);
}

export async function setPosStaffActive(input: unknown) {
  return invoke(pos.setPosStaffActive, input);
}

export async function ensureCatalogMenu(input: unknown) {
  return invoke(pos.ensureCatalogMenu, input);
}

export async function chooseCatalogMenu(input: unknown) {
  return invoke(pos.chooseCatalogMenu, input);
}

export async function posCreateCategory(input: unknown) {
  return invoke(pos.posCreateCategory, input);
}

export async function posUpdateCategory(input: unknown) {
  return invoke(pos.posUpdateCategory, input);
}

export async function posDeleteCategory(input: unknown) {
  return invoke(pos.posDeleteCategory, input);
}

export async function posCreateProduct(input: unknown) {
  return invoke(pos.posCreateProduct, input);
}

export async function posSaveProductBasics(input: unknown) {
  return invoke(pos.posSaveProductBasics, input);
}

export async function posDeleteProduct(input: unknown) {
  return invoke(pos.posDeleteProduct, input);
}

export async function posSetAvailability(input: unknown) {
  return invoke(pos.posSetAvailability, input);
}

export async function createKitchenSection(input: unknown) {
  return invoke(pos.createKitchenSection, input);
}

export async function renameKitchenSection(input: unknown) {
  return invoke(pos.renameKitchenSection, input);
}

export async function deleteKitchenSection(input: unknown) {
  return invoke(pos.deleteKitchenSection, input);
}

export async function posSetCategorySection(input: unknown) {
  return invoke(pos.posSetCategorySection, input);
}

export async function posSetProductSetting(input: unknown) {
  return invoke(pos.posSetProductSetting, input);
}

export async function posImportPreview(input: unknown) {
  return invoke(pos.posImportPreview, input);
}

export async function posImportApply(input: unknown) {
  return invoke(pos.posImportApply, input);
}

export async function posImportDiscard(input: unknown) {
  return invoke(pos.posImportDiscard, input);
}

export async function createPosArea(input: unknown) {
  return invoke(pos.createPosArea, input);
}

export async function renamePosArea(input: unknown) {
  return invoke(pos.renamePosArea, input);
}

export async function deletePosArea(input: unknown) {
  return invoke(pos.deletePosArea, input);
}

export async function createPosTables(input: unknown) {
  return invoke(pos.createPosTables, input);
}

export async function deletePosTable(input: unknown) {
  return invoke(pos.deletePosTable, input);
}

export async function movePosTable(input: unknown) {
  return invoke(pos.movePosTable, input);
}

export async function openPosOrder(input: unknown) {
  return invoke(orders.openPosOrder, input);
}

export async function addPosLine(input: unknown) {
  return invoke(orders.addPosLine, input);
}

export async function updatePosLine(input: unknown) {
  return invoke(orders.updatePosLine, input);
}

export async function cancelPosLine(input: unknown) {
  return invoke(orders.cancelPosLine, input);
}

export async function setPosInvoiceDiscount(input: unknown) {
  return invoke(orders.setPosInvoiceDiscount, input);
}

export async function requestPosBill(input: unknown) {
  return invoke(orders.requestPosBill, input);
}

export async function cancelPosOrder(input: unknown) {
  return invoke(orders.cancelPosOrder, input);
}

export async function movePosOrderToTable(input: unknown) {
  return invoke(orders.movePosOrderToTable, input);
}

export async function payPosOrder(input: unknown) {
  return invoke(payments.payPosOrder, input);
}

export async function openPosShift(input: unknown) {
  return invoke(shifts.openPosShift, input);
}

export async function addPosExpense(input: unknown) {
  return invoke(shifts.addPosExpense, input);
}

export async function closePosShift(input: unknown) {
  return invoke(shifts.closePosShift, input);
}

export async function sendPosToKitchen(input: unknown) {
  return invoke(kitchen.sendPosToKitchen, input);
}

export async function markPosLinesReady(input: unknown) {
  return invoke(kitchen.markPosLinesReady, input);
}

export async function acknowledgePosCancellations(input: unknown) {
  return invoke(kitchen.acknowledgePosCancellations, input);
}

export async function acceptPosRequest(input: unknown) {
  return invoke(requests.acceptPosRequest, input);
}

export async function rejectPosRequest(input: unknown) {
  return invoke(requests.rejectPosRequest, input);
}

export async function setPosRequestLineQuantity(input: unknown) {
  return invoke(requests.setPosRequestLineQuantity, input);
}

export async function removePosRequestLine(input: unknown) {
  return invoke(requests.removePosRequestLine, input);
}

export async function ensurePosMenuTables(input: unknown) {
  return invoke(requests.ensurePosMenuTables, input);
}

export async function createPosZone(input: unknown) {
  return invoke(delivery.createPosZone, input);
}

export async function updatePosZone(input: unknown) {
  return invoke(delivery.updatePosZone, input);
}

export async function deletePosZone(input: unknown) {
  return invoke(delivery.deletePosZone, input);
}

export async function createPosDriver(input: unknown) {
  return invoke(delivery.createPosDriver, input);
}

export async function updatePosDriver(input: unknown) {
  return invoke(delivery.updatePosDriver, input);
}

export async function openPosOffPremiseOrder(input: unknown) {
  return invoke(delivery.openPosOffPremiseOrder, input);
}


export async function updatePosOffPremiseDetails(input: unknown) {
  return invoke(delivery.updatePosOffPremiseDetails, input);
}

export async function advancePosFulfillment(input: unknown) {
  return invoke(delivery.advancePosFulfillment, input);
}

export async function assignPosDriver(input: unknown) {
  return invoke(delivery.assignPosDriver, input);
}
