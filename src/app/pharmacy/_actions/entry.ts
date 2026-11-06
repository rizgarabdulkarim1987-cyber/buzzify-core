'use server';

import * as entry from '@/server/pharmacy/actions/fast-entry';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as entryQueries from '@/server/pharmacy/queries/fast-entry';
import * as historyQueries from '@/server/pharmacy/queries/product-history';

// The fast product entry screen's Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function addEntryLine(input: unknown) {
  return invokePh(entry.addEntryLine, input);
}

export async function finishEntry(input: unknown) {
  return invokePh(entry.finishEntry, input);
}

export async function lookupEntryProduct(input: unknown) {
  return invokePhQuery(entryQueries.entryLookup, input);
}

export async function readEntryDraft(input: unknown) {
  return invokePhQuery(entryQueries.entryDraft, input);
}

export async function readProductHistory(input: unknown) {
  return invokePhQuery(historyQueries.productHistory, input);
}
