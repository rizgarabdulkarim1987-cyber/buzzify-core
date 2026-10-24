'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { payPosOrder } from '@/app/studio/_actions/pos';
import { amountDigits, quickCash } from '@/lib/pos-view';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { Input } from '@/studio/ui/Input';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  version: number;
  total: number;
}

/** Cash payment: the amount handed over (quick buttons or typed), the change it leaves, and the one tap that takes it. */
export function PayPanel({ open, onClose, orderId, version, total }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={<PayTitle />} width="md">
      {open ? <PayBody orderId={orderId} version={version} total={total} /> : null}
    </Dialog>
  );
}

function PayTitle() {
  return <>{useT()('pos.pay.title')}</>;
}

function PayBody({ orderId, version, total }: Omit<Props, 'open' | 'onClose'>) {
  const t = useT();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const [received, setReceived] = useState(total);
  const [typed, setTyped] = useState('');
  const change = received - total;
  const enough = received >= total;

  const pay = () =>
    void call(() => payPosOrder({ orderId, expectedVersion: version, expectedTotal: total, amountReceived: received, method: 'CASH' }), {
      onOk: () => router.push(`/pos/orders/${orderId}/receipt`),
    });

  return (
    <div className="flex flex-col gap-5">
      <dl className="flex items-baseline justify-between gap-3 text-lg">
        <dt className="text-muted">{t('pos.pay.due')}</dt>
        <dd className="text-2xl font-semibold">{money(total)}</dd>
      </dl>

      <div className="flex flex-col gap-2">
        <span className="text-base font-medium text-text">{t('pos.pay.received')}</span>
        <div className="flex flex-wrap gap-2">
          {quickCash(total).map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => {
                setReceived(amount);
                setTyped('');
              }}
              aria-pressed={received === amount && typed === ''}
              className={cx(
                'min-h-12 rounded-md border px-4 text-base font-medium',
                received === amount && typed === '' ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-raised hover:bg-hover',
              )}
            >
              {money(amount)}
            </button>
          ))}
        </div>
        <Input
          size="lg"
          inputMode="numeric"
          dir="ltr"
          placeholder={t('pos.pay.otherAmount')}
          aria-label={t('pos.pay.otherAmount')}
          value={typed}
          onChange={(event) => {
            const digits = amountDigits(event.target.value);
            setTyped(digits);
            setReceived(digits === '' ? 0 : Number(digits));
          }}
        />
      </div>

      <dl className="flex items-baseline justify-between gap-3 text-lg" aria-live="polite">
        <dt className="text-muted">{enough ? t('pos.pay.change') : t('pos.pay.short')}</dt>
        <dd className={cx('text-2xl font-semibold', enough ? 'text-success' : 'text-danger')}>{money(Math.abs(change))}</dd>
      </dl>

      <Button variant="primary" size="lg" className="min-h-12 w-full" disabled={!enough || pending} pending={pending} onClick={pay}>
        {t('pos.pay.take')}
      </Button>
    </div>
  );
}
