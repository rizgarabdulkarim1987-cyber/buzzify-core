import { Lock, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { CashierScreen } from '@/app/pharmacy/_ui/cashier/CashierScreen';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { pulse as pulseQuery } from '@/server/pharmacy/queries/pulse';
import { current } from '@/server/pharmacy/queries/shifts';
import { search } from '@/server/pharmacy/queries/sell';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { catalogAccess, roleMay } from '../catalog/access';

/** A failed read of the header chips: the till shows without them (Next's own redirect and not-found signals still pass). */
function chipsUnread(error: unknown): undefined {
  unstable_rethrow(error);
  return undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.sell.title') };
}

/**
 * The sale screen: the cashier (`CashierScreen`). Who may sell follows `shift.use`; the page says why it is missing for anyone
 * else (a role that does not sell, a support actor, a read-only pharmacy, "All branches" chosen). Selling is in one branch, so
 * one must be chosen. The shift gate (no open shift: open one first) and everything after it are the client screen; the server
 * checks every call again. What the role may do is read here from the session: discount, batch override, prescriptions,
 * credit, returns (`return.approve`), the cost columns (`cost.view`; the server answers `ph.sell.costs` with nothing for anyone
 * else) and price edit (`price.change`). The header chips (`ph.pulse`) are read here and again on `router.refresh()` after a
 * sale or a return. The AI Doctor is not on this page (owner decision 2026-11-05); it keeps its own page and nav item.
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

  // The header chips are a convenience: a problem reading them shows the till without chips, it never takes the till down.
  const [now, found, pulse] = await Promise.all([query(current, placeInput), query(search, { ...placeInput, q: '', limit: 1 }), query(pulseQuery, placeInput).catch(chipsUnread)]);
  const open = now
    ? { id: now.shift.id, currency: now.shift.currency, openingFloatMinor: now.shift.openingFloatMinor, openedAt: now.shift.openedAt }
    : null;

  return (
    <CashierScreen
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
      pulse={pulse}
      role={actor.role}
      canReturn={roleMay(actor, 'return.approve')}
      canSeeCost={roleMay(actor, 'cost.view')}
      canEditPrice={roleMay(actor, 'price.change')}
    />
  );
}
