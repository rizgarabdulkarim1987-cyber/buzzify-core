'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/studio/i18n';
import type { CashierOp } from './flows-logic';

/**
 * "All operations", inline in the work panel: the prototype's list, each entry a link to the existing screen that does it (no new
 * page). Only the entries this role may open are given (`cashierOps`); leaving with open receipts goes through the leave guard.
 */
export function OpsPanel({ ops }: { ops: CashierOp[] }) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-1.5" data-testid="ops-list">
      {ops.map((op) => (
        <li key={op.key}>
          <Link
            href={op.href}
            data-testid="ops-link"
            data-op={op.key}
            className="flex min-h-12 items-center justify-between gap-2 rounded-ph-xl border border-ph-line bg-ph-card px-3 text-sm font-semibold text-ph-text hover:bg-ph-canvas"
          >
            {t(`pharmacy.cashier.ops.${op.key}`)}
            <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ph-muted rtl:-scale-x-100" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
