'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { setPosRecipe } from '@/app/studio/_actions/pos-stock';
import type { StockUnitKey } from '@/server/domain/pos/stock';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { usePosCall } from '../use-pos-call';
import { OnlineOnlyNote, PickerSelect, QuantityField, useOnline } from './controls';

interface ItemChoice {
  id: string;
  name: string;
  unit: StockUnitKey;
}

interface Row {
  key: number;
  itemId: string;
  /** The amount in the item's smallest unit, null while the field is empty or invalid. */
  quantity: number | null;
  initial?: number;
}

/** A product's recipe: the ingredients one unit uses. Saving replaces the recipe; an empty list removes it. */
export function RecipeEditor({ productId, items, initial }: { productId: string; items: ItemChoice[]; initial: { itemId: string; quantity: number }[] }) {
  const t = useT();
  const { call, pending } = usePosCall();
  const online = useOnline();
  const [next, setNext] = useState(initial.length + 1);
  const [rows, setRows] = useState<Row[]>(initial.map((line, index) => ({ key: index, itemId: line.itemId, quantity: line.quantity, initial: line.quantity })));
  const unitOf = (itemId: string) => items.find((item) => item.id === itemId)?.unit ?? 'PIECE';
  const duplicate = new Set(rows.map((r) => r.itemId)).size !== rows.length;
  const complete = rows.every((r) => r.itemId !== '' && r.quantity !== null && r.quantity > 0);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void call(() => setPosRecipe({ productId, lines: rows.map((r) => ({ itemId: r.itemId, quantity: r.quantity })) }), { onOk: () => toast.success(t('pos.stock.saved')) });
      }}
    >
      {rows.length === 0 ? <p className="text-base text-muted">{t('pos.stock.recipeNone')}</p> : null}
      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.key} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <PickerSelect
              label={t('pos.stock.ingredient')}
              value={row.itemId}
              onChange={(event) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, itemId: event.target.value, quantity: null, initial: undefined } : r)))}
              options={[{ value: '', label: t('pos.stock.chooseItem') }, ...items.map((item) => ({ value: item.id, label: item.name }))]}
            />
            {row.itemId ? (
              <QuantityField key={row.itemId} unit={unitOf(row.itemId)} label={t('pos.stock.perUnit')} initial={row.initial} onChange={(quantity) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, quantity } : r)))} />
            ) : (
              <span />
            )}
            <Button size="lg" className="min-h-12" aria-label={t('pos.stock.removeRow')} onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {duplicate ? <p className="text-sm text-danger">{t('pos.stock.recipeDuplicate')}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          size="lg"
          className="min-h-12"
          disabled={rows.length >= 30}
          onClick={() => {
            setRows((prev) => [...prev, { key: next, itemId: '', quantity: null }]);
            setNext((n) => n + 1);
          }}
          icon={<Plus aria-hidden />}
        >
          {t('pos.stock.addIngredient')}
        </Button>
        <Button type="submit" variant="primary" size="lg" className="min-h-12" pending={pending} disabled={!online || !complete || duplicate}>
          {t('pos.stock.save')}
        </Button>
      </div>
      <OnlineOnlyNote />
    </form>
  );
}
