'use server';

import * as shifts from '@/server/pharmacy/actions/shifts';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as shiftQueries from '@/server/pharmacy/queries/shifts';

// The shift screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function openShift(input: unknown) {
  return invokePh(shifts.open, input);
}

export async function closeShift(input: unknown) {
  return invokePh(shifts.close, input);
}

export async function cashPaidIn(input: unknown) {
  return invokePh(shifts.paidIn, input);
}

export async function cashPaidOut(input: unknown) {
  return invokePh(shifts.paidOut, input);
}

export async function currentShift(input: unknown) {
  return invokePhQuery(shiftQueries.current, input);
}

export async function shiftReport(input: unknown) {
  return invokePhQuery(shiftQueries.report, input);
}

export async function listShifts(input: unknown) {
  return invokePhQuery(shiftQueries.list, input);
}
