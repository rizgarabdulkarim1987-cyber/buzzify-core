'use server';

import * as restaurants from '@/server/studio/actions/restaurants';
import { invoke } from '@/server/studio/framework/invoke';

export async function createRestaurant(input: unknown) {
  return invoke(restaurants.createRestaurant, input);
}

export async function updateRestaurant(input: unknown) {
  return invoke(restaurants.updateRestaurant, input);
}

export async function setRestaurantStatus(input: unknown) {
  return invoke(restaurants.setRestaurantStatus, input);
}

export async function deleteRestaurant(input: unknown) {
  return invoke(restaurants.deleteRestaurant, input);
}

export async function createBranch(input: unknown) {
  return invoke(restaurants.createBranch, input);
}

export async function updateBranch(input: unknown) {
  return invoke(restaurants.updateBranch, input);
}

export async function deleteBranch(input: unknown) {
  return invoke(restaurants.deleteBranch, input);
}

export async function reorderBranches(input: unknown) {
  return invoke(restaurants.reorderBranches, input);
}
