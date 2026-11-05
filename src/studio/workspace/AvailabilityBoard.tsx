'use client';

import { Radio } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setOptionAvailability, setProductAvailability, setProductDrop, setProductStock } from '@/app/studio/_actions/availability';
import { isLocale, type Locale } from '@/lib/locale';
import type { AvailabilityBoard as Board } from '@/server/studio/services/availability';
import { describeFailure } from '@/studio/errors';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Input } from '@/studio/ui/Input';
import { Switch } from '@/studio/ui/Switch';
import { displayName } from './content/shared';

type Filter = 'all' | 'soldOut' | 'hidden';
type Product = Board['categories'][number]['products'][number];

/** A switch's value as the person last set it, until the server's next answer replaces the board. */
type Overrides = Record<string, boolean>;

/** Western digits for Arabic-Indic and Persian ones, so a count typed on an Arabic keyboard reads. */
function latinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

/**
 * How many portions of a product are left today, saved live when the field is left or Enter is pressed. Empty means
 * not counted; 0 shows the product sold out to guests.
 */
function StockField({ menuId, product, productName }: { menuId: string; product: Product; productName: string }) {
  const t = useT();
  const { locale } = useLocale();
  const initial = product.stockCount === null ? '' : String(product.stockCount);
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const typed = latinDigits(text.trim());
    if (typed === saved) return;
    const count = typed === '' ? null : /^\d{1,4}$/.test(typed) ? Number(typed) : Number.NaN;
    if (Number.isNaN(count)) {
      toast.error(t('availability.stock.range'));
      setText(saved);
      return;
    }
    startTransition(async () => {
      const result = await setProductStock({ menuId, productId: product.id, stockCount: count });
      if (result.ok) {
        setSaved(typed);
        setText(typed);
      } else {
        setText(saved);
        toast.error(describeFailure(t, locale, result.error).message);
      }
    });
  };

  const left = saved === '' ? null : Number(saved);
  const fewLeft = left !== null && left > 0 && product.lowStockThreshold !== null && left <= product.lowStockThreshold;
  return (
    <span className="flex flex-col gap-0.5">
      <label className="flex items-center gap-2 whitespace-nowrap text-sm text-text">
        {t('availability.stock')}
        <Input
          value={text}
          inputMode="numeric"
          dir="ltr"
          placeholder="—"
          disabled={pending}
          aria-label={t('availability.stockLabel', { name: productName })}
          onChange={(event) => setText(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
          className="h-8 w-20 tabular-nums"
        />
      </label>
      {fewLeft && <span className="text-xs text-muted">{t('availability.stock.fewLeft', { count: numberFormat(locale).format(left) })}</span>}
    </span>
  );
}

/** An ISO instant as a `datetime-local` value in the browser's own time zone (empty for none). */
function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A limited drop: the dish is on the menu only between two times, set in the browser's own time zone and saved live. Clearing
 * takes the window away and the dish is an ordinary one again.
 */
function DropField({ menuId, product, productName }: { menuId: string; product: Product; productName: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [from, setFrom] = useState(toLocalInput(product.dropStartsAt));
  const [to, setTo] = useState(toLocalInput(product.dropEndsAt));
  const [saved, setSaved] = useState(product.dropEndsAt !== null);
  const [pending, startTransition] = useTransition();

  const send = (startsAt: string | null, endsAt: string | null, done: () => void) =>
    startTransition(async () => {
      const result = await setProductDrop({ menuId, productId: product.id, startsAt, endsAt });
      if (result.ok) done();
      else toast.error(describeFailure(t, locale, result.error).message);
    });

  const set = () => {
    if (from === '' || to === '') {
      toast.error(t('availability.drop.incomplete'));
      return;
    }
    send(new Date(from).toISOString(), new Date(to).toISOString(), () => setSaved(true));
  };
  const clear = () =>
    send(null, null, () => {
      setFrom('');
      setTo('');
      setSaved(false);
    });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text">
      <span className="font-medium">{t('availability.drop')}</span>
      <label className="flex items-center gap-2">
        {t('availability.drop.from')}
        <Input type="datetime-local" value={from} disabled={pending} aria-label={t('availability.drop.fromLabel', { name: productName })} onChange={(event) => setFrom(event.target.value)} className="h-8 w-52" />
      </label>
      <label className="flex items-center gap-2">
        {t('availability.drop.to')}
        <Input type="datetime-local" value={to} disabled={pending} aria-label={t('availability.drop.toLabel', { name: productName })} onChange={(event) => setTo(event.target.value)} className="h-8 w-52" />
      </label>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={set}>
        {t('availability.drop.set')}
      </Button>
      {saved && (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={clear}>
          {t('availability.drop.clear')}
        </Button>
      )}
    </div>
  );
}

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
      {!board.drops.allowed && <UpgradeHint feature="selling.limitedDrops" info={board.drops.upgrade} />}

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
                      <StockField menuId={menuId} product={product} productName={productName} />
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
                    {(board.drops.allowed || product.dropEndsAt !== null) && <DropField menuId={menuId} product={product} productName={productName} />}
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
