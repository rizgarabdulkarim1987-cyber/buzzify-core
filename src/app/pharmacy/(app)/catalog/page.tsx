import type { Metadata } from 'next';
import { ProductSearch } from '@/app/pharmacy/_ui/ProductSearch';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { list } from '@/server/pharmacy/queries/products';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from './access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.catalog.title') };
}

/**
 * The catalog: the central search over every product. Everyone in the pharmacy may look; adding, importing and the
 * export of costs follow the person's role and the pharmacy's state, and the page says why when they are missing.
 */
export default async function CatalogPage() {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const initial = await query(list, { ...access.placeInput, active: 'active' });
  const manage = access.writable('catalog.manage');
  const canImport = access.writable('import.apply').ok;
  // A cashier sees the list only; export is for those who manage the catalog or read reports (and support).
  const { actor } = access;
  const canExport = actor.role === null || roleMay(actor, 'catalog.manage') || roleMay(actor, 'report.view');
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.catalog.title')} description={t('pharmacy.catalog.intro')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        <WriteBlocked writable={manage} />
        <ProductSearch initial={initial} showCost={access.showCost} canManage={manage.ok} canImport={canImport} canExport={canExport} />
      </div>
    </>
  );
}
