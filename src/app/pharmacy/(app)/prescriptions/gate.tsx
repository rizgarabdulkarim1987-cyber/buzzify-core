import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { roleMay } from '../catalog/access';

/**
 * Who is on a prescription screen. A role without `rx.dispense` (and a support actor) gets the blocked state and NO data is fetched:
 * the page returns `blocked` before any query. `mayViewFiles` is `rx.attachment.view`: without it the page shows the files' state in
 * words and the viewer never asks the route for a byte. Reading is not writing, so a read-only pharmacy keeps every screen open.
 */
export async function rxGate(titleKey: string, backTo?: { href: string; labelKey: string }) {
  const g = await phGate({ permission: 'rx.dispense', titleKey, backTo, testid: 'rx-forbidden', messages: 'pharmacy.rx' });
  return { ...g, mayViewFiles: roleMay(g.access.actor, 'rx.attachment.view') };
}
