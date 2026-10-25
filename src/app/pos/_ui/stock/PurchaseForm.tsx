'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createPosPurchase, createPosSupplier, setPosPurchasePaid, voidPosPurchase } from '@/app/studio/_actions/pos-stock';
import { formatNumber, ltr } from '@/lib/pos-format';
import { SUPPLIER_PAY_METHODS, unitCostLabel, type StockUnitKey } from '@/server/domain/pos/stock';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { ConfirmDialog } from '@/studio/ui/ConfirmDialog';
import { Field } from '@/studio/ui/Field';
import { Textarea } from '@/studio/ui/Textarea';
import { usePosCall } from '../use-pos-call';
import { OnlineOnlyNote, PickerSelect, QuantityField, TextInput, useOnline } from './controls';

interface ItemChoice {
  id: string;
  name: string;
  unit: StockUnitKey;
}

interface Line {
  key: number;
  itemId: string;
  quantity: number | null;
  total: string;
}

const METHODS = SUPPLIER_PAY_METHODS;

/** Parses a typed IQD amount: digits only (Arabic-Indic accepted), no separators or decimals; null when not a whole amount. */
function parseAmount(text: string): number | null {
  const latin = text
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  if (!/^\d{1,10}$/.test(latin)) return null;
  const value = Number.parseInt(latin, 10);
  return value <= 2_147_483_647 ? value : null;
}

/** An invoice from a supplier. The key made when the form opens survives a failed save, so a retry is never a second invoice. */
export function PurchaseForm({ suppliers, items, today }: { suppliers: { id: string; name: string }[]; items: ItemChoice[]; today: string }) {
  const t = useT();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [clientKey] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [day, setDay] = useState(today);
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [paid, setPaid] = useState('unpaid');
  const [lines, setLines] = useState<Line[]>([{ key: 0, itemId: '', quantity: null, total: '' }]);
  const [nextKey, setNextKey] = useState(1);
  const unitOf = (itemId: string) => items.find((item) => item.id === itemId)?.unit ?? 'PIECE';
  const amounts = lines.map((line) => parseAmount(line.total));
  const total = amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const complete = supplierId !== '' && lines.every((line, i) => line.itemId !== '' && line.quantity !== null && line.quantity > 0 && amounts[i] !== null);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void call(
          () =>
            createPosPurchase({
              clientKey,
              supplierId,
              invoiceDay: day,
              number,
              note,
              ...(paid === 'unpaid' ? {} : { paidMethod: paid }),
              lines: lines.map((line, i) => ({ itemId: line.itemId, quantity: line.quantity, lineTotal: amounts[i] })),
            }),
          { keepPage: true, onOk: (data) => router.push(`/pos/purchases/${data.invoiceId}`) },
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <PickerSelect label={t('pos.buy.supplier')} value={supplierId} onChange={(event) => setSupplierId(event.target.value)} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <TextInput label={t('pos.buy.day')} type="date" dir="ltr" value={day} onChange={(event) => setDay(event.target.value)} required />
        <TextInput label={t('pos.buy.number')} dir="auto" value={number} onChange={(event) => setNumber(event.target.value)} maxLength={60} hint={t('pos.buy.numberHint')} />
        <PickerSelect label={t('pos.buy.paid')} value={paid} onChange={(event) => setPaid(event.target.value)} options={[{ value: 'unpaid', label: t('pos.buy.unpaid') }, ...METHODS.map((m) => ({ value: m, label: t(`pos.buy.method.${m}`) }))]} />
      </div>
      <p className="text-sm text-muted">{t('pos.buy.drawerNote')}</p>

      <ul className="flex flex-col gap-4">
        {lines.map((line, index) => {
          const amount = amounts[index];
          const unit = unitOf(line.itemId);
          return (
            <li key={line.key} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
              <PickerSelect
                label={t('pos.buy.item')}
                value={line.itemId}
                onChange={(event) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, itemId: event.target.value, quantity: null } : l)))}
                options={[{ value: '', label: t('pos.stock.chooseItem') }, ...items.map((item) => ({ value: item.id, label: item.name }))]}
              />
              {line.itemId ? <QuantityField key={line.itemId} unit={unit} label={t('pos.stock.quantity')} onChange={(quantity) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, quantity } : l)))} /> : <span />}
              <div className="flex min-w-0 flex-col gap-1.5">
                <TextInput label={`${t('pos.buy.lineTotal')} (${t('pos.currency')})`} inputMode="numeric" dir="ltr" autoComplete="off" value={line.total} onChange={(event) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, total: event.target.value } : l)))} />
                {amount !== null && line.quantity ? (
                  <p className="text-sm text-muted">
                    ≈ {ltr(formatNumber(unitCostLabel({ amount, quantity: line.quantity }, unit)))} {t('pos.currency')} / {t(`pos.stock.per.${unit}`)}
                  </p>
                ) : null}
              </div>
              <Button size="lg" className="min-h-12" aria-label={t('pos.stock.removeRow')} disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button
        size="lg"
        className="min-h-12 self-start"
        disabled={lines.length >= 100}
        icon={<Plus aria-hidden />}
        onClick={() => {
          setLines((prev) => [...prev, { key: nextKey, itemId: '', quantity: null, total: '' }]);
          setNextKey((n) => n + 1);
        }}
      >
        {t('pos.buy.addLine')}
      </Button>

      <Textarea aria-label={t('pos.buy.note')} placeholder={t('pos.buy.note')} dir="auto" rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <p className="text-lg font-semibold text-text" data-testid="invoice-total">
        {t('pos.buy.total')}: {ltr(`${formatNumber(total)} ${t('pos.currency')}`)}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" className="min-h-12" pending={pending} disabled={!online || !complete}>
          {t('pos.buy.save')}
        </Button>
        <OnlineOnlyNote />
      </div>
    </form>
  );
}

