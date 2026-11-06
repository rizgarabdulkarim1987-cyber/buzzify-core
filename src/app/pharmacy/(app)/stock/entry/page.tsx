import { Lock, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EntryScreen } from '@/app/pharmacy/_ui/entry/EntryScreen';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { entryDraft } from '@/server/pharmacy/queries/fast-entry';
import { list as listSuppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.entry.title') };
}

/**
 * Fast product entry (`EntryScreen`), where the nav's Stock item opens. It needs the receiving permission (`purchase.manage`)
 * in a writable pharmacy and one chosen branch; a role that may only look at stock is sent to the stock list (Stock is its
 * nav item too), and anyone else is told why. The selling price is editable with `price.change`, the history's purchase
 * price shows with `cost.view`; the server checks both again on every call. The person's open entry is read here so the
 * "entered now" list survives a reload.
 */
export default async function StockEntryPage() {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const title = <h1 className="text-[26px] font-bold leading-8 tracking-tight text-ph-text">{t('pharmacy.entry.title')}</h1>;
  const stockLink = (
    <Link href="/pharmacy/stock" className="inline-flex min-h-11 w-fit items-center rounded-ph-xl px-2 text-sm font-medium text-ph-text underline underline-offset-2 hover:bg-ph-card">
      {t('pharmacy.entry.stockList')}
    </Link>
  );

  if (actor.role !== null && !roleMay(actor, 'purchase.manage') && roleMay(actor, 'catalog.view')) redirect('/pharmacy/stock');
  const writable = access.writable('purchase.manage');
  if (actor.role === null || !roleMay(actor, 'purchase.manage') || !writable.ok) {
    return (
      <div data-testid="entry-forbidden" className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-8">
        {title}
        {!writable.ok && <ReceiveBlocked reason={writable.reason} t={t} />}
        {(actor.role === null || !roleMay(actor, 'purchase.manage')) && <EmptyState icon={<Lock />} title={t('pharmacy.entry.forbidden.title')} body={t('pharmacy.entry.forbidden.role')} />}
        {stockLink}
      </div>
    );
  }
  if (!place.branchId) {
    return (
      <div data-testid="entry-pick-branch" className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-8">
        {title}
        <EmptyState icon={<MapPin />} title={t('pharmacy.entry.title')} body={t('pharmacy.entry.pickBranch')} />
        {stockLink}
      </div>
    );
  }

  const [open, suppliers] = await Promise.all([query(entryDraft, placeInput), query(listSuppliers, { ...placeInput, active: true })]);
  return (
    <EntryScreen
      key={place.branchId}
      branchId={place.branchId}
      canChangePrice={roleMay(actor, 'price.change')}
      canSeeCost={access.showCost}
      suppliers={suppliers.items.map((s) => ({ id: s.id, name: s.name }))}
      initialDraft={open.draft}
    />
  );
}
