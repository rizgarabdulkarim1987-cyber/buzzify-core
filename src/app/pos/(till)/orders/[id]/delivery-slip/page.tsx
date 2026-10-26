import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { query } from '@/server/studio/framework/invoke';
import { posOrder } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { DeliverySlip } from '@/app/pos/_ui/DeliverySlip';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.slip.title') };
}

/** The driver slip of a delivery order. */
export default async function DeliverySlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await query(posOrder, { orderId: id });
  if (order.kind !== 'DELIVERY') notFound();
  return <DeliverySlip order={order} />;
}
