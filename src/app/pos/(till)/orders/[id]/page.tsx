import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatNumber } from '@/lib/pos-format';
import { LAYOUT_COOKIE, layoutOf } from '@/lib/pos-floor';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posBoard, posOrder, posTillCatalog } from '@/server/studio/queries/pos';
import { posApprovers } from '@/server/studio/queries/pos-approval';
import { posDeliveryOptions } from '@/server/studio/queries/pos-delivery';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { OrderScreen } from '@/app/pos/_ui/OrderScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.order.title') };
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pay?: string }> }) {
  const [{ id }, { pay }] = await Promise.all([params, searchParams]);
  const [{ actor }, order, catalog, board, approvers] = await Promise.all([
    getPosAccess(),
    query(posOrder, { orderId: id }),
    query(posTillCatalog, {}),
    query(posBoard, {}),
    query(posApprovers, {}),
  ]);
  if (!actor) return null;
  if (order.status === 'PAID') redirect(`/pos/orders/${id}/receipt`);
  if (order.status === 'CANCELLED' || order.status === 'REJECTED') redirect('/pos/tables');

  const delivery = order.offPremise ? await query(posDeliveryOptions, {}) : { zones: [], drivers: [] };
  const areaName = new Map(board.areas.map((area) => [area.id, area.name]));
  const freeTables = board.tables
    .filter((table) => table.status === 'FREE')
    .map((table) => ({ id: table.id, number: table.number, areaName: areaName.get(table.areaId) ?? '' }));

  const mergeTargets = board.tables
    .filter((table) => table.orderId !== null && table.orderId !== order.id && table.orderVersion !== null)
    .map((table) => ({ orderId: table.orderId as string, version: table.orderVersion as number, number: table.number, areaName: areaName.get(table.areaId) ?? '' }));

  const screen = (
    <OrderScreen
      order={order}
      catalog={catalog}
      freeTables={freeTables}
      mergeTargets={mergeTargets}
      delivery={delivery}
      approvers={approvers}
      can={{ discount: canPos(actor.role, 'order.discount'), cancel: canPos(actor.role, 'order.cancel'), pay: canPos(actor.role, 'payment.take') }}
      initialPaying={pay === '1'}
    />
  );
  // The order-first layout keeps every table one press away beside the order.
  if (layoutOf((await cookies()).get(LAYOUT_COOKIE)?.value) !== 'order') return screen;
  const t = getStudioTranslator(actor.locale);
  return (
    <div className="flex min-h-0 flex-1 gap-3 ps-4">
      <nav aria-label={t('pos.board.title')} data-testid="order-rail" className="hidden w-20 shrink-0 py-4 lg:flex">
        <ul className="grid w-full auto-rows-[64px] content-start gap-2 overflow-y-auto [scrollbar-width:thin]">
          {board.tables.map((table) => {
            const current = table.id === order.tableId;
            return (
              <li key={table.id} className="grid">
                <Link
                  href={table.orderId ? `/pos/orders/${table.orderId}` : '/pos/tables'}
                  data-status={table.status}
                  data-selected={current || undefined}
                  aria-current={current ? 'page' : undefined}
                  aria-label={t('pos.board.tableLabel', { n: formatNumber(table.number), state: t(`pos.board.state.${STATE_KEY[table.status]}`) })}
                  className="tile grid place-content-center place-items-center text-2xl font-bold"
                >
                  <span className="tile-no" aria-hidden="true" dir="ltr">
                    {formatNumber(table.number)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">{screen}</div>
    </div>
  );
}

const STATE_KEY = { FREE: 'free', BUSY: 'busy', READY: 'ready', BILL_REQUESTED: 'bill', PENDING_APPROVAL: 'pending' } as const;
