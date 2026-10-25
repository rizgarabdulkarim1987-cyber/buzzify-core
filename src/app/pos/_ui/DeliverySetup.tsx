'use client';

import { useState } from 'react';
import { createPosDriver, createPosZone, deletePosZone, updatePosDriver, updatePosZone } from '@/app/studio/_actions/pos';
import { formatNumber } from '@/lib/pos-format';
import { typedAmount } from '@/lib/pos-view';
import type { DriverRow, ZoneRow } from '@/server/pos/delivery-setup';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { useMoney } from './money';
import { usePosCall } from './use-pos-call';

const fee = (value: FormDataEntryValue | null): number => typedAmount(String(value ?? '')) ?? Number.NaN;

/** Zones (with their fee) and drivers (a name and a phone). A driver is never deleted: switching one off keeps its history. */
export function DeliverySetup({ zones, drivers }: { zones: ZoneRow[]; drivers: DriverRow[] }) {
  const t = useT();
  const money = useMoney();
  const { call, pending } = usePosCall();
  const [doomed, setDoomed] = useState<ZoneRow | null>(null);

  return (
    <div className="flex flex-col gap-8 px-4 pb-8 sm:px-8">
      <section aria-labelledby="zones-title" className="flex flex-col gap-4">
        <h2 id="zones-title" className="text-xl font-semibold text-text">
          {t('pos.delivery.zones')}
        </h2>
        <p className="text-base text-muted">{t('pos.delivery.zonesHint')}</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void call(() => createPosZone({ name: String(data.get('name') ?? ''), fee: fee(data.get('fee')) }), { onOk: () => form.reset() });
          }}
        >
          <Field label={t('pos.delivery.zoneName')} className="min-w-56 flex-1">
            <Input name="name" size="lg" maxLength={60} dir="auto" required />
          </Field>
          <Field label={t('pos.delivery.fee')} className="w-36">
            <Input name="fee" size="lg" inputMode="numeric" dir="ltr" required defaultValue="0" />
          </Field>
          <Button variant="primary" type="submit" size="lg" className="min-h-12" disabled={pending}>
            {t('pos.delivery.addZone')}
          </Button>
        </form>
        {zones.length === 0 ? <EmptyState title={t('pos.delivery.noZones')} body={t('pos.delivery.noZonesHint')} /> : null}
        <ul className="flex flex-col gap-3">
          {zones.map((zone) => (
            <li key={zone.id} className="rounded-lg border border-line p-3">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void call(() => updatePosZone({ zoneId: zone.id, name: String(data.get('name') ?? ''), fee: fee(data.get('fee')) }));
                }}
              >
                <Field label={t('pos.delivery.zoneName')} className="min-w-56 flex-1">
                  <Input name="name" size="lg" defaultValue={zone.name} maxLength={60} dir="auto" required />
                </Field>
                <Field label={t('pos.delivery.fee')} className="w-36">
                  <Input name="fee" size="lg" inputMode="numeric" dir="ltr" defaultValue={String(zone.fee)} required />
                </Field>
                <Button type="submit" variant="secondary" size="lg" className="min-h-12" disabled={pending}>
                  {t('common.save')}
                </Button>
                <Button type="button" variant="ghost" size="lg" className="min-h-12" disabled={pending} onClick={() => void call(() => updatePosZone({ zoneId: zone.id, active: !zone.active }))}>
                  {zone.active ? t('pos.delivery.deactivate') : t('pos.delivery.activate')}
                </Button>
                <Button type="button" variant="ghost" size="lg" className="min-h-12" disabled={pending} onClick={() => setDoomed(zone)}>
                  {t('pos.delivery.delete')}
                </Button>
              </form>
              <p className="mt-2 text-sm text-muted">
                {zone.active ? t('pos.delivery.active') : t('pos.delivery.inactive')} · {money(zone.fee)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="drivers-title" className="flex flex-col gap-4">
        <h2 id="drivers-title" className="text-xl font-semibold text-text">
          {t('pos.delivery.drivers')}
        </h2>
        <p className="text-base text-muted">{t('pos.delivery.driversHint')}</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void call(() => createPosDriver({ name: String(data.get('name') ?? ''), phone: String(data.get('phone') ?? '') }), { onOk: () => form.reset() });
          }}
        >
          <Field label={t('pos.delivery.driverName')} className="min-w-56 flex-1">
            <Input name="name" size="lg" maxLength={60} dir="auto" required />
          </Field>
          <Field label={t('pos.delivery.phone')} className="w-56">
            <Input name="phone" size="lg" inputMode="tel" dir="ltr" maxLength={40} />
          </Field>
          <Button variant="primary" type="submit" size="lg" className="min-h-12" disabled={pending}>
            {t('pos.delivery.addDriver')}
          </Button>
        </form>
        {drivers.length === 0 ? <EmptyState title={t('pos.delivery.noDrivers')} body={t('pos.delivery.noDriversHint')} /> : null}
        <ul className="flex flex-col gap-3">
          {drivers.map((driver) => (
            <li key={driver.id} className="rounded-lg border border-line p-3">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void call(() => updatePosDriver({ driverId: driver.id, name: String(data.get('name') ?? ''), phone: String(data.get('phone') ?? '') }));
                }}
              >
                <Field label={t('pos.delivery.driverName')} className="min-w-56 flex-1">
                  <Input name="name" size="lg" defaultValue={driver.name} maxLength={60} dir="auto" required />
                </Field>
                <Field label={t('pos.delivery.phone')} className="w-56">
                  <Input name="phone" size="lg" inputMode="tel" dir="ltr" defaultValue={driver.phone} maxLength={40} />
                </Field>
                <Button type="submit" variant="secondary" size="lg" className="min-h-12" disabled={pending}>
                  {t('common.save')}
                </Button>
                <Button type="button" variant="ghost" size="lg" className="min-h-12" disabled={pending} onClick={() => void call(() => updatePosDriver({ driverId: driver.id, active: !driver.active }))}>
                  {driver.active ? t('pos.delivery.deactivate') : t('pos.delivery.activate')}
                </Button>
              </form>
              <p className="mt-2 text-sm text-muted">{driver.active ? t('pos.delivery.active') : t('pos.delivery.inactive')}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{t('pos.delivery.count', { zones: formatNumber(zones.length), drivers: formatNumber(drivers.length) })}</p>
      </section>

      <ConfirmDialog
        open={doomed !== null}
        onOpenChange={(open) => !open && setDoomed(null)}
        title={t('pos.delivery.deleteTitle', { name: doomed?.name ?? '' })}
        body={t('pos.delivery.deleteBody')}
        confirmLabel={t('pos.delivery.delete')}
        onConfirm={async () => {
          if (!doomed) return true;
          const result = await call(() => deletePosZone({ zoneId: doomed.id }), { quiet: true });
          return result.ok ? true : { message: t('pos.order.actionRefused') };
        }}
      />
    </div>
  );
}
