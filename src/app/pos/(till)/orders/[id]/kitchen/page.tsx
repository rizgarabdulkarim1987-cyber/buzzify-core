import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posOrderKitchenTicket } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { KitchenTicket } from '@/app/pos/_ui/KitchenTicket';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.ticket.title') };
}

export default async function OrderTicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ batch?: string }> }) {
  const [{ id }, { batch }] = await Promise.all([params, searchParams]);
  const n = batch && /^\d+$/.test(batch) ? Number(batch) : undefined;
  const ticket = await query(posOrderKitchenTicket, { orderId: id, batch: n });
  return <KitchenTicket ticket={ticket} />;
}
