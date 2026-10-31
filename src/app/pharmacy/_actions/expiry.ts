'use server';

import * as expiryActions from '@/server/pharmacy/actions/expiry';
import { invokePh } from '@/server/pharmacy/invoke';

// The expiry screen's Server Action. `invokePh` puts in the place the person chose; the browser never names the pharmacy.

export async function setExpiryStatus(input: unknown) {
  return invokePh(expiryActions.setStatus, input);
}
