import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../catalog/access';

/**
 * Who is on a customer screen. Someone who may manage customers, or sell on credit (they pick customers at the till), sees the list;
 * everyone else (and a support actor) gets the blocked state and NO data is fetched. `mayManage` (`customer.manage`) adds the phone,
 * the note, the statement, the ageing and every write. `writable` is whether the pharmacy is open for writing and the role may manage:
 * a read-only pharmacy keeps lists and statements readable and shows no write control.
 */
export async function customersGate(titleKey: string, backTo?: { href: string; labelKey: string }) {
  const g = await phGate({ permission: 'catalog.view', titleKey, backTo, testid: 'customers-forbidden', messages: 'pharmacy.customers' });
  const { actor } = g.access;
  const may = roleMay(actor, 'customer.manage') || roleMay(actor, 'credit.sell');
  let blocked: ReactNode = g.blocked;
  if (!blocked && !may) {
    blocked = (
      <>
        <PageHeader className="max-sm:px-4" title={g.t(titleKey)} above={g.back} />
        <div data-testid="customers-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={g.t('pharmacy.customers.forbidden.title')} body={g.t(actor.role === null ? 'pharmacy.customers.forbidden.support' : 'pharmacy.customers.forbidden.role')} />
        </div>
      </>
    );
  }
  const mayManage = roleMay(actor, 'customer.manage');
  return { ...g, blocked, mayManage, writable: g.access.writable('customer.manage') };
}
