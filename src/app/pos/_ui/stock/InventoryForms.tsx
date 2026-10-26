'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { adjustPosStock, createPosItem, recordPosStockCount, recordPosWaste, updatePosItem } from '@/app/studio/_actions/pos-stock';
import { formatNumber } from '@/lib/pos-format';
import { formatQuantity, MAX_MOVEMENT, parseQuantity, type DisplayUnit, type StockUnitKey } from '@/server/domain/pos/stock';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { usePosCall } from '../use-pos-call';
import { OnlineOnlyNote, PickerSelect, QuantityField, TextInput, useOnline } from './controls';

const UNITS: StockUnitKey[] = ['GRAM', 'MILLILITER', 'PIECE'];

/** Writes a quantity the way the lists do: Latin digits, kg or l from 1000 up, left to right. */
export function useQuantityText(): (quantity: number, unit: StockUnitKey) => string {
  const t = useT();
  return (quantity, unit) => {
    const { value, unit: shown } = formatQuantity(quantity, unit);
    return `⁦${value} ${t(`pos.stock.unit.${shown}`)}⁩`;
  };
}

export function AddItemForm() {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<StockUnitKey>('GRAM');
  const [reorder, setReorder] = useState<number | null>(null);
  const [round, setRound] = useState(0);

  return (
    <section aria-labelledby="stock-add" className="flex flex-col gap-4 border-t border-line pt-6">
      <h2 id="stock-add" className="text-base font-semibold text-text">
        {t('pos.stock.addTitle')}
      </h2>
      <form
        className="grid max-w-xl gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void call(() => createPosItem({ name, unit, reorderLevel: reorder ?? 0 }), {
            onOk: () => {
              toast.success(t('pos.stock.added'));
              setName('');
              setReorder(null);
              setRound((n) => n + 1);
            },
          });
        }}
      >
        <TextInput label={t('pos.stock.name')} dir="auto" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
        <PickerSelect label={t('pos.stock.unitKind')} value={unit} onChange={(event) => setUnit(event.target.value as StockUnitKey)} options={UNITS.map((u) => ({ value: u, label: t(`pos.stock.unitKind.${u}`) }))} />
        <QuantityField key={unit} unit={unit} label={t('pos.stock.reorderLevel')} onChange={setReorder} resetKey={round} />
        <div className="flex items-end">
          <Button type="submit" size="lg" className="min-h-12" pending={pending} disabled={!online || name.trim() === ''}>
            {t('pos.stock.add')}
          </Button>
        </div>
      </form>
      <OnlineOnlyNote />
    </section>
  );
}

/** Adjust and waste, side by side on an item's page. */
export function MovementForms({ itemId, unit }: { itemId: string; unit: StockUnitKey }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [adjustQty, setAdjustQty] = useState<number | null>(null);
  const [adjustReason, setAdjustReason] = useState('');
  const [wasteQty, setWasteQty] = useState<number | null>(null);
  const [wasteReason, setWasteReason] = useState('');
  const [round, setRound] = useState(0);
  const done = () => {
    toast.success(t('pos.stock.saved'));
    setRound((n) => n + 1);
  };

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void call(() => adjustPosStock({ itemId, quantity: adjustQty, reason: adjustReason }), {
            onOk: () => {
              setAdjustReason('');
              done();
            },
          });
        }}
      >
        <h2 className="text-base font-semibold text-text">{t('pos.stock.adjust')}</h2>
        <p className="text-sm text-muted">{t('pos.stock.adjustHelp')}</p>
        <QuantityField unit={unit} label={t('pos.stock.quantity')} allowNegative onChange={setAdjustQty} resetKey={round} />
        <TextInput label={t('pos.stock.reason')} dir="auto" value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} maxLength={300} />
        <Button type="submit" size="lg" className="min-h-12 self-start" pending={pending} disabled={!online || adjustQty === null || adjustQty === 0 || adjustReason.trim() === ''}>
          {t('pos.stock.adjust')}
        </Button>
      </form>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void call(() => recordPosWaste({ itemId, quantity: wasteQty, reason: wasteReason }), {
            onOk: () => {
              setWasteReason('');
              done();
            },
          });
        }}
      >
        <h2 className="text-base font-semibold text-text">{t('pos.stock.waste')}</h2>
        <p className="text-sm text-muted">{t('pos.stock.wasteHelp')}</p>
        <QuantityField unit={unit} label={t('pos.stock.quantity')} onChange={setWasteQty} resetKey={round} />
        <TextInput label={t('pos.stock.reason')} dir="auto" value={wasteReason} onChange={(event) => setWasteReason(event.target.value)} maxLength={300} />
        <Button type="submit" size="lg" className="min-h-12 self-start" pending={pending} disabled={!online || wasteQty === null || wasteQty === 0 || wasteReason.trim() === ''}>
          {t('pos.stock.waste')}
        </Button>
      </form>
      <div className="md:col-span-2">
        <OnlineOnlyNote />
      </div>
    </div>
  );
}

