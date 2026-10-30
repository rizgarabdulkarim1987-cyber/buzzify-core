'use server';

import * as credits from '@/server/pharmacy/actions/credit-notes';
import * as payments from '@/server/pharmacy/actions/supplier-payments';
import { invokePh } from '@/server/pharmacy/invoke';

// Supplier payments, their reversals, credit notes and the use of credit. Recorded in the books only: no cash drawer is touched.

export async function createPayment(input: unknown) {
  return invokePh(payments.create, input);
}

export async function reversePayment(input: unknown) {
  return invokePh(payments.reverse, input);
}

export async function recordCredit(input: unknown) {
  return invokePh(credits.record, input);
}

export async function applyCredit(input: unknown) {
  return invokePh(payments.applyCreditNote, input);
}
