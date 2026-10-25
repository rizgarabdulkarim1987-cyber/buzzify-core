'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { advancePosFulfillment, assignPosDriver, lookupPosCustomer, openPosOffPremiseOrder } from '@/app/studio/_actions/pos';
import { elapsedLabel, elapsedMinutes, formatNumber, type ElapsedText } from '@/lib/pos-format';
import { nextSteps, type Fulfillment } from '@/server/domain/pos/fulfillment';
import type { DriverRow, ZoneRow } from '@/server/pos/delivery-setup';
import type { OffPremiseBoard as BoardData, OffPremiseCard } from '@/server/pos/off-premise';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Select } from '@/studio/ui/Select';
import { emptyDraft, feeOf, OffPremiseFields, type Draft } from './OffPremiseFields';
import { useLiveRefresh, useNow } from './live';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

const REFRESH_MS = 10_000;

const STATE_TONE: Record<Fulfillment, string> = {
  NEW: 'border-info bg-info-wash',
  PREPARING: 'border-accent bg-accent-wash',
  READY: 'border-success bg-success-wash',
  OUT: 'border-accent bg-accent-wash',
  DELIVERED: 'border-line-strong bg-raised',
  PICKED_UP: 'border-line-strong bg-raised',
};

interface Props {
  kind: 'TAKEAWAY' | 'DELIVERY';
  board: BoardData;
  readAt: string;
  zones: ZoneRow[];
  drivers: DriverRow[];
  /** False while the type is switched off: the live orders can still be finished, but no new one is opened. */
  canOpen: boolean;
}

