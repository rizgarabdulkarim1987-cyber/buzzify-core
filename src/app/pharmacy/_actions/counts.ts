'use server';

import * as counts from '@/server/pharmacy/actions/counts';
import { invokePh } from '@/server/pharmacy/invoke';

// The stock count screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function openCount(input: unknown) {
  return invokePh(counts.open, input);
}

export async function recordCounts(input: unknown) {
  return invokePh(counts.record, input);
}

export async function submitCount(input: unknown) {
  return invokePh(counts.submit, input);
}

export async function cancelCount(input: unknown) {
  return invokePh(counts.cancel, input);
}

export async function approveCount(input: unknown) {
  return invokePh(counts.approve, input);
}