/** A new supplier: name and phone. */
export function AddSupplierForm() {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <form
      className="grid max-w-xl gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void call(() => createPosSupplier({ name, phone }), {
          onOk: () => {
            setName('');
            setPhone('');
          },
        });
      }}
    >
      <TextInput label={t('pos.buy.supplierName')} dir="auto" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
      <TextInput label={t('pos.buy.supplierPhone')} type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <Button type="submit" size="lg" className="min-h-12 self-start" pending={pending} disabled={!online || name.trim() === ''}>
        {t('pos.buy.addSupplier')}
      </Button>
    </form>
  );
}

/** Mark an invoice paid or unpaid, or void it. */
export function PurchaseActions({ invoiceId, paid, voided }: { invoiceId: string; paid: boolean; voided: boolean }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [method, setMethod] = useState<string>('CASH');
  const [open, setOpen] = useState(false);
  if (voided) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {paid ? (
          <Button size="lg" className="min-h-12" pending={pending} disabled={!online} onClick={() => void call(() => setPosPurchasePaid({ invoiceId, paid: false }))}>
            {t('pos.buy.markUnpaid')}
          </Button>
        ) : (
          <>
            <PickerSelect label={t('pos.buy.paid')} value={method} onChange={(event) => setMethod(event.target.value)} options={METHODS.map((m) => ({ value: m, label: t(`pos.buy.method.${m}`) }))} />
            <Button variant="primary" size="lg" className="min-h-12" pending={pending} disabled={!online} onClick={() => void call(() => setPosPurchasePaid({ invoiceId, paid: true, method }))}>
              {t('pos.buy.markPaid')}
            </Button>
          </>
        )}
        <Button variant="danger" size="lg" className="min-h-12" disabled={!online} onClick={() => setOpen(true)}>
          {t('pos.buy.void')}
        </Button>
      </div>
      <OnlineOnlyNote />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('pos.buy.void')}
        body={t('pos.buy.voidWarning')}
        confirmLabel={t('pos.buy.void')}
        onConfirm={async (form) => {
          const reason = String(form.get('reason') ?? '').trim();
          const result = await call(() => voidPosPurchase({ invoiceId, reason }), { quiet: true });
          if (result.ok) return true;
          const fields = result.error.fields;
          return fields?.reason ? { fields: { reason: fields.reason } } : { message: t('pos.order.actionRefused') };
        }}
      >
        {(errors) => (
          <Field label={t('pos.stock.reason')} error={errors.reason}>
            <Textarea name="reason" dir="auto" rows={2} maxLength={300} />
          </Field>
        )}
      </ConfirmDialog>
    </div>
  );
}
