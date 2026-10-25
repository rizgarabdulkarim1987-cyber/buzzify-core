'use client';

import { useState } from 'react';
import { advancePosFulfillment, assignPosDriver, updatePosOffPremiseDetails } from '@/app/studio/_actions/pos';
import { nextSteps, type Fulfillment } from '@/server/domain/pos/fulfillment';
import type { DriverRow, ZoneRow } from '@/server/pos/delivery-setup';
import type { OrderView } from '@/server/pos/orders';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Select } from '@/studio/ui/Select';
import { feeOf, OffPremiseFields, type Draft } from './OffPremiseFields';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

interface Props {
  order: OrderView;
  zones: ZoneRow[];
  drivers: DriverRow[];
  /** Whether the lines and details can still change (the order is not paid, cancelled or rejected). */
  editable: boolean;
}

const draftOf = (order: OrderView & { offPremise: NonNullable<OrderView['offPremise']> }): Draft => ({
  name: order.offPremise.customerName,
  phone: order.offPremise.customerPhone,
  address: order.offPremise.address,
  note: order.offPremise.addressNote,
  zoneId: order.offPremise.zoneId ?? '',
  fee: String(order.totals.deliveryFee),
});

/** The strip above a takeaway or delivery: where it stands, its next step, the driver and the customer's details. */
export function OffPremiseBar({ order, zones, drivers, editable }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const { call, pending } = usePosCall();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const info = order.offPremise;
  if (info === null || order.kind === 'DINE_IN') return null;

  const kind = order.kind;
  const delivery = kind === 'DELIVERY';
  const steps = nextSteps(kind, info.fulfillment);
  const paid = order.status === 'PAID';
  const blocked = (steps.forward === 'PICKED_UP' && !paid) || (steps.forward === 'OUT' && info.driverId === null);
  const advance = (to: Fulfillment) => void call(() => advancePosFulfillment({ orderId: order.id, expectedVersion: order.version, to }));
  const activeZones = zones.filter((z) => z.active);
  const dialogZones =
    info.zoneId !== null && !activeZones.some((z) => z.id === info.zoneId) ? [...activeZones, { id: info.zoneId, name: info.zoneName, fee: order.totals.deliveryFee, active: true, sortOrder: 0 }] : activeZones;
  const current = draft ?? draftOf({ ...order, offPremise: info });

  return (
    <section aria-label={t('pos.offp.edit')} className="flex flex-col gap-2 rounded-lg border border-line-strong bg-raised p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-semibold">{t(`pos.offp.state.${info.fulfillment}`)}</p>
        <p className="text-sm text-muted">{paid ? t('pos.offp.paid') : t('pos.offp.unpaid')}</p>
      </div>
      <p className="text-base">
        {info.customerName ? <span className="font-medium">{info.customerName}</span> : null}
        {info.customerPhone ? <span className="ms-2 text-muted" dir="ltr">{info.customerPhone}</span> : null}
      </p>
      {delivery ? (
        <div className="flex flex-col gap-0.5 text-sm text-muted">
          <p dir="auto">
            {info.zoneName ? `${info.zoneName} · ` : ''}
            {info.address}
            {info.addressNote ? ` (${info.addressNote})` : ''}
          </p>
          <p>
            {t('pos.offp.fee')}: {money(order.totals.deliveryFee)}
          </p>
        </div>
      ) : null}
      {delivery && info.fulfillment !== 'DELIVERED' ? (
        <Select
          size="lg"
          aria-label={t('pos.offp.driver')}
          value={info.driverId ?? ''}
          disabled={pending}
          onChange={(e) => void call(() => assignPosDriver({ orderId: order.id, expectedVersion: order.version, driverId: e.target.value === '' ? null : e.target.value }))}
          options={[{ value: '', label: t('pos.offp.chooseDriver') }, ...drivers.filter((d) => d.active || d.id === info.driverId).map((d) => ({ value: d.id, label: d.name }))]}
        />
      ) : delivery && info.driverName ? (
        <p className="text-sm text-muted">{t('pos.offp.driver')}: {info.driverName}</p>
      ) : null}
      {delivery && drivers.length === 0 ? <p className="text-sm text-muted">{t('pos.offp.noDrivers')}</p> : null}
      <div className="flex flex-wrap gap-2">
        {steps.forward ? (
          <Button variant="primary" size="lg" className="min-h-12 flex-1" disabled={pending || blocked} onClick={() => advance(steps.forward as Fulfillment)}>
            {t(`pos.offp.step.${steps.forward}`)}
          </Button>
        ) : null}
        {steps.back ? (
          <Button variant="ghost" size="lg" className="min-h-12" disabled={pending} onClick={() => advance(steps.back as Fulfillment)}>
            {t(`pos.offp.back.${steps.back}`)}
          </Button>
        ) : null}
        {editable ? (
          <Button
            variant="ghost"
            size="lg"
            className="min-h-12"
            disabled={pending}
            onClick={() => {
              setDraft(draftOf({ ...order, offPremise: info }));
              setEditing(true);
            }}
          >
            {t('pos.offp.edit')}
          </Button>
        ) : null}
        {delivery ? (
          <a className="inline-flex min-h-12 items-center px-4 text-base text-muted underline underline-offset-2" href={`/pos/orders/${order.id}/delivery-slip`} target="_blank" rel="noreferrer">
            {t('pos.offp.slipLink')}
          </a>
        ) : null}
      </div>
      {steps.forward === 'PICKED_UP' && !paid ? <p className="text-sm text-muted">{t('pos.offp.pickupHint')}</p> : null}

      <ConfirmDialog
        open={editing}
        onOpenChange={setEditing}
        title={t('pos.offp.edit')}
        confirmLabel={t('common.save')}
        tone="primary"
        onConfirm={async () => {
          const fee = feeOf(current);
          if (delivery && current.fee.trim() !== '' && fee === null) return { fields: { deliveryFee: t('pos.order.discountDigits') } };
          const result = await call(
            () =>
              updatePosOffPremiseDetails({
                orderId: order.id,
                expectedVersion: order.version,
                customerName: current.name.trim(),
                customerPhone: current.phone,
                ...(delivery
                  ? {
                      address: current.address,
                      addressNote: current.note,
                      ...((current.zoneId === '' ? null : current.zoneId) !== info.zoneId ? { zoneId: current.zoneId === '' ? null : current.zoneId } : {}),
                      ...(fee !== null && fee !== order.totals.deliveryFee ? { deliveryFee: fee } : {}),
                    }
                  : {}),
              }),
            { quiet: true },
          );
          if (result.ok) return true;
          const described = describeFailure(t, locale, result.error);
          return { message: described.message, fields: described.fields };
        }}
      >
        {(errors) => <OffPremiseFields kind={kind} draft={current} onChange={setDraft} zones={dialogZones} errors={errors} />}
      </ConfirmDialog>
    </section>
  );
}
