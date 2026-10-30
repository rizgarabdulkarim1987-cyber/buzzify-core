import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { roleMay } from '../catalog/access';

/**
 * Who is on a purchasing screen. A role without `purchase.manage` (and a support actor) gets the blocked state and no data
 * is fetched: the page returns `blocked` before any query. `writable` is whether the pharmacy is open for writing and the
 * role may buy; read-only pharmacies see the data with the controls missing and the reason in words.
 */
export async function purchasingGate(titleKey: string, backTo?: { href: string; labelKey: string }) {
  const { access, locale, t, back, may: mayBuy, blocked } = await phGate({ permission: 'purchase.manage', titleKey, backTo, testid: 'purchasing-forbidden', messages: 'pharmacy.purchasing' });
  const writable = access.writable('purchase.manage');
  // R4-9a: paying, reversing, voiding and applying credit also need `report.view` (a stock clerk has purchase.manage only).
  const mayMoney = mayBuy && roleMay(access.actor, 'report.view');
  return { access, locale, t, back, blocked, writable, mayMoney, writeNotice: !writable.ok && mayBuy ? <ReceiveBlocked reason={writable.reason} t={t} /> : null };
}
