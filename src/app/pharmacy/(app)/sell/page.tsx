import { Lock, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { SellWorkspace } from '@/app/pharmacy/_ui/SellWorkspace';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { current } from '@/server/pharmacy/queries/shifts';
import { search } from '@/server/pharmacy/queries/sell';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { catalogAccess, roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.sell.title') };
}

/**
 * The sale screen. Who may sell follows `shift.use`; the page says why it is missing for anyone else (a role that does
 * not sell, a support actor, a read-only pharmacy, "All branches" chosen). Selling is in one branch, so one must be
 * chosen. The shift gate and everything after it are the client workspace; the server checks every call again.
 */
export default async function SellPage() {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;

  if (actor.role === null || !roleMay(actor, 'shift.use')) {
    return (
      <div data-testid="sell-forbidden" className="px-4 py-8 sm:px-8">
        <EmptyState icon={<Lock />} title={t('pharmacy.sell.forbidden.title')} body={t(actor.role === null ? 'pharmacy.sell.forbidden.support' : 'pharmacy.sell.forbidden.role')} />
      </div>
    );
  }
  const write = access.writable('shift.use');
  if (!write.ok) {
    return (
      <div className="px-4 py-8 sm:px-8">
        <WriteBlocked writable={write} />
      </div>
    );
  }
  if (!place.branchId) {
    return (
      <div data-testid="sell-pick-branch" className="px-4 py-8 sm:px-8">
        <EmptyState icon={<MapPin />} title={t('pharmacy.sell.pickBranch.title')} body={t('pharmacy.sell.pickBranch.body')} />
      </div>
    );
  }

  const [now, found] = await Promise.all([query(current, placeInput), query(search, { ...placeInput, q: '', limit: 1 })]);
  const open = now
    ? { id: now.shift.id, currency: now.shift.currency, openingFloatMinor: now.shift.openingFloatMinor, openedAt: now.shift.openedAt }
    : null;

  return (
    <SellWorkspace
      restaurantId={placeInput.restaurantId}
      branchId={place.branchId}
      userId={actor.userId}
      shift={open}
      settings={found.settings}
      perms={{
        discount: roleMay(actor, 'discount.apply'),
        batchOverride: roleMay(actor, 'batch.override'),
        rx: roleMay(actor, 'rx.dispense'),
        credit: found.settings.creditEnabled && roleMay(actor, 'credit.sell'),
      }}
    />
  );
}
