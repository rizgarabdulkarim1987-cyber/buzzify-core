'use client';

import { useState } from 'react';
import { reversePosPayment } from '@/app/studio/_actions/pos';
import { formatNumber } from '@/lib/pos-format';
import { refundIsTerminal, usdRefund } from '@/lib/pos-pay-legs';
import { refundOpensDrawer } from '@/server/domain/pos/drawer';
import type { PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';
import { useMoney } from './money';
import { usePrint } from './print/PrintProvider';
import { useSyncOptional } from './sync/SyncProvider';
import { usePosCall } from './use-pos-call';

interface Props {
  orderId: string;
  /** The part to reverse when the bill was split. */
  paymentId?: string;
  version: number;
  total: number;
  method: PosPaymentMethodKey;
  /** Every leg of the payment, so a split bill that took any cash opens the drawer on refund, and dollars are handed back as dollars. */
  legs: readonly { method: string; amount: number; tenderedUsd?: number | null; rate?: number | null }[];
}

/** The manager's "Reverse payment" button and its dialog: the amount and method are read-only, the reason is required. */
export function ReverseButton({ orderId, paymentId, version, total, method, legs }: Props) {
  const t = useT();
  const money = useMoney();
  const { call } = usePosCall();
  const { openDrawer } = usePrint();
  const sync = useSyncOptional();
  const [open, setOpen] = useState(false);
  const online = sync?.online ?? true;
  const terminal = refundIsTerminal(method);
  const usd = usdRefund(legs);

  return (
    <>
      <Button variant="ghost" size="lg" className="min-h-12 print:hidden" disabled={!online} onClick={() => setOpen(true)}>
        {t('pos.reverse.button')}
      </Button>
      {!online ? <p className="text-sm text-muted print:hidden">{t('pos.reverse.needsNetwork')}</p> : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('pos.reverse.title')}
        body={terminal ? t('pos.reverse.terminalNote') : t('pos.reverse.cashNote')}
        confirmLabel={t('pos.reverse.confirm')}
        onConfirm={async (form) => {
          const reason = String(form.get('reason') ?? '').trim();
          const reference = String(form.get('reference') ?? '').trim();
          const result = await call(() => reversePosPayment({ orderId, ...(paymentId ? { paymentId } : {}), expectedVersion: version, reason, ...(terminal && reference !== '' ? { reference } : {}) }), { quiet: true });
          if (result.ok) {
            // Cash goes back out of the drawer, so it opens (no paper): for any cash leg, not only when cash was the main method.
            if (refundOpensDrawer(legs)) void openDrawer();
            return true;
          }
          const fields = result.error.fields;
          return fields?.reason ? { fields: { reason: fields.reason } } : { message: t('pos.order.actionRefused') };
        }}
      >
        {(errors) => (
          <>
            <dl className="flex flex-col gap-1 text-base">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('pos.pay.method')}</dt>
                <dd>{t(`pos.method.${method}`)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-lg font-semibold">
                <dt>{t('pos.reverse.amount')}</dt>
                <dd>{money(total)}</dd>
              </div>
            </dl>
            {usd ? (
              <ul className="flex flex-col gap-1 text-base font-semibold">
                <li>{t('pos.reverse.usdGiveBack', { n: formatNumber(usd.dollars) })}</li>
                {usd.dinarChange > 0 ? <li>{t('pos.reverse.usdTakeChange', { amount: money(usd.dinarChange) })}</li> : null}
              </ul>
            ) : null}
            <Field label={t('pos.reverse.reason')} error={errors.reason}>
              <Textarea name="reason" dir="auto" rows={2} maxLength={300} />
            </Field>
            {terminal ? (
              <Field label={t('pos.reverse.reference')}>
                <Input name="reference" size="lg" dir="ltr" maxLength={100} />
              </Field>
            ) : null}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
