'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { needsSheet, pickName, visibleProducts } from '@/lib/pos-view';
import type { TillCatalog, TillProduct } from '@/server/pos/till-catalog';
import { useLocale, useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Input } from '@/studio/ui/Input';
import { useMoney } from './money';

/**
 * The dishes a guest's order can hold, to pick one from: a search, the categories and one button per dish. Only dishes the
 * guests' menu offers and that are not sold out are listed, since a guest order is priced from that menu.
 */
export function ProductPicker({ catalog, disabled, onPick }: { catalog: TillCatalog; disabled: boolean; onPick: (product: TillProduct) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const fallback = catalog.defaultLocale;
  const products = useMemo(() => visibleProducts(catalog, categoryId, search).filter((product) => product.available && !product.hiddenFromGuests), [catalog, categoryId, search]);
  const categories = [...catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-3">
      <Input type="search" size="lg" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('pos.order.search')} aria-label={t('pos.order.search')} />
      {categories.length > 1 ? (
        <div role="tablist" aria-label={t('pos.order.categories')} className="flex gap-1 overflow-x-auto pb-1">
          {[{ id: null as string | null, label: t('pos.board.allAreas') }, ...categories.map((c) => ({ id: c.id as string | null, label: pickName(c.names, locale, fallback) }))].map((category) => (
            <button
              key={category.id ?? 'all'}
              type="button"
              role="tab"
              aria-selected={categoryId === category.id}
              onClick={() => setCategoryId(category.id)}
              className={cx(
                'min-h-12 shrink-0 rounded-full border px-5 text-base font-semibold whitespace-nowrap',
                categoryId === category.id ? 'border-ink bg-ink text-on-ink' : 'border-line bg-raised text-text hover:bg-hover',
              )}
            >
              {category.label}
            </button>
          ))}
        </div>
      ) : null}
      {products.length === 0 ? (
        <EmptyState title={t('pos.order.noProducts')} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
          {products.map((product) => (
            <li key={product.id} className="flex">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(product)}
                className="flex min-h-20 w-full flex-col items-start gap-1 rounded-2xl border border-line bg-raised p-3 text-start hover:bg-hover disabled:opacity-60"
              >
                <span className="line-clamp-2 text-base leading-snug font-bold break-words text-text">{pickName(product.names, locale, fallback)}</span>
                <span className="mt-auto flex w-full items-end justify-between gap-2">
                  <span className="text-base font-semibold text-text">{money(product.price)}</span>
                  {needsSheet(product) ? <SlidersHorizontal size={16} aria-hidden className="text-muted" /> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
