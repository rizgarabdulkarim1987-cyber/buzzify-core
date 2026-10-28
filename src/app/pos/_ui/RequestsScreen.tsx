'use client';

import { useState } from 'react';
import type { PosRole } from '@/server/domain/pos/permissions';
import type { RequestDetail } from '@/server/pos/customer-orders';
import type { TillCatalog } from '@/server/pos/till-catalog';
import { useT } from '@/studio/i18n';
import { EmptyState } from '@/studio/ui/EmptyState';
import { useLiveRefresh, useNow } from './live';
import { BillCalls, RejectDialog, RequestCard, type BillCallView } from './RequestCard';
import { usePosCall } from './use-pos-call';

const REFRESH_MS = 5_000;

/**
 * The guests' QR orders, oldest first, under the guests' open calls for the bill. Whoever handles them trims them, then
 * accepts (into the table's order) or rejects; an order held for the captain waits for the captain's approval first.
 */
export function RequestsScreen({ requests, billCalls, catalog, role, readAt }: { requests: RequestDetail[]; billCalls: BillCallView[]; catalog: TillCatalog | null; role: PosRole; readAt: Date }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const [rejecting, setRejecting] = useState<RequestDetail | null>(null);
  const [leaving, setLeaving] = useState(false);
  const now = Math.max(useNow(new Date(readAt).getTime()), new Date(readAt).getTime());
  useLiveRefresh(REFRESH_MS);
  const busy = pending || leaving;

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
      <BillCalls calls={billCalls} now={now} call={call} pending={busy} />
      {requests.length === 0 ? (
        <EmptyState title={t('pos.requests.empty')} body={t('pos.requests.emptyHint')} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} role={role} catalog={catalog} now={now} call={call} busy={busy} onReject={setRejecting} onLeave={() => setLeaving(true)} />
          ))}
        </ul>
      )}
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} call={call} />
    </div>
  );
}
