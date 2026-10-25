import Link from 'next/link';
import { formatNumber, ltr } from '@/lib/pos-format';
import { formatQuantity, type StockUnitKey } from '@/server/domain/pos/stock';
import type { Translate } from '@/lib/i18n';
import { StatusBadge } from '@/studio/ui/StatusBadge';

/** A quantity as a left-to-right piece in the item's unit: "2.5 kg", "750 g", "12 pcs". Server-safe. */
export function quantityLabel(t: Translate, quantity: number, unit: StockUnitKey): string {
  const { value, unit: shown } = formatQuantity(quantity, unit);
  return ltr(`${value} ${t(`pos.stock.unit.${shown}`)}`);
}

export function moneyLabel(t: Translate, amount: number): string {
  return ltr(`${formatNumber(amount)} ${t('pos.currency')}`);
}

/** "Count needed" for a negative item and "Low" at or under the reorder level: a word and a dot, never colour alone. */
export function StockState({ t, state }: { t: Translate; state: 'negative' | 'low' | 'ok' }) {
  if (state === 'ok') return null;
  return (
    <span data-testid={state === 'negative' ? 'item-negative' : 'item-low'}>
      <StatusBadge tone={state === 'negative' ? 'danger' : 'neutral'}>{t(state === 'negative' ? 'pos.stock.state.negative' : 'pos.stock.state.low')}</StatusBadge>
    </span>
  );
}

/** A row of links for the sections of one area (items, count, recipes), the current one marked. */
export function SectionTabs({ items, current, label }: { items: readonly { key: string; href: string; label: string }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto px-8 pb-4">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? 'page' : undefined}
          className={`inline-flex min-h-12 shrink-0 items-center rounded-md px-4 text-base font-medium whitespace-nowrap ${item.key === current ? 'bg-ink text-on-ink' : 'text-text hover:bg-hover'}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
