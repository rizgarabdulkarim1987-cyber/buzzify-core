'use server';

import * as menus from '@/server/studio/actions/menus';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as menuQueries from '@/server/studio/queries/menus';

export async function createMenu(input: unknown) {
  return invoke(menus.createMenu, input);
}

export async function publish(input: unknown) {
  return invoke(menus.publish, input);
}

export async function changeMenuStatus(input: unknown) {
  return invoke(menus.changeMenuStatus, input);
}

export async function changeMenuSlug(input: unknown) {
  return invoke(menus.changeMenuSlug, input);
}

export async function duplicateMenu(input: unknown) {
  return invoke(menus.duplicateMenu, input);
}

export async function deleteMenu(input: unknown) {
  return invoke(menus.deleteMenu, input);
}

export async function bulkMenuAction(input: unknown) {
  return invoke(menus.bulkMenuAction, input);
}

export async function bulkDeleteMenus(input: unknown) {
  return invoke(menus.bulkDeleteMenus, input);
}

export async function slugAvailability(input: unknown) {
  return invokeQuery(menuQueries.slugAvailability, input);
}

export async function updateMenuSettings(input: unknown) {
  return invoke(menus.updateSettings, input);
}
