'use client';

import { Ban, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { formatMinor, unitOf, type CartLine, type Currency, type Estimate } from '../sell-logic';
import { Chip, Num } from '../sell-parts';

/** What the server sent for a line's cost and profit (minor units as text). Absent unless the person may see cost. */
export interface LineCost {
  costMinor: string;
  profitMinor: string;
}

export interface SaleLinesTableProps {
  lines: CartLine[];
  /** Per line: `estimateCart(...).lines` (gross, discount, total after discount). */
  results: Estimate['lines'];
  currency: Currency;
  /** The key of the selected line, or null. */
  selected: string | null;
  onSelect: (key: string) => void;
  /** Sets a line's quantity (the screen's keys use it for + and -). */
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  /** Cost and profit columns exist only for those who may see them (pharmacist, owner). */
  canSeeCost: boolean;
  /** Price edit is for pharmacist and owner; the table only records it for the price cell. */
  canEditPrice: boolean;
  /** Products whose lines together ask for more than the sellable stock (`overSellable`). */
  over?: ReadonlySet<string>;
  /** Cost data by line key; only ever passed when `canSeeCost`. Without it the cost cells stay empty. */
  costs?: Readonly<Record<string, LineCost>>;
}

const COLUMNS = ['row', 'code', 'name', 'qty', 'unit', 'price', 'total', 'discount', 'netPrice', 'netTotal', 'batch', 'expiry', 'balance'] as const;
const COST_COLUMNS = ['cost', 'profit'] as const;
/** Fixed widths in rem for every column but the name, which takes what is left (and truncates). */
const WIDTH: Record<string, string> = {
  row: '2.5rem',
  code: '6rem',
  qty: '4.5rem',
  unit: '5.5rem',
  price: '6.5rem',
  total: '6.5rem',
  discount: '5.5rem',
  netPrice: '6.5rem',
  netTotal: '7rem',
  batch: '6rem',
  expiry: '5.5rem',
  balance: '5rem',
  cost: '6.5rem',
  profit: '6.5rem',
};
const NUMERIC = new Set(['qty', 'price', 'total', 'discount', 'netPrice', 'netTotal', 'balance', 'cost', 'profit']);
const MUTED = '—';

/**
 * The cashier's sale lines (docs/pharmacy/prototypes/cashier-layouts-2026-11-05.html): one row per line, the thirteen
 * columns of the spec, cost and profit after them for those who may see cost. Selection is a state of the row
 * (`aria-selected`); the arrow, +, - and Delete keys are the screen's. A blocked or over-stock line is marked in words in
 * its name cell. The table scrolls in its own container; a long name truncates (the full name is its `title`).
 */
export function SaleLinesTable({ lines, results, currency, selected, onSelect, onRemove, canSeeCost, canEditPrice, over, costs }: SaleLinesTableProps) {
  const t = useT();
  const columns: readonly string[] = canSeeCost ? [...COLUMNS, ...COST_COLUMNS] : COLUMNS;
  const selectedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    // Keeps the selected row in view when the keys move it down a long cart (not every environment can scroll).
    selectedRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const money = (minor: bigint): ReactNode => <Num>{formatMinor(minor, currency)}</Num>;
  const moneyText = (text: string | undefined): ReactNode => {
    if (text === undefined) return null;
    try {
      return money(BigInt(text));
    } catch {
      return null;
    }
  };

  return (
    <div className="max-h-[60vh] min-h-[210px] min-w-0 overflow-auto rounded-ph-xl border border-ph-line bg-ph-card" data-testid="sale-lines-scroll">
      <table role="grid" aria-label={t('pharmacy.cashier.lines.table')} className="w-full min-w-[68rem] table-fixed border-collapse text-sm tabular-nums text-ph-text">
        <colgroup>
          {columns.map((c) => (
            <col key={c} style={c === 'name' ? undefined : { width: WIDTH[c] }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-ph-canvas">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className={`border-b border-ph-line px-2 py-2 text-xs font-semibold text-ph-muted ${NUMERIC.has(c) ? 'text-end' : 'text-start'}`}>
                {t(`pharmacy.cashier.col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const unit = unitOf(line);
            const result = results.find((r) => r.key === line.key);
            const priced = result !== undefined && !result.unpriced && !result.invalid;
            const batch = line.batchId ? line.batches.find((b) => b.batchId === line.batchId) : line.batches[0];
            const isSelected = line.key === selected;
            const tail = (key: string, text: ReactNode, extra = '') => (
              <td key={key} className={`px-2 py-1.5 align-middle ${NUMERIC.has(key) ? 'text-end' : 'text-start'} ${extra}`}>
                {text}
              </td>
            );
            const cost = costs?.[line.key];
            // The unit price after the line's discount: a plain division of the line total, an estimate like the rest.
            const netUnit = priced && line.qty > 0 ? result.totalMinor / BigInt(line.qty) : null;
            return (
              <tr
                key={line.key}
                ref={isSelected ? selectedRow : undefined}
                aria-selected={isSelected}
                data-testid="sale-line"
                data-blocked={line.blocked ?? undefined}
                data-price-editable={canEditPrice ? 'true' : undefined}
                onClick={() => onSelect(line.key)}
                className={`cursor-pointer border-b border-ph-line align-middle ${isSelected ? 'bg-ph-g1 outline outline-2 -outline-offset-2 outline-ph-accent' : 'hover:bg-ph-canvas'}`}
              >
                {tail('row', index + 1, 'text-ph-muted')}
                {tail('code', MUTED, 'text-ph-muted')}
                <td key="name" className="min-w-0 px-2 py-1.5 align-middle">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 flex-1 truncate font-semibold" dir="auto" title={line.detail ? `${line.name} · ${line.detail}` : line.name} data-testid="line-name">
                      {line.name}
                    </span>
                    <button
                      type="button"
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-ph-xl text-ph-muted hover:bg-ph-line disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label={t('pharmacy.sell.cart.remove', { name: line.name })}
                      data-testid="line-remove"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemove(line.key);
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                  {(line.blocked || over?.has(line.productId) || (unit.priceMinor === null && !line.blocked)) && (
                    <div className="flex flex-wrap gap-1 pb-1">
                      {line.blocked && (
                        <Chip icon={<Ban aria-hidden />} tone="danger" look="ph" testId="line-blocked">
                          {t(`pharmacy.sell.line.blocked.${line.blocked}`)}
                        </Chip>
                      )}
                      {unit.priceMinor === null && !line.blocked && (
                        <Chip icon={<Ban aria-hidden />} tone="danger" look="ph" testId="line-noprice">
                          {t('pharmacy.sell.chip.noPrice')}
                        </Chip>
                      )}
                      {over?.has(line.productId) && (
                        <Chip icon={<TriangleAlert aria-hidden />} tone="danger" look="ph" testId="line-over">
                          {t('pharmacy.sell.chip.over', { qty: line.sellableQty })}
                        </Chip>
                      )}
                    </div>
                  )}
                </td>
                {tail('qty', line.qty, 'font-bold')}
                {tail('unit', <span className="block truncate" dir="auto" title={unit.label}>{unit.label}</span>)}
                {tail('price', unit.priceMinor === null ? MUTED : moneyText(unit.priceMinor))}
                {tail('total', priced ? money(result.grossMinor) : MUTED)}
                {tail('discount', priced && result.discountMinor > 0n ? money(result.discountMinor) : MUTED)}
                {tail('netPrice', netUnit === null ? MUTED : money(netUnit))}
                {tail('netTotal', priced ? money(result.totalMinor) : MUTED, 'font-bold')}
                {tail('batch', line.batchId ? line.batchLot : (batch?.lot ?? MUTED))}
                {tail('expiry', batch ? batch.expiryDate.slice(0, 7) : MUTED)}
                {tail('balance', line.sellableQty)}
                {canSeeCost && tail('cost', moneyText(cost?.costMinor))}
                {canSeeCost && tail('profit', moneyText(cost?.profitMinor))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
