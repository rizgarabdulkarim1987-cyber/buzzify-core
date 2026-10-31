import type { Metadata } from 'next';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { PrintSettingsForm } from '@/app/pharmacy/_ui/PrintSettingsForm';
import { get as getPrint } from '@/server/pharmacy/queries/print-settings';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.print.settings.title') };
}

/** This workstation's printing settings and the test pages. Every staff role reads them (and prints the tests); the owner saves them while the pharmacy is open. */
export default async function PrintSettingsPage() {
  const g = await phGate({ permission: 'catalog.view', titleKey: 'pharmacy.print.settings.title', testid: 'print-forbidden', messages: 'pharmacy.print' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const view = await query(getPrint, access.placeInput);
  return (
    <>
      <PageHeader className="max-sm:px-4 print:hidden" title={t('pharmacy.print.settings.title')} description={t('pharmacy.print.settings.intro')} />
      <PrintSettingsForm print={view.print} version={view.version} editable={roleMay(access.actor, 'settings.manage')} writable={access.writable('settings.manage')} />
    </>
  );
}
