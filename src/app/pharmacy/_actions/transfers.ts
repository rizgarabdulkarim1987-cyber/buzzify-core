'use server';

import * as transfers from '@/server/pharmacy/actions/transfers';
import { invokePh } from '@/server/pharmacy/invoke';

// The transfer screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function requestTransfer(input: unknown) {
  return invokePh(transfers.request, input);
}

export async function updateTransfer(input: unknown) {
  return invokePh(transfers.update, input);
}

export async function cancelTransfer(input: unknown) {
  return invokePh(transfers.cancel, input);
}

export async function sendTransfer(input: unknown) {
  return invokePh(transfers.send, input);
}

export async function receiveTransfer(input: unknown) {
  return invokePh(transfers.receive, input);
}
