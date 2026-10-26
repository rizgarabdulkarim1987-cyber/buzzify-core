'use client';

import { FileText, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createPosPurchase } from '@/app/studio/_actions/pos-stock';
import { formatNumber, ltr } from '@/lib/pos-format';
import type { SupplyDraft } from '@/server/ai/supply';
import { SUPPLY_FILE_MAX_BYTES } from '@/server/ai/supply-limits';
import type { StockUnitKey } from '@/server/domain/pos/stock';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Textarea } from '@/studio/ui/Textarea';
import { usePosCall } from '../use-pos-call';
import { OnlineOnlyNote, PickerSelect, QuantityField, TextInput, useOnline } from '../stock/controls';

interface ItemChoice {
  id: string;
  name: string;
  unit: StockUnitKey;
}

interface Line {
  key: number;
  itemId: string;
  /** What the invoice said for this line, for the person to compare with. */
  name: string;
  quantityText: string;
  /** The quantity the AI read, for the field to start with; undefined once the person chose another item. */
  startQuantity?: number;
  quantity: number | null;
  total: string;
}

/** Parses a typed IQD amount: digits only (Arabic-Indic accepted); null when not a whole amount. */
function parseAmount(text: string): number | null {
  const latin = text
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  if (!/^\d{1,10}$/.test(latin)) return null;
  const value = Number.parseInt(latin, 10);
  return value <= 2_147_483_647 ? value : null;
}

/** The line with another item chosen: the quantity the AI read was for the item it matched, so it starts empty. */
function changeItem(line: Line, itemId: string): Line {
  const { startQuantity, ...rest } = line;
  void startQuantity;
  return { ...rest, itemId, quantity: null };
}

type Extracted ={ ok: true; draft: SupplyDraft } | { ok: false; code: string };

/**
 * Supply entry: a photo, a PDF or pasted text is read by the AI into a draft; the person then sees every line next to what
 * the invoice said, fixes it and saves through the same action as the ordinary purchase form. Nothing here saves by itself.
 */
export function SupplyEntry({ suppliers, items, today }: { suppliers: { id: string; name: string }[]; items: ItemChoice[]; today: string }) {
  const t = useT();
  const online = useOnline();
  const [draft, setDraft] = useState<SupplyDraft | null>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function read() {
    if (!file && text.trim() === '') return setError(t('pos.ai.supply.chooseInput'));
    if (file && file.size > SUPPLY_FILE_MAX_BYTES) return setError(t('pos.ai.error.tooLarge'));
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (file) form.set('file', file);
    else form.set('text', text);
    try {
      const response = await fetch('/api/pos/ai/supply-extract', { method: 'POST', body: form });
      const body = (await response.json()) as { data?: Extracted; error?: { message?: string } };
      if (body.data?.ok) setDraft(body.data.draft);
      else if (body.data) setError(t(`pos.ai.error.${body.data.code}`));
      else setError(body.error?.message === 'tooLarge' ? t('pos.ai.error.tooLarge') : t('pos.ai.error.invalid'));
    } catch {
      setError(t('pos.ai.error.aiUnavailable'));
    }
    setBusy(false);
  }

  if (draft) return <Review draft={draft} suppliers={suppliers} items={items} today={today} onStartOver={() => setDraft(null)} />;

  return (
    <form
      className="flex max-w-2xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void read();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="supply-file" className="text-sm font-medium text-text">
          {t('pos.ai.supply.file')}
        </label>
        <input
          id="supply-file"
          ref={fileInput}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="min-h-12 w-full rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-text file:me-3 file:min-h-10 file:rounded-md file:border-0 file:bg-ink file:px-3 file:text-on-ink"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="supply-text" className="text-sm font-medium text-text">
          {t('pos.ai.supply.text')}
        </label>
        <Textarea id="supply-text" dir="auto" rows={6} maxLength={20000} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" className="min-h-12" pending={busy} disabled={!online} icon={<FileText aria-hidden />}>
          {busy ? t('pos.ai.supply.reading') : t('pos.ai.supply.read')}
        </Button>
        <OnlineOnlyNote />
      </div>
      <p className="text-sm text-muted">{t('pos.ai.checkNote')}</p>
    </form>
  );
}

