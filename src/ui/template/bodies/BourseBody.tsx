'use client';

import { useEffect, useRef, type AnimationEvent, type CSSProperties, type RefObject } from 'react';
import { localDigits } from '@/lib/digits';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate, type MenuCategory } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction, saleOff } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useSpineHold } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './bourse.css';

/**
 * A dish's "change" on the board: its real discount in percent (the price went down by it), or 0 for a flat "—". Read
 * from the dish's live offer (`percentOff` while a `regularPrice` shows), never made up.
 */
export function bourseChange(product: Pick<MenuProductView, 'percentOff' | 'regularPrice'>): number {
  return saleOff(product as MenuProductView);
}

/**
 * The dishes the ticker tape runs: the ones on sale first (the market's movers), then the rest in menu order, at most
 * `max`, so a long menu never builds a tape of a thousand names. Only what the search and filters leave is read.
 */
export function tickerProducts(
  categories: readonly Pick<MenuCategory, 'id'>[],
  byCategory: ReadonlyMap<string, readonly MenuProductView[]>,
  max = 24,
): MenuProductView[] {
  const all = categories.flatMap((category) => byCategory.get(category.id) ?? []);
  const moving = all.filter((product) => bourseChange(product) > 0);
  const flat = all.filter((product) => bourseChange(product) === 0);
  return [...moving, ...flat].slice(0, max);
}

/** The tape's run time (s): long enough that every name can be read, from the number of dishes on it. */
export function tickerSeconds(count: number): number {
  return Math.max(20, count * 3.5);
}

/** The change cell: a green ▼ and the discount, or a flat dash. The badge already announces the sale, so it is hidden from readers. */
function Change({ product, className }: { product: MenuProductView; className: string }) {
  const { t, tenant } = useApp();
  const off = bourseChange(product);
  return (
    <span aria-hidden className={className} data-move={off ? 'down' : 'flat'}>
      {off ? (
        <>
          <i className="bo-arrow">▼</i>
          <span>{t('menu.percentOff', { percent: localDigits(String(off), tenant.numeralSystem) })}</span>
        </>
      ) : (
        '—'
      )}
    </span>
  );
}

/** Watches the tape: `data-live` while it is on the screen, so it runs only there. */
function useTapeWatch(tape: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const node = tape.current;
    if (!node || !active || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(([entry]) => node.toggleAttribute('data-live', Boolean(entry?.isIntersecting)), { threshold: 0 });
    watcher.observe(node);
    return () => {
      watcher.disconnect();
      node.removeAttribute('data-live');
    };
  }, [tape, active]);
}

/**
 * The market page (kind `bourse`, spec 2026-10-28-menu-styles-77-addendum.md): the financial pages of a newspaper. A
 * ticker tape runs across the top under the restaurant's name (its exchange) with the real dishes, their prices and
 * their real discounts; it stops under the pointer, on focus, under a finger and off the screen, and stands still (and
 * scrolls by hand) with less motion. Every section is a stock table, every dish a row: photo, name, price, and the
 * "change": the dish's live discount as a green ▼ −20%, or a flat "—". No sparklines and no invented moves. A row flashes
 * once when its dish is added. Colours from the template's tokens; the tape inverts the page (`--bg` on `--text`).
 */
export function BourseBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  const tape = useRef<HTMLDivElement>(null);
  const ticker = tickerProducts(categories, byCategory);

  useTapeWatch(tape, !reduced);
  useSpineHold(root, !reduced);

  const added = (button: HTMLButtonElement) => {
    const row = button.closest<HTMLElement>('[data-row]');
    if (!row) return;
    row.removeAttribute('data-hit');
    void row.offsetWidth;
    row.setAttribute('data-hit', '');
  };
  const settle = (event: AnimationEvent<HTMLElement>) => {
    if (event.animationName === 'bo-flash') (event.target as Element).closest('[data-hit]')?.removeAttribute('data-hit');
  };

  const lane = (copy: boolean) => (
    <span className="bo-lane" aria-hidden={copy || undefined}>
      {ticker.map((product) => (
        <button key={product.id} type="button" tabIndex={copy ? -1 : undefined} onClick={() => openProduct(product.id)} className="bo-tick">
          <span className="bo-tick-name">{product.name}</span>
          <Price product={product} className="tpl-price-tight bo-tick-price" />
          <Change product={product} className="bo-tick-chg" />
        </button>
      ))}
    </span>
  );

  return (
    <div ref={root} className="tpl-body" data-body="bourse" onAnimationEnd={settle}>
      {ticker.length > 0 ? (
        <div ref={tape} className="bo-tape" data-still={reduced ? '' : undefined}>
          <span aria-hidden className="bo-exchange">
            {tenant.logoText}
          </span>
          <div className="bo-window scroll-hidden">
            <div className="bo-run" style={{ '--bo-time': `${tickerSeconds(ticker.length)}s` } as CSSProperties}>
              {lane(false)}
              {lane(true)}
            </div>
          </div>
        </div>
      ) : null}
      <SectionStrip marker="tables" prefix="bo">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0 bo-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last bo-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="bo-head" title="bo-title" />
              <ul className="bo-table">
                {products.map((product, at) => (
                  <li key={product.id} data-row className="bo-row">
                    <div data-photo className="bo-photo tpl-cover-media tpl-plate">
                      <ProductMedia product={product} suffix="bourse" sizes="56px" priority={index === 0 && at < 8} className="bo-img" rounded={false} />
                    </div>
                    <div className="bo-nm">
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open bo-name text-start">
                        {product.name}
                      </button>
                      <Description product={product} lines={1} className="bo-desc" />
                      <Badges product={product} className="bo-badges" />
                    </div>
                    <div className="bo-px">
                      <Price product={product} className="bo-price" />
                      <Change product={product} className="bo-chg" />
                    </div>
                    <QuickAction product={product} variant="label" className="bo-add relative z-[2]" onAdded={added} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
