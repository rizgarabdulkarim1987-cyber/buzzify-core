'use server';

import * as pos from '@/server/studio/actions/pos';
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