/** The live takeaway or delivery orders as cards, each with its next step; and the dialog that opens a new one. */
export function OffPremiseBoard({ kind, board, readAt, zones, drivers, canOpen }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const now = useNow(new Date(readAt).getTime());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [hint, setHint] = useState<string | null>(null);
  useLiveRefresh(REFRESH_MS);

  const delivery = kind === 'DELIVERY';
  const cards = delivery ? board.delivery : board.takeaway;
  const text: ElapsedText = useMemo(
    () => ({ justNow: t('pos.time.justNow'), one: t('pos.time.one'), two: t('pos.time.two'), few: t('pos.time.few'), many: t('pos.time.many'), other: t('pos.time.other'), hours: t('pos.time.hours') }),
    [t],
  );

  const lookup = async () => {
    if (!delivery || draft.phone.trim() === '') return;
    const result = await lookupPosCustomer({ phone: draft.phone });
    if (!result.ok || !result.data) {
      setHint(null);
      return;
    }
    const found = result.data;
    const zone = zones.find((z) => z.id === found.zoneId);
    setDraft((current) => ({
      ...current,
      name: current.name || found.customerName,
      address: current.address || found.address,
      note: current.note || found.addressNote,
      zoneId: current.zoneId || (zone?.id ?? ''),
      fee: current.fee || (zone ? String(zone.fee) : ''),
    }));
    setHint(t('pos.offp.returning'));
  };

  const advance = (card: OffPremiseCard, to: Fulfillment) => void call(() => advancePosFulfillment({ orderId: card.orderId, expectedVersion: card.version, to }));
  const assign = (card: OffPremiseCard, driverId: string) => void call(() => assignPosDriver({ orderId: card.orderId, expectedVersion: card.version, driverId: driverId === '' ? null : driverId }));

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canOpen ? (
          <Button
            variant="primary"
            size="lg"
            className="min-h-12"
            onClick={() => {
              setDraft(emptyDraft);
              setHint(null);
              setOpen(true);
            }}
          >
            {delivery ? t('pos.offp.newDelivery') : t('pos.offp.newTakeaway')}
          </Button>
        ) : null}
      </div>

      {delivery && board.cashWithDrivers.length > 0 ? (
        <section aria-label={t('pos.offp.cashWithDrivers')} className="rounded-lg border border-danger bg-danger-wash p-3">
          <h2 className="text-base font-semibold">{t('pos.offp.cashWithDrivers')}</h2>
          <ul className="mt-1 flex flex-col gap-1 text-base">
            {board.cashWithDrivers.map((row) => (
              <li key={row.driverId ?? 'none'}>{t('pos.offp.cashRow', { name: row.driverName || t('pos.offp.noDriver'), n: formatNumber(row.count), amount: money(row.amount) })}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {cards.length === 0 ? <EmptyState title={delivery ? t('pos.offp.emptyDelivery') : t('pos.offp.emptyTakeaway')} body={t('pos.offp.emptyHint')} /> : null}
      {pending ? <span className="sr-only" role="status">{t('common.loading')}</span> : null}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const steps = nextSteps(kind, card.fulfillment);
          const blocked =
            (steps.forward === 'PICKED_UP' && !card.paid) || (steps.forward === 'OUT' && card.driverId === null);
          const canPickDriver = delivery && (card.fulfillment === 'NEW' || card.fulfillment === 'PREPARING' || card.fulfillment === 'READY' || card.fulfillment === 'OUT');
          const minutes = elapsedMinutes(new Date(card.seatedAt).getTime(), now);
          return (
            <li key={card.orderId} className={cx('flex flex-col gap-2 rounded-lg border-2 p-3', card.cashWithDriver ? 'border-danger bg-danger-wash' : STATE_TONE[card.fulfillment])}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl font-semibold">{t('pos.offp.queue', { n: formatNumber(card.queueNumber) })}</span>
                <span className="text-sm font-medium">{card.cashWithDriver ? t('pos.offp.cod') : t(`pos.offp.state.${card.fulfillment}`)}</span>
              </div>
              <p className="text-base">
                {card.customerName ? <span className="font-medium">{card.customerName}</span> : null}
                {card.customerPhone ? <span className="ms-2 text-muted" dir="ltr">{card.customerPhone}</span> : null}
              </p>
              {delivery && card.address ? <p className="text-sm text-muted" dir="auto">{card.zoneName ? `${card.zoneName} · ` : ''}{card.address}</p> : null}
              <p className="text-base font-medium">
                {money(card.total)} · {card.paid ? t('pos.offp.paid') : t('pos.offp.unpaid')} · <span className="text-sm text-muted">{elapsedLabel(minutes, text, locale)}</span>
              </p>
              {canPickDriver ? (
                <Select
                  size="lg"
                  aria-label={t('pos.offp.driver')}
                  value={card.driverId ?? ''}
                  disabled={pending}
                  onChange={(e) => assign(card, e.target.value)}
                  options={[
                    { value: '', label: t('pos.offp.chooseDriver') },
                    ...drivers.filter((d) => d.active || d.id === card.driverId).map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              ) : card.driverName ? (
                <p className="text-sm text-muted">{t('pos.offp.driver')}: {card.driverName}</p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-2">
                {steps.forward ? (
                  <Button variant="primary" size="lg" className="min-h-12 flex-1" disabled={pending || blocked} onClick={() => advance(card, steps.forward as Fulfillment)}>
                    {t(`pos.offp.step.${steps.forward}`)}
                  </Button>
                ) : null}
                {steps.back ? (
                  <Button variant="ghost" size="lg" className="min-h-12" disabled={pending} onClick={() => advance(card, steps.back as Fulfillment)}>
                    {t(`pos.offp.back.${steps.back}`)}
                  </Button>
                ) : null}
                <Link href={`/pos/orders/${card.orderId}`} className="inline-flex min-h-12 items-center justify-center rounded-md border border-line-strong px-4 text-base font-medium">
                  {t('pos.offp.open')}
                </Link>
              </div>
              {steps.forward === 'PICKED_UP' && !card.paid ? <p className="text-sm text-muted">{t('pos.offp.pickupHint')}</p> : null}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={delivery ? t('pos.offp.newDelivery') : t('pos.offp.newTakeaway')}
        confirmLabel={t('pos.offp.open')}
        tone="primary"
        onConfirm={async () => {
          const fee = feeOf(draft);
          const base = { customerName: draft.name.trim(), customerPhone: draft.phone };
          const input = delivery
            ? { kind, ...base, address: draft.address, addressNote: draft.note, zoneId: draft.zoneId === '' ? null : draft.zoneId, deliveryFee: draft.fee.trim() === '' ? null : fee }
            : { kind, ...base };
          if (delivery && draft.fee.trim() !== '' && fee === null) return { fields: { deliveryFee: t('pos.order.discountDigits') } };
          const result = await call(() => openPosOffPremiseOrder(input), { quiet: true, keepPage: true, onOk: (data) => router.push(`/pos/orders/${data.orderId}`) });
          if (result.ok) return true;
          const described = describeFailure(t, locale, result.error);
          return { message: described.message, fields: described.fields };
        }}
      >
        {(errors) => <OffPremiseFields kind={kind} draft={draft} onChange={setDraft} zones={zones.filter((z) => z.active)} errors={errors} onPhoneBlur={() => void lookup()} hint={hint} />}
      </ConfirmDialog>
    </div>
  );
}
