'use server';

import * as content from '@/server/studio/actions/content';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as contentQueries from '@/server/studio/queries/content';

export async function createCategory(input: unknown) {
  return invoke(content.createCategory, input);
}

export async function updateCategory(input: unknown) {
  return invoke(content.updateCategory, input);
}

export async function deleteCategory(input: unknown) {
  return invoke(content.deleteCategory, input);
}

export async function reorderCategories(input: unknown) {
  return invoke(content.reorderCategories, input);
}

export async function createProduct(input: unknown) {
  return invoke(content.createProduct, input);
}

export async function saveProduct(input: unknown) {
  return invoke(content.saveProduct, input);
}

export async function deleteProduct(input: unknown) {
  return invoke(content.deleteProduct, input);
}

export async function moveProduct(input: unknown) {
  return invoke(content.moveProduct, input);
}

export async function loadProduct(input: unknown) {
  return invokeQuery(contentQueries.product, input);
}
