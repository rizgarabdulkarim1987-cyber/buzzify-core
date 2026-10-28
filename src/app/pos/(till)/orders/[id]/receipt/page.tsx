import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posReceipt } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { canPos } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';
import { Receipt } from '@/app/pos/_ui/Receipt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.receipt.title') };
}

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ part?: string; print?: string }> }) {
  const [{ id }, { part, print }] = await Promise.all([params, searchParams]);
  const [receipt, { actor }] = await Promise.all([query(posReceipt, { orderId: id, ...(part ? { paymentId: part } : {}) }), getPosAccess()]);
  return <Receipt receipt={receipt} canRefund={actor !== null && canPos(actor.role, 'payment.refund')} autoPrint={print === '1'} />;
}
