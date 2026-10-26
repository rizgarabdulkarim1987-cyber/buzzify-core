'use client';

import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { formatNumber } from '@/lib/pos-format';
import { useT } from '@/studio/i18n';
import { useNow } from './live';

/** "Shift open for 03:40": how long the person's open shift has run, as hours and minutes, linking to the shift page. */
export function ShiftPill({ openedAt, readAt }: { openedAt: number; readAt: number }) {
  const t = useT();
  const now = useNow(readAt);
  const minutes = Math.max(0, Math.floor((now - openedAt) / 60_000));
  const time = `${formatNumber(Math.floor(minutes / 60)).padStart(2, '0')}:${formatNumber(minutes % 60).padStart(2, '0')}`;
  return (
    <Link href="/pos/shift" className="till-stat inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-success">
      <Wallet aria-hidden size={18} />
      <span dir="auto">{t('pos.shell.shiftSince', { time })}</span>
    </Link>
  );
}