function Review({ draft, suppliers, items, today, onStartOver }: { draft: SupplyDraft; suppliers: { id: string; name: string }[]; items: ItemChoice[]; today: string; onStartOver: () => void }) {
  const t = useT();
  const router = useRouter();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [clientKey] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState(draft.supplierId ?? '');
  const [day, setDay] = useState(draft.invoiceDay ?? today);
  const [number, setNumber] = useState(draft.invoiceNumber ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    draft.lines.map((line, index) => ({
      key: index,
      itemId: line.itemId ?? '',
      name: line.name,
      quantityText: line.quantityText,
      ...(line.quantity === null ? {} : { startQuantity: line.quantity }),
      quantity: line.quantity,
      total: line.lineTotal === null ? '' : String(line.lineTotal),
    })),
  );
  const [nextKey, setNextKey] = useState(draft.lines.length);
  const unitOf = (itemId: string) => items.find((item) => item.id === itemId)?.unit ?? 'PIECE';
  const amounts = lines.map((line) => parseAmount(line.total));
  const sum = amounts.reduce<number>((acc, amount) => acc + (amount ?? 0), 0);
  const mismatch = draft.invoiceTotal !== null && amounts.every((a) => a !== null) && sum !== draft.invoiceTotal;
  const complete = supplierId !== '' && lines.length > 0 && lines.every((line, i) => line.itemId !== '' && line.quantity !== null && line.quantity > 0 && amounts[i] !== null);

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
              note: '',
              lines: lines.map((line, i) => ({ itemId: line.itemId, quantity: line.quantity, lineTotal: amounts[i] })),
            }),
          { keepPage: true, onOk: (data) => router.push(`/pos/purchases/${data.invoiceId}`) },
        );
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-text">{t('pos.ai.supply.review')}</h2>
        <p className="text-base text-muted">{t('pos.ai.supply.reviewNote')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <PickerSelect
            label={t('pos.buy.supplier')}
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            options={[{ value: '', label: t('pos.ai.supply.chooseSupplier') }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
          {supplierId === '' && draft.supplierName ? <p className="text-sm text-muted">{t('pos.ai.supply.supplierNotFound', { name: draft.supplierName })}</p> : null}
        </div>
        <TextInput label={t('pos.buy.day')} type="date" dir="ltr" value={day} onChange={(event) => setDay(event.target.value)} required />
        <TextInput label={t('pos.buy.number')} dir="auto" value={number} onChange={(event) => setNumber(event.target.value)} maxLength={60} />
      </div>

      <ul className="flex flex-col gap-4">
        {lines.map((line, index) => {
          const unit = unitOf(line.itemId);
          return (
            <li key={line.key} className="flex flex-col gap-3 rounded-lg border border-line p-3">
              {line.name || line.quantityText ? (
                <p className="text-sm text-muted [overflow-wrap:anywhere]" dir="auto">
                  {t('pos.ai.supply.readAs', { text: [line.name, line.quantityText].filter(Boolean).join(' · ') })}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
                <div className="flex flex-col gap-1.5">
                  <PickerSelect
                    label={t('pos.buy.item')}
                    value={line.itemId}
                    onChange={(event) => setLines((prev) => prev.map((l) => (l.key === line.key ? changeItem(l, event.target.value) : l)))}
                    options={[{ value: '', label: t('pos.stock.chooseItem') }, ...items.map((item) => ({ value: item.id, label: item.name }))]}
                  />
                  {line.itemId === '' ? <p className="text-sm text-muted">{t('pos.ai.supply.itemNotFound')}</p> : null}
                </div>
                {line.itemId ? (
                  <div className="flex flex-col gap-1.5">
                    <QuantityField
                      key={`${line.key}-${line.itemId}`}
                      unit={unit}
                      label={t('pos.stock.quantity')}
                      {...(line.startQuantity === undefined ? {} : { initial: line.startQuantity })}
                      onChange={(quantity) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, quantity } : l)))}
                    />
                    {line.quantity === null ? <p className="text-sm text-muted">{t('pos.ai.supply.checkQuantity')}</p> : null}
                  </div>
                ) : (
                  <span />
                )}
                <TextInput
                  label={`${t('pos.buy.lineTotal')} (${t('pos.currency')})`}
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="off"
                  value={line.total}
                  onChange={(event) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, total: event.target.value } : l)))}
                />
                <Button size="lg" className="min-h-12" aria-label={t('pos.stock.removeRow')} disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {amounts[index] === null && line.total.trim() !== '' ? (
                <p role="alert" className="text-sm text-danger">
                  {t('pos.stock.quantityInvalid')}
                </p>
              ) : null}
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
          setLines((prev) => [...prev, { key: nextKey, itemId: '', name: '', quantityText: '', quantity: null, total: '' }]);
          setNextKey((n) => n + 1);
        }}
      >
        {t('pos.buy.addLine')}
      </Button>

      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-text" data-testid="invoice-total">
          {t('pos.buy.total')}: {ltr(`${formatNumber(sum)} ${t('pos.currency')}`)}
        </p>
        {mismatch ? (
          <p role="alert" className="text-sm text-danger">
            {t('pos.ai.supply.mismatch', { total: ltr(formatNumber(draft.invoiceTotal ?? 0)), sum: ltr(formatNumber(sum)) })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" className="min-h-12" pending={pending} disabled={!online || !complete}>
          {t('pos.buy.save')}
        </Button>
        <Button size="lg" className="min-h-12" disabled={pending} onClick={onStartOver}>
          {t('pos.ai.supply.startOver')}
        </Button>
        <OnlineOnlyNote />
      </div>
    </form>
  );
}
