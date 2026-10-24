'use client';

import { useState } from 'react';
import { createPosArea, createPosTables, deletePosArea, deletePosTable, movePosTable, renamePosArea } from '@/app/studio/_actions/pos';
import { usePosCall } from '@/app/pos/_ui/use-pos-call';
import { formatNumber } from '@/lib/pos-format';
import type { FloorView } from '@/server/pos/floor';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';

type Area = FloorView['areas'][number];
type Doomed = { kind: 'area'; area: Area } | { kind: 'table'; id: string; number: number };

const whole = (value: string): number => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);

export function FloorSetup({ floor }: { floor: FloorView }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const [doomed, setDoomed] = useState<Doomed | null>(null);

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 sm:px-8">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const name = String(new FormData(form).get('name') ?? '');
          void call(() => createPosArea({ name }), { onOk: () => form.reset() });
        }}
      >
        <Field label={t('pos.floor.newArea')} className="min-w-56 flex-1">
          <Input name="name" size="lg" maxLength={60} required />
        </Field>
        <Button variant="primary" type="submit" size="lg" disabled={pending}>
          {t('pos.floor.addArea')}
        </Button>
      </form>

      {floor.areas.length === 0 ? <EmptyState title={t('pos.floor.empty')} body={t('pos.floor.emptyHint')} /> : null}

      {floor.areas.map((area) => (
        <section key={area.id} className="flex flex-col gap-4 rounded-lg border border-line p-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get('name') ?? '');
              void call(() => renamePosArea({ areaId: area.id, name }));
            }}
          >
            <Field label={t('pos.floor.areaName')} className="min-w-56 flex-1">
              <Input name="name" size="lg" defaultValue={area.name} maxLength={60} required />
            </Field>
            <Button type="submit" variant="secondary" size="lg" disabled={pending}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" size="lg" disabled={pending} onClick={() => setDoomed({ kind: 'area', area })}>
              {t('pos.floor.deleteArea')}
            </Button>
          </form>

          {area.tables.length === 0 ? (
            <p className="text-base text-muted">{t('pos.floor.noTables')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {area.tables.map((table) => (
                <li key={table.id} className="flex items-center gap-1 rounded-md border border-line-strong bg-raised ps-3">
                  <span className="text-base font-semibold" dir="ltr">
                    {formatNumber(table.number)}
                  </span>
                  {floor.areas.length > 1 ? (
                    <Select
                      aria-label={t('pos.floor.moveTable', { n: formatNumber(table.number) })}
                      value={area.id}
                      disabled={pending}
                      onChange={(event) => void call(() => movePosTable({ tableId: table.id, areaId: event.target.value }))}
                      className="w-32"
                      size="lg"
                      options={floor.areas.map((other) => ({ value: other.id, label: other.name }))}
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    aria-label={t('pos.floor.deleteTable', { n: formatNumber(table.number) })}
                    disabled={pending}
                    onClick={() => setDoomed({ kind: 'table', id: table.id, number: table.number })}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              const from = whole(String(data.get('from') ?? ''));
              const to = whole(String(data.get('to') ?? ''));
              void call(() => createPosTables({ areaId: area.id, from, to }), { onOk: () => form.reset() });
            }}
          >
            <Field label={t('pos.floor.from')} className="w-28">
              <Input name="from" size="lg" inputMode="numeric" dir="ltr" required />
            </Field>
            <Field label={t('pos.floor.to')} className="w-28">
              <Input name="to" size="lg" inputMode="numeric" dir="ltr" required />
            </Field>
            <Button type="submit" variant="secondary" size="lg" disabled={pending}>
              {t('pos.floor.addTables')}
            </Button>
          </form>
        </section>
      ))}

      <ConfirmDialog
        open={doomed !== null}
        onOpenChange={(open) => !open && setDoomed(null)}
        title={
          doomed?.kind === 'area'
            ? t('pos.floor.deleteAreaTitle', { name: doomed.area.name })
            : t('pos.floor.deleteTableTitle', { n: formatNumber(doomed?.kind === 'table' ? doomed.number : 0) })
        }
        body={doomed?.kind === 'area' ? t('pos.floor.deleteAreaBody', { n: formatNumber(doomed.area.tables.length) }) : t('pos.floor.deleteTableBody')}
        confirmLabel={t('pos.floor.delete')}
        onConfirm={async () => {
          if (!doomed) return true;
          const result = await call(() => (doomed.kind === 'area' ? deletePosArea({ areaId: doomed.area.id }) : deletePosTable({ tableId: doomed.id })), {
            quiet: true,
          });
          return result.ok ? true : { message: t('pos.floor.deleteRefused') };
        }}
      />
    </div>
  );
}
