'use server';

import * as printActions from '@/server/pharmacy/actions/print-settings';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as printQueries from '@/server/pharmacy/queries/print-settings';

// The printing screens' Server Actions (settings only; the documents come from the receipts actions).

export async function getPrintSettings(input: unknown) {
  return invokePhQuery(printQueries.get, input);
}

export async function setPrintSettings(input: unknown) {
  return invokePh(printActions.set, input);
}
