import type { Metadata } from 'next';
import { LabelWorkspace } from '@/app/pharmacy/_ui/LabelWorkspace';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { get as getPrint } from '@/server/pharmacy/queries/print-settings';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.print.labels.title') };
}

/**
 * Shelf and batch labels. Every staff role that sees the catalog may print them (`catalog.view` is the only price permission the pharmacy has: the POS shows every such role the sale price, so the label may too); the page
 * reads only, so it works while the pharmacy is read-only. A support actor gets the blocked state.
 */
export default async function LabelsPage() {
  const g = await phGate({ permission: 'catalog.view', titleKey: 'pharmacy.print.labels.title', testid: 'print-forbidden', messages: 'pharmacy.print' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const view = await query(getPrint, access.placeInput);
  return (
    <>
      <PageHeader className="max-sm:px-4 print:hidden" title={t('pharmacy.print.labels.title')} description={t('pharmacy.print.labels.intro')} />
      <LabelWorkspace print={view.print} mayPrice={roleMay(access.actor, 'catalog.view')} />
    </>
  );
}
