import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posBoard } from '@/server/studio/queries/pos';
import { posDeliveryOptions, posOffPremiseBoard, posOffPremiseFlags } from '@/server/studio/queries/pos-delivery';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { OffPremiseBoard } from '@/app/pos/_ui/OffPremiseBoard';
import { OffPremiseTabs } from '@/app/pos/_ui/OffPremiseTabs';
import { TablesBoard } from '@/app/pos/_ui/TablesBoard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.board.title') };
}

/** The board: tables, and (when switched on) the takeaway and delivery orders as `?area=takeaway|delivery`. */
export default async function TablesPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const [{ area }, flags, locale] = await Promise.all([searchParams, query(posOffPremiseFlags, {}), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const kind = area === 'takeaway' && flags.takeaway ? 'TAKEAWAY' : area === 'delivery' && flags.delivery ? 'DELIVERY' : null;
  if (kind === null) {
    const board = await query(posBoard, {});
    return (
      <>
        <PageHeader title={t('pos.board.title')} />
        <OffPremiseTabs current="tables" takeaway={flags.takeaway} delivery={flags.delivery} />
        <TablesBoard board={board} />
      </>
    );
  }
  const [board, options] = await Promise.all([query(posOffPremiseBoard, {}), query(posDeliveryOptions, {})]);
  return (
    <>
      <PageHeader title={kind === 'DELIVERY' ? t('pos.offp.tabDelivery') : t('pos.offp.tabTakeaway')} />
      <OffPremiseTabs current={kind === 'DELIVERY' ? 'delivery' : 'takeaway'} takeaway={flags.takeaway} delivery={flags.delivery} />
      <OffPremiseBoard kind={kind} board={board} readAt={new Date().toISOString()} zones={options.zones} drivers={options.drivers} />
    </>
  );
}
