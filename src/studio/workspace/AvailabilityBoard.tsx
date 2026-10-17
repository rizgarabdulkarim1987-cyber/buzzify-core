'use client';

import { Radio } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { setOptionAvailability, setProductAvailability } from '@/app/studio/_actions/availability';
import { isLocale, type Locale } from '@/lib/locale';
import type { AvailabilityBoard as Board } from '@/server/studio/services/availability';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { Alert } from '@/studio/ui/Alert';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Switch } from '@/studio/ui/Switch';
import { displayName } from './content/shared';

type Filter = 'all' | 'soldOut' | 'hidden';
type Product = Board['categories'][number]['products'][number];

/** A switch's value as the person last set it, until the server's next answer replaces the board. */
type Overrides = Record<string, boolean>;

/**
 * The Availability tab (spec 10.3): sold out and hidden for each product, sold out for each option, live at once. A
 * switch moves when pressed and goes back, with a message, if the change is refused.
 */
export function AvailabilityBoard({ menuId, board }: { menuId: string; board: Board }) {
  const t = useT();
  const { locale } = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const [overrides, setOverrides] = useState<Overrides>({});
  const fallback: Locale = isLocale(board.defaultLocale) ? board.defaultLocale : 'en';
  const name = (names: Partial<Record<Locale, string>>) => displayName(names, locale, fallback);
  const number = numberFormat(locale);

  const value = (key: string, stored: boolean) => overrides[key] ?? stored;
  const soldOut = (product: Product) => !value(`p:${product.id}:available`, product.isAvailable);
  const hidden = (product: Product) => value(`p:${product.id}:hidden`, product.isHidden);
  const optionSoldOut = (product: Product) =>
    product.groups.some((group) => group.options.some((option) => !value(`o:${option.id}`, option.isAvailable)));

  const apply = async (key: string, next: boolean, send: () => Promise<{ ok: true } | { ok: false; error: Parameters<typeof describeFailure>[2] }>) => {
    setOverrides((current) => ({ ...current, [key]: next }));
    const result = await send();
    if (!result.ok) {
      setOverrides((current) => ({ ...current, [key]: !next }));
      toast.error(describeFailure(t, locale, result.error).message);
    }
  };

  const shows = (product: Product) =>
    filter === 'all' || (filter === 'soldOut' ? soldOut(product) || optionSoldOut(product) : hidden(product));
  const categories = board.categories
    .map((category) => ({ ...category, products: category.products.filter(shows) }))
    .filter((category) => category.products.length > 0);
  const counts = {
    soldOut: board.categories.flatMap((category) => category.products).filter((product) => soldOut(product) || optionSoldOut(product)).length,
    hidden: board.categories.flatMap((category) => category.products).filter(hidden).length,
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5 px-8 pb-10 pt-6">
      <Alert>{t('availability.live')}</Alert>

      <div role="group" aria-label={t('availability.filter')} className="inline-flex w-fit rounded-md border border-line p-0.5">
        {(['all', 'soldOut', 'hidden'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cx('h-7 rounded-sm px-3 text-sm transition-colors', filter === key ? 'bg-text text-bg' : 'text-muted hover:text-text')}
          >
            {key === 'all' ? t('availability.filter.all') : t(`availability.filter.${key}`, { count: number.format(counts[key]) })}
          </button>
        ))}
      </div>

      {categories.length === 0 ? (
        <EmptyState icon={<Radio aria-hidden />} title={t(filter === 'all' ? 'availability.emptyTitle' : 'availability.noneTitle')} body={t(filter === 'all' ? 'availability.emptyBody' : 'availability.noneBody')} />
      ) : (
        categories.map((category) => (
          <section key={category.id} aria-labelledby={`availability-${category.id}`} className="rounded-lg border border-line bg-raised">
            <h2 id={`availability-${category.id}`} className="border-b border-line px-4 py-2.5 text-md font-semibold text-text">
              {name(category.names)}
            </h2>
            <ul className="divide-y divide-line">
              {category.products.map((product) => {
                const productName = name(product.names);
                const out = soldOut(product);
                const off = hidden(product);
                return (
                  <li key={product.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div className={cx('flex min-w-0 flex-1 flex-col', off && 'opacity-60')}>
                        <span className="truncate text-base font-medium text-text">{productName}</span>
                        <span className="text-sm text-muted">
                          {off ? t('availability.state.hidden') : out ? t('availability.state.soldOut') : t('availability.state.available')}
                        </span>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-text">
                        {t('availability.soldOut')}
                        <Switch
                          aria-label={t('availability.soldOutLabel', { name: productName })}
                          checked={out}
                          onCheckedChange={(checked) =>
                            apply(`p:${product.id}:available`, !checked, () => setProductAvailability({ menuId, productId: product.id, isAvailable: !checked }))
                          }
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-text">
                        {t('availability.hidden')}
                        <Switch
                          aria-label={t('availability.hiddenLabel', { name: productName })}
                          checked={off}
                          onCheckedChange={(checked) =>
                            apply(`p:${product.id}:hidden`, checked, () => setProductAvailability({ menuId, productId: product.id, isHidden: checked }))
                          }
                        />
                      </label>
                    </div>
                    {product.groups.some((group) => group.options.length > 0) && (
                      <ul className="flex flex-col gap-1.5 border-s border-line ps-4">
                        {product.groups.flatMap((group) =>
                          group.options.map((option) => {
                            const label = `${name(group.names)}: ${name(option.names)}`;
                            const optionOut = !value(`o:${option.id}`, option.isAvailable);
                            return (
                              <li key={option.id} className="flex items-center justify-between gap-4">
                                <span className={cx('min-w-0 truncate text-sm', optionOut ? 'text-muted line-through' : 'text-text')}>{label}</span>
                                <label className="flex shrink-0 items-center gap-2 text-sm text-text">
                                  {t('availability.soldOut')}
                                  <Switch
                                    aria-label={t('availability.optionLabel', { name: productName, option: label })}
                                    checked={optionOut}
                                    onCheckedChange={(checked) =>
                                      apply(`o:${option.id}`, !checked, () => setOptionAvailability({ menuId, optionId: option.id, isAvailable: !checked }))
                                    }
                                  />
                                </label>
                              </li>
                            );
                          }),
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