/** Rename, reorder level and switching an item off. */
export function ItemSettingsForm({ itemId, name: initialName, active, unit, reorderLevel }: { itemId: string; name: string; active: boolean; unit: StockUnitKey; reorderLevel: number }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [name, setName] = useState(initialName);
  const [reorder, setReorder] = useState<number | null>(reorderLevel);
  const quantityText = useQuantityText();

  return (
    <form
      className="grid max-w-xl gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void call(() => updatePosItem({ itemId, name, ...(reorder === null ? {} : { reorderLevel: reorder }) }), { onOk: () => toast.success(t('pos.stock.saved')) });
      }}
    >
      <TextInput label={t('pos.stock.name')} dir="auto" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      <QuantityField unit={unit} label={`${t('pos.stock.reorderLevel')} (${quantityText(reorderLevel, unit)})`} onChange={setReorder} />
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <Button type="submit" size="lg" className="min-h-12" pending={pending} disabled={!online || name.trim() === ''}>
          {t('pos.stock.save')}
        </Button>
        <Button
          size="lg"
          className="min-h-12"
          pending={pending}
          disabled={!online}
          onClick={() => void call(() => updatePosItem({ itemId, active: !active }), { onOk: () => toast.success(t('pos.stock.saved')) })}
        >
          {active ? t('pos.stock.switchOff') : t('pos.stock.switchOn')}
        </Button>
      </div>
    </form>
  );
}

interface CountRow {
  id: string;
  name: string;
  unit: StockUnitKey;
  onHand: number;
}

/** The count sheet: an empty field means "not counted". On a conflict the typed numbers stay, so only a re-save is needed. */
export function CountSheet({ items }: { items: CountRow[] }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const quantityText = useQuantityText();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [displays, setDisplays] = useState<Record<string, DisplayUnit>>({});
  const [note, setNote] = useState('');

  const counted = items.flatMap((item) => {
    const text = texts[item.id];
    if (text === undefined || text.trim() === '') return [];
    const display = displays[item.id] ?? (item.unit === 'GRAM' ? 'kg' : item.unit === 'MILLILITER' ? 'l' : 'pcs');
    return [{ item, value: parseQuantity(text, item.unit, display) }];
  });
  const invalid = counted.some((entry) => entry.value === null || entry.value < 0 || entry.value > MAX_MOVEMENT);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void call(() => recordPosStockCount({ note, lines: counted.map((entry) => ({ itemId: entry.item.id, counted: entry.value })) }), {
          onOk: (data) => {
            toast.success(t('pos.stock.countSaved').replace('{n}', formatNumber(data.changed)));
            setTexts({});
            setNote('');
          },
        });
      }}
    >
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {items.map((item) => {
          const units: DisplayUnit[] = item.unit === 'GRAM' ? ['kg', 'g'] : item.unit === 'MILLILITER' ? ['l', 'ml'] : ['pcs'];
          const display = displays[item.id] ?? units[0]!;
          return (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-base text-text" dir="auto">
                  {item.name}
                </span>
                <span className="text-sm text-muted">
                  {t('pos.stock.held')}: {quantityText(item.onHand, item.unit)}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  aria-label={`${t('pos.stock.counted')}: ${item.name}`}
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  value={texts[item.id] ?? ''}
                  onChange={(event) => setTexts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  className="min-h-12 w-28 rounded-md border border-line-strong bg-raised px-3 text-base text-text"
                />
                {units.length > 1 ? (
                  <select aria-label={t('pos.stock.unitPicker')} value={display} onChange={(event) => setDisplays((prev) => ({ ...prev, [item.id]: event.target.value as DisplayUnit }))} className="min-h-12 w-20 rounded-md border border-line-strong bg-raised px-2 text-base text-text">
                    {units.map((u) => (
                      <option key={u} value={u}>
                        {t(`pos.stock.unit.${u}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="inline-flex min-h-12 w-20 items-center justify-center text-base text-muted">{t('pos.stock.unit.pcs')}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <TextInput label={t('pos.stock.note')} dir="auto" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      {invalid ? <p className="text-sm text-danger">{t('pos.stock.quantityInvalid')}</p> : null}
      <Button type="submit" size="lg" className="min-h-12 self-start" pending={pending} disabled={!online || counted.length === 0 || invalid}>
        {t('pos.stock.saveCount')}
      </Button>
      <OnlineOnlyNote />
    </form>
  );
}
