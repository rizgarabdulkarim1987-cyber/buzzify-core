'use client';

import { localDigits } from '@/lib/digits';
import type { MenuOfferView, MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';

/**
 * What the sales tools add to a dish wherever it is shown (docs/superpowers/specs/2026-10-18-sales-tools-design.md,
 * 6.3). Every label comes from real data: a live special or discount, the menu's most ordered dishes, a real count of
 * portions left. Nothing here is a timer or a claim the restaurant did not make.
 */

const PILL = 'rounded-full border px-2 py-px text-xs';

/** The dish's sales labels, as quiet pills beside its other badges. */
export function SalesPills({ product }: { product: Pick<MenuProductView, 'special' | 'mostOrdered' | 'percentOff' | 'regularPrice'> }) {
  const { t, tenant } = useApp();
  return (
    <>
      {product.special && <span className={`${PILL} border-accent/55 text-accent`}>{product.special}</span>}
      {product.regularPrice !== undefined && product.percentOff && (
        <span className={`${PILL} border-accent bg-accent font-medium tabular-nums text-on-accent`}>
          {t('menu.percentOff', { percent: localDigits(String(product.percentOff), tenant.numeralSystem) })}
        </span>
      )}
      {product.mostOrdered && <span className={`${PILL} border-line text-muted`}>{t('menu.mostOrdered')}</span>}
    </>
  );
}

/** Whether the dish has any sales label to show. */
export function hasSalesPills(product: Pick<MenuProductView, 'special' | 'mostOrdered' | 'regularPrice'>): boolean {
  return Boolean(product.special || product.mostOrdered || product.regularPrice !== undefined);
}

/**
 * The dish's price: the price guests pay now, in the menu's price style, and during a discount the regular price
 * crossed out beside it. `className` styles the price guests pay.
 */
export function SalePrice({ product, className }: { product: Pick<MenuProductView, 'displayPrice' | 'regularPrice'>; className: string }) {
  const { t, price } = useApp();
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={className}>{price(product.displayPrice)}</span>
      {product.regularPrice !== undefined && (
        <s className="text-sm tabular-nums text-muted decoration-1">
          <span className="sr-only">{t('menu.regularPrice', { price: price(product.regularPrice) })}</span>
          <span aria-hidden>{price(product.regularPrice)}</span>
        </s>
      )}
    </span>
  );
}

/** "For 4 · 2.50 each" and "Only 3 left": what a guest may want to know before choosing. */
export function SalesFacts({ product }: { product: Pick<MenuProductView, 'serves' | 'fewLeft' | 'displayPrice'> }) {
  const { t, price, locale, tenant } = useApp();
  if (!product.serves && !product.fewLeft) return null;
  // `count` picks the language's plural form; `n` is the number as the menu writes its digits.
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
      {product.serves && (
        <span>{t('menu.serves', { count: product.serves, n: n(product.serves), price: price(Math.round(product.displayPrice / product.serves)) })}</span>
      )}
      {product.fewLeft && <span className="text-accent">{t('menu.fewLeft', { count: product.fewLeft, n: n(product.fewLeft) })}</span>}
    </span>
  );
}

/** The day of the week (Monday first, as the menu's schedule numbers days) of a `YYYY-MM-DD` date. */
function weekdayOf(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** When a live offer ends, in words ("Until 19:00", "Until Friday"); null when it does not end soon. */
export function useOfferEnd(): (offer: MenuOfferView) => string | null {
  const { t, tenant } = useApp();
  return (offer) => {
    if (!offer.endsAt) return null;
    return 'time' in offer.endsAt
      ? t('offers.untilTime', { time: localDigits(offer.endsAt.time, tenant.numeralSystem) })
      : t('offers.untilDay', { day: t(`offers.weekday.${weekdayOf(offer.endsAt.date)}`) });
  };
}

/**
 * The live offers above the menu: each with its title, its text and when it ends today or this week. A quiet list,
 * never a banner that moves or counts down.
 */
export function OfferStrip({ offers }: { offers: MenuOfferView[] }) {
  const { t, tenant } = useApp();
  const endOf = useOfferEnd();
  const digits = (text: string) => localDigits(text, tenant.numeralSystem);
  if (offers.length === 0) return null;
  return (
    <section aria-label={t('offers.label')} className="px-5 pb-2 pt-1">
      <ul className="border-y border-line">
        {offers.map((offer) => (
          <li key={offer.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
            <div className="min-w-0">
              <p className="font-display text-lg leading-snug">
                {offer.title}
                {offer.percentOff !== null && (
                  <span className="ms-2 align-[0.1em] text-sm tabular-nums text-accent">{t('menu.percentOff', { percent: digits(String(offer.percentOff)) })}</span>
                )}
              </p>
              {offer.text && <p className="mt-0.5 text-sm text-muted">{offer.text}</p>}
            </div>
            {offer.endsAt && <p className="shrink-0 text-sm tabular-nums text-muted">{endOf(offer)}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
