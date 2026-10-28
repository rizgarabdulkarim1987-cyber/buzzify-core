'use client';

import { Ban, CircleAlert, CircleCheck, Lock, PackageCheck, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cancelOrder, closeOrder, placeOrder } from '@/app/pharmacy/_actions/purchase-orders';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { useOnline } from './use-online';

type Panel = null | 'order' | 'cancel' | 'close';

/**
 * What can be done to an order in its state: edit and Order while DRAFT, Cancel while DRAFT or ORDERED with nothing
 * received, Close (with a reason) once something arrived, Receive goods while ORDERED or PARTIAL. Each state change asks
 * first and names what it does; a refusal shows the server's sentence, translated. Nothing here is fired by one tap.
 */
export function OrderActions({
  orderId,
  version,
  status,
  anyReceived,
  writable,
  atBranch,
}: {
  orderId: string;
  version: number;
  status: 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
  anyReceived: boolean;
  /** Whether the pharmacy is open for writing and the role may change orders. */
  writable: boolean;
  /** Whether the chosen branch is the order's branch (receiving and changing happen there). */
  atBranch: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const run = async (call: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof phMessage>[2] }>) => {
    setPending(true);
    const result = await call();
    setPending(false);
    if (!result.ok) {
      setError(phMessage(t, locale, result.error, 'pharmacy.purchasing'));
      setStale(result.error.code === 'CONFLICT' && !result.error.fields?.phCode);
      return;
    }
    setError(null);
    setPanel(null);
    router.refresh();
  };

  if (!writable) return null;
  if (!atBranch) {
    return (
      <p data-testid="po-wrong-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
        <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
        <span className="min-w-0">{t('pharmacy.purchasing.po.wrongBranch')}</span>
      </p>
    );
  }
  const open = status === 'ORDERED' || status === 'PARTIAL';
  const canCancel = status === 'DRAFT' || (status === 'ORDERED' && !anyReceived);
  const canClose = open && anyReceived;
  const can = online && !pending;
  const sent = { purchaseOrderId: orderId, expectedVersion: version };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="po-actions">
      <OfflineNotice />
      {error && (
        <div role="alert" data-testid="po-action-error" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <span className="flex min-w-0 items-start gap-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </span>
          {stale && (
            <Button size="lg" className="min-h-11" onClick={() => router.refresh()}>
              {t('pharmacy.purchasing.reload')}
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {status === 'DRAFT' && (
          <>
            <Link href={`/pharmacy/purchasing/orders/${orderId}/edit`} className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.po.edit')}
            </Link>
            <Button variant="primary" size="lg" className="min-h-11" icon={<Send aria-hidden />} data-testid="po-order" disabled={!can} onClick={() => setPanel('order')}>
              {t('pharmacy.purchasing.po.placeOrder')}
            </Button>
          </>
        )}
        {open && (
          <Link href={`/pharmacy/stock/receive/new?order=${orderId}`} data-testid="po-receive" className={buttonClasses('primary', 'lg', 'min-h-11')}>
            <PackageCheck aria-hidden />
            {t('pharmacy.purchasing.po.receive')}
          </Link>
        )}
        {canClose && (
          <Button size="lg" className="min-h-11" icon={<CircleCheck aria-hidden />} disabled={!can} onClick={() => setPanel('close')}>
            {t('pharmacy.purchasing.po.close')}
          </Button>
        )}
        {canCancel && (
          <Button size="lg" className="min-h-11" icon={<Ban aria-hidden />} disabled={!can} onClick={() => setPanel('cancel')}>
            {t('pharmacy.purchasing.po.cancel')}
          </Button>
        )}
      </div>

      {panel === 'order' && (
        <div role="region" aria-label={t('pharmacy.purchasing.po.orderTitle')} className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4">
          <p className="max-w-[72ch] text-sm text-text">{t('pharmacy.purchasing.po.orderBody')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" className="min-h-11" pending={pending} disabled={!can} onClick={() => void run(() => settle(() => placeOrder(sent)))}>
              {t('pharmacy.purchasing.po.orderYes')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={pending} onClick={() => setPanel(null)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </div>
      )}
      {panel === 'cancel' && (
        <div role="region" aria-label={t('pharmacy.purchasing.po.cancelTitle')} className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4">
          <p className="max-w-[72ch] text-sm text-text">{t('pharmacy.purchasing.po.cancelBody')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="lg" className="min-h-11" pending={pending} disabled={!can} onClick={() => void run(() => settle(() => cancelOrder(sent)))}>
              {t('pharmacy.purchasing.po.cancelYes')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={pending} onClick={() => setPanel(null)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </div>
      )}
      {panel === 'close' && (
        <form
          role="region"
          aria-label={t('pharmacy.purchasing.po.closeTitle')}
          data-testid="po-close-form"
          className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (can && reason.trim().length >= 3) void run(() => settle(() => closeOrder({ ...sent, reason })));
          }}
        >
          <p className="max-w-[72ch] text-sm text-text">{t('pharmacy.purchasing.po.closeBody')}</p>
          <Field label={t('pharmacy.purchasing.po.closeReason')} hint={t('pharmacy.purchasing.po.closeReasonHint')}>
            <Input className="min-h-11" dir="auto" maxLength={300} autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="lg" className="min-h-11" pending={pending} disabled={!can || reason.trim().length < 3}>
              {t('pharmacy.purchasing.po.closeYes')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={pending} onClick={() => setPanel(null)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
