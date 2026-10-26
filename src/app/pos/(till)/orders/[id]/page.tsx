import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posBoard, posOrder, posTillCatalog } from '@/server/studio/queries/pos';
import { posDeliveryOptions } from '@/server/studio/queries/pos-delivery';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { OrderScreen } from '@/app/pos/_ui/OrderScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.order.title') };
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ actor }, order, catalog, board] = await Promise.all([getPosAccess(), query(posOrder, { orderId: id }), query(posTillCatalog, {}), query(posBoard, {})]);
  if (!actor) return null;
  if (order.status === 'PAID') redirect(`/pos/orders/${id}/receipt`);
  if (order.status === 'CANCELLED' || order.status === 'REJECTED') redirect('/pos/tables');

  const delivery = order.offPremise ? await query(posDeliveryOptions, {}) : { zones: [], drivers: [] };
  const areaName = new Map(board.areas.map((area) => [area.id, area.name]));
  const freeTables = board.tables
    .filter((table) => table.status === 'FREE')
    .map((table) => ({ id: table.id, number: table.number, areaName: areaName.get(table.areaId) ?? '' }));

  return (
    <OrderScreen
      order={order}
      catalog={catalog}
      freeTables={freeTables}
      delivery={delivery}
      can={{ discount: canPos(actor.role, 'order.discount'), cancel: canPos(actor.role, 'order.cancel'), pay: canPos(actor.role, 'payment.take') }}
    />
  );
}
