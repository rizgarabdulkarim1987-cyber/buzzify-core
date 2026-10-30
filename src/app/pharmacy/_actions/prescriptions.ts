'use server';

import * as rx from '@/server/pharmacy/actions/prescriptions';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as rxQueries from '@/server/pharmacy/queries/prescriptions';

// The prescription drawer's Server Actions. The file upload goes through `/api/pharmacy/rx-attachments`; the bytes of a stored file are read only by the gated route.

export async function createPrescription(input: unknown) {
  return invokePh(rx.create, input);
}

export async function getPrescription(input: unknown) {
  return invokePhQuery(rxQueries.get, input);
}
