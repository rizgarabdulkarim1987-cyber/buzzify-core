'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { getCustomer } from '@/app/pharmacy/_actions/customers';
import { settle } from '@/studio/settle';
import type { PickedCustomer } from '../CustomerPicker';

/**
 * After a sale on the customer's account their balance changed: the customer is read again and replaced on every receipt that
 * holds them (the card and the total box show the new balance and room left), and `version` moves so the picker reads its list
 * again. A failed read keeps the old figures.
 */
export function useCustomerRecheck(setCustomers: Dispatch<SetStateAction<Record<string, PickedCustomer | null>>>) {
  const [version, setVersion] = useState(0);
  const recheck = (customerId: string) =>
    void settle(() => getCustomer({ customerId })).then((result) => {
      if (!result.ok) return;
      const fresh = result.data as PickedCustomer;
      setCustomers((all) => Object.fromEntries(Object.entries(all).map(([key, c]) => [key, c?.id === fresh.id ? fresh : c])));
      setVersion((v) => v + 1);
    });
  return { version, recheck };
}
