import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { posReceipt } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Receipt } from '@/app/pos/_ui/Receipt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.receipt.title') };
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await query(posReceipt, { orderId: id });
  return <Receipt receipt={receipt} />;
}
