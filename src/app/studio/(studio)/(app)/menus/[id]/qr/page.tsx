import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import * as qrQueries from '@/server/studio/queries/qr';
import { QrCodes } from '@/studio/workspace/QrCodes';
import { tabMetadata } from '../load';

// Drawing every table's code into one ZIP (up to 200 SVGs and PNGs) takes a few seconds; the page's actions get this long.
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'qr');
}

/** The QR tab: printed codes for the menu and its tables, their look, downloads and scans. */
export default async function QrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await query(qrQueries.list, { menuId: id });
  return <QrCodes menuId={id} view={view} />;
}
