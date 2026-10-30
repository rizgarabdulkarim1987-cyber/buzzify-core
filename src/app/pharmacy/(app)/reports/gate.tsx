import { getPhBranches } from '@/server/pharmacy/actor';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { roleMay } from '../catalog/access';

/**
 * Who is on a report screen. A role without `report.view` (and a support actor) gets the blocked state and NO data is fetched: the page
 * returns `blocked` before any query. Reports are reads, so a read-only pharmacy keeps them (and the exports) open: there is no
 * write gate here. `mayMargin` is profit.view AND cost.view, the two keys margin needs besides report.view.
 */
export async function reportsGate(titleKey: string, backTo?: { href: string; labelKey: string }) {
  const { access, locale, t, back, blocked } = await phGate({ permission: 'report.view', titleKey, backTo, testid: 'reports-forbidden', messages: 'pharmacy.reports' });
  return {
    access,
    locale,
    t,
    back,
    blocked,
    mayMargin: roleMay(access.actor, 'profit.view') && roleMay(access.actor, 'cost.view'),
    mayTransfers: roleMay(access.actor, 'transfer.manage'),
    /** The branches the person works in, by id and name (after the gate: nothing is read for a blocked role). */
    branches: async () => {
      const all = await getPhBranches(access.actor.restaurantId);
      return all.filter((b) => access.actor.branchIds.includes(b.id));
    },
  };
}
