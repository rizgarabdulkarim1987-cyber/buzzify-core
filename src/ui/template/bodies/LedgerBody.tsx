'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { lowestPriceFromMenu } from '@/lib/menu-price';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate, type MenuCategory } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import { cheapestFirst, sheetColumn, stationFrequency, tapeSide, type LedgerMotif } from './ledger';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './ledger.css';
import './sheet.css';
import './serp.css';
import './typew.css';
import './cassette.css';
import './radio.css';

export type { LedgerMotif } from './ledger';

/** The sheet's four columns: photo, dish, price (its header sorts), add. */
const SHEET_COLUMNS = [0, 1, 2, 3].map(sheetColumn);

/**
 * Sets `data-play` on every `[data-tape]` while it is on the screen (the cassette's reels spin only then). Re-watches the
 * tapes when the shown sections change (a search, a filter).
 */
function useTapesInView(root: RefObject<HTMLElement | null>, on: boolean, shown: readonly MenuCategory[]) {
  useEffect(() => {
    const host = root.current;
    if (!on || !host || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.toggleAttribute('data-play', entry.isIntersecting);
    });
    host.querySelectorAll('[data-tape]').forEach((tape) => watcher.observe(tape));
    return () => watcher.disconnect();
  }, [root, on, shown]);
}

/**
 * Slides the radio's red needle along the dial to the lit station: sets `--needle` (its distance from the dial's start
 * edge, logical, so RTL mirrors) and `data-tuned` on the `[data-dial]` strip, again when the strip scrolls or the window
 * resizes. No station lit: no needle.
 */
function useNeedle(root: RefObject<HTMLElement | null>, on: boolean, activeId: string | null, shown: readonly MenuCategory[]) {
  useEffect(() => {
    const dial = root.current?.querySelector<HTMLElement>('[data-dial]');
    if (!on || !dial) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const lit = dial.querySelector<HTMLElement>('[aria-current="true"]');
      if (!lit) {
        dial.removeAttribute('data-tuned');
        return;
      }
      const box = dial.getBoundingClientRect();
      const station = lit.getBoundingClientRect();
      const middle = station.left + station.width / 2;
      const rtl = getComputedStyle(dial).direction === 'rtl';
      dial.style.setProperty('--needle', `${Math.round(rtl ? box.right - middle : middle - box.left)}px`);
      dial.setAttribute('data-tuned', '');
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    later();
    dial.addEventListener('scroll', later, { capture: true, passive: true });
    window.addEventListener('resize', later, { passive: true });
    return () => {
      dial.removeEventListener('scroll', later, { capture: true });
      window.removeEventListener('resize', later);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root, on, activeId, shown]);
}

/**
 * The ledger family (spec 2026-10-28-menu-styles-77-addendum.md): dense rows, one line a dish, so a phone's first
 * screen holds many dishes with their photos and prices. One component draws five styles (`motif`, also the body kind):
 *
 * - `sheet`, The Spreadsheet: the menu is a workbook. Row numbers, column letters, each section a coloured group, and a
 *   formula bar (sticky with the sheet tabs) that writes the dish last opened or added. The price column's header sorts
 *   its section cheapest first (a client sort of the already filtered list); tapped again it goes back to menu order.
 * - `serp`, The Search Results: each dish a result, a breadcrumb under the restaurant's name, a link-blue title, a
 *   snippet, a line with the price and labels, and a small side photo. The sections are the result tabs.
 * - `typew`, The Typewriter: typed on ruled paper, the name, dot leaders and the price on one line, a small photo pinned
 *   at the edge, red section titles. Each line slides in once like the carriage; an added dish gets a red stamp.
 * - `cassette`, The Cassette: each section a tape with a hand-written label and two reels that spin while it is on the
 *   screen (faster for a moment on an add), then its J-card tracklist, side A and side B.
 * - `radio`, The Old Radio: the sections are stations on a gold dial at the top whose red needle slides to the section in
 *   view; each section is a speaker cloth holding its programme schedule.
 *
 * Every section is on the page with `id="cat-<slug>"`, so the template's jump and the strip reach it.
 */
export function LedgerBody({ motif }: { motif: LedgerMotif }) {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, view, activeId, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const fastForward = useRef(new Map<Element, number>());
  const [cheap, setCheap] = useState<ReadonlySet<string>>(() => new Set());
  const [picked, setPicked] = useState<string | null>(null);

  useOnceInView(root, reduced || motif !== 'typew', { item: 'data-line', id: 'data-line', mark: 'data-in' });
  useTapesInView(root, motif === 'cassette' && !reduced, categories);
  useNeedle(root, motif === 'radio', activeId, categories);

  useEffect(() => {
    const timers = fastForward.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const pickedProduct = useMemo(() => {
    if (!picked) return null;
    for (const products of byCategory.values()) {
      const found = products.find((product) => product.id === picked);
      if (found) return found;
    }
    return null;
  }, [byCategory, picked]);

  const total = view.categories.length;
  const open = (product: MenuProductView) => {
    if (motif === 'sheet') setPicked(product.id);
    openProduct(product.id);
  };
  const rowOf = (button: HTMLButtonElement) => button.closest<HTMLElement>('[data-row]');
  const pulse = (element: Element | null | undefined, scale: number) => {
    if (reduced || !element) return;
    element.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  };
  const added = (product: MenuProductView) => (button: HTMLButtonElement) => {
    const row = rowOf(button);
    if (motif === 'sheet') setPicked(product.id);
    if (motif === 'serp') row?.setAttribute('data-visited', '');
    if (motif === 'typew') row?.setAttribute('data-got', '');
    if (motif === 'radio') pulse(row?.querySelector('[data-photo]'), 1.1);
    if (motif === 'cassette' && !reduced) {
      const tape = button.closest('section')?.querySelector('[data-tape]');
      if (!tape) return;
      window.clearTimeout(fastForward.current.get(tape));
      tape.setAttribute('data-ff', '');
      fastForward.current.set(
        tape,
        window.setTimeout(() => tape.removeAttribute('data-ff'), 1200),
      );
    }
  };
  const toggleCheap = (id: string) =>
    setCheap((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const photo = (product: MenuProductView, prefix: string, sizes: string, priority: boolean) => (
    <div data-photo className={`lg-photo ${prefix}-ph tpl-plate`}>
      <ProductMedia product={product} suffix={motif} sizes={sizes} priority={priority} className={`${prefix}-img`} />
    </div>
  );
  const name = (product: MenuProductView, prefix: string) => (
    <button type="button" onClick={() => open(product)} className={`tpl-open lg-name ${prefix}-name text-start`}>
      {product.name}
    </button>
  );
  const add = (product: MenuProductView, prefix: string, variant: 'icon' | 'label') => (
    <QuickAction product={product} variant={variant} className={`lg-add ${prefix}-add relative z-[2]`} onAdded={added(product)} />
  );

  // The sheet numbers its rows down the whole workbook, as a spreadsheet does (the shown rows, after search): the
  // number of the row before each section's first.
  const rowStart = new Map<string, number>();
  categories.reduce((before, category) => {
    rowStart.set(category.id, before);
    return before + (byCategory.get(category.id)?.length ?? 0);
  }, 0);

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      {motif === 'sheet' ? (
        <div aria-hidden className="sh-bar">
          <b className="sh-grid" />
          <span className="sh-file">{tenant.logoText}.xlsx</span>
        </div>
      ) : null}
      <SectionStrip
        marker={motif === 'radio' ? 'dial' : 'tabs'}
        prefix="lg"
        lead={
          motif === 'sheet' ? (
            <div className="sh-fx">
              <i aria-hidden>fx</i>
              <span className="sh-fxv">
                <span aria-hidden>=</span>
                {pickedProduct ? (
                  <>
                    <span className="sh-fx-name">{pickedProduct.name}</span>
                    <span aria-hidden>;</span>
                    <Price product={pickedProduct} className="sh-fx-price" />
                  </>
                ) : (
                  <span className="sh-fx-name">{tenant.logoText}</span>
                )}
              </span>
            </div>
          ) : motif === 'radio' ? (
            <>
              <div aria-hidden className="ro-brand">
                <span>{tenant.logoText}</span>
              </div>
              <i aria-hidden className="ro-needle" />
            </>
          ) : undefined
        }
      >
        {(category) => (
          <>
            <span>{category.name}</span>
            {motif === 'radio' ? <small aria-hidden>{n(stationFrequency(placeOf(category), total))}</small> : null}
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const shown = byCategory.get(category.id) ?? [];
          const sorted = motif === 'sheet' && cheap.has(category.id);
          const products = sorted ? cheapestFirst(shown, (product) => lowestPriceFromMenu(product).price) : shown;
          const place = placeOf(category);
          const head = `h-${category.slug}`;
          const first = (at: number) => index === 0 && at < 6;
          const heading = (label: string | undefined, lead?: ReactNode) => (
            <ShapeHeading id={head} name={category.name} label={label} count={n(products.length)} className="lg-head" title="lg-title" lead={lead} />
          );
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={head}
              className="tpl-section tpl-tall-last lg-section"
              style={{ '--place': place } as CSSProperties}
            >
              {motif === 'sheet' ? (
                <>
                  {heading(undefined, <i aria-hidden className="sh-caret" />)}
                  <div className="sh-cols">
                    <span aria-hidden />
                    <span aria-hidden>{SHEET_COLUMNS[0]}</span>
                    <span aria-hidden>{SHEET_COLUMNS[1]}</span>
                    <button
                      type="button"
                      aria-pressed={sorted}
                      aria-label={t('tpl.lg.cheapestFirst', { name: category.name })}
                      onClick={() => toggleCheap(category.id)}
                      className="sh-sort"
                    >
                      <span aria-hidden>{SHEET_COLUMNS[2]}</span>
                      <i aria-hidden className="sh-sort-mark" />
                    </button>
                    <span aria-hidden>{SHEET_COLUMNS[3]}</span>
                  </div>
                  <ol className="lg-list sh-rows">
                    {products.map((product, at) => {
                      const sheetRow = (rowStart.get(category.id) ?? 0) + at + 1;
                      return (
                        <li key={product.id} data-row data-picked={picked === product.id ? '' : undefined} className="lg-row sh-row">
                          <span aria-hidden className="sh-rn tabular-nums">
                            {n(sheetRow)}
                          </span>
                          {photo(product, 'sh', '64px', first(at))}
                          <div className="sh-cell">
                            {name(product, 'sh')}
                            <Description product={product} lines={1} className="sh-desc" />
                            <Badges product={product} className="sh-badges" />
                          </div>
                          <div className="sh-num">
                            <Price product={product} className="sh-price" />
                          </div>
                          <div className="sh-act">{add(product, 'sh', 'icon')}</div>
                        </li>
                      );
                    })}
                  </ol>
                </>
              ) : motif === 'serp' ? (
                <>
                  {heading(n(place + 1))}
                  <ol className="lg-list sp-results">
                    {products.map((product, at) => (
                      <li key={product.id} data-row className="lg-row sp-res">
                        <div className="sp-tx">
                          <span aria-hidden className="sp-url">
                            <i className="sp-fav tabular-nums">{n(place + 1)}</i>
                            <span className="sp-crumb">
                              {tenant.logoText} › {category.name} › {n(at + 1)}
                            </span>
                          </span>
                          {name(product, 'sp')}
                          <Description product={product} lines={1} className="sp-snip" />
                          <span className="sp-line">
                            <Price product={product} className="sp-price" />
                            <Badges product={product} className="sp-badges" />
                            {add(product, 'sp', 'label')}
                          </span>
                        </div>
                        {photo(product, 'sp', '80px', first(at))}
                      </li>
                    ))}
                  </ol>
                </>
              ) : motif === 'typew' ? (
                <>
                  {heading(undefined)}
                  <ul className="lg-list tw-lines">
                    {products.map((product, at) => (
                      <li key={product.id} data-row data-line={product.id} className="lg-row tw-line" style={{ '--i': at % 4 } as CSSProperties}>
                        {photo(product, 'tw', '56px', first(at))}
                        <div className="tw-tx">
                          <span className="tw-lead">
                            {name(product, 'tw')}
                            <i aria-hidden className="tw-dots" />
                            <Price product={product} className="tw-price" />
                          </span>
                          <Description product={product} lines={1} className="tw-desc" />
                          <Badges product={product} className="tw-badges" />
                        </div>
                        {add(product, 'tw', 'label')}
                        <i aria-hidden className="tw-stamp">
                          ✓
                        </i>
                      </li>
                    ))}
                  </ul>
                </>
              ) : motif === 'cassette' ? (
                <>
                  <div data-tape className="cs-tape">
                    <div className="cs-label">{heading(n(place + 1))}</div>
                    <div aria-hidden className="cs-win">
                      <i className="cs-reel" />
                      <i className="cs-band" />
                      <i className="cs-reel" />
                    </div>
                  </div>
                  <ol className="lg-list cs-jcard">
                    {products.map((product, at) => {
                      const { side, track } = tapeSide(at, products.length);
                      return (
                        <li key={product.id} data-row data-side={side} data-flip={side === 'B' && track === 1 ? '' : undefined} className="lg-row cs-track">
                          <em aria-hidden className="cs-no tabular-nums">
                            {t(side === 'A' ? 'tpl.lg.sideA' : 'tpl.lg.sideB')}
                            {n(track)}
                          </em>
                          {photo(product, 'cs', '56px', first(at))}
                          <div className="cs-tx">
                            {name(product, 'cs')}
                            <Description product={product} lines={1} className="cs-desc" />
                            <Badges product={product} className="cs-badges" />
                          </div>
                          <Price product={product} className="cs-price" />
                          {add(product, 'cs', 'icon')}
                        </li>
                      );
                    })}
                  </ol>
                </>
              ) : (
                <>
                  {heading(n(stationFrequency(place, total)))}
                  <ul className="lg-list ro-grille">
                    {products.map((product, at) => (
                      <li key={product.id} data-row className="lg-row ro-prog">
                        {photo(product, 'ro', '56px', first(at))}
                        <div className="ro-tx">
                          {name(product, 'ro')}
                          <Description product={product} lines={1} className="ro-desc" />
                          <Badges product={product} className="ro-badges" />
                        </div>
                        <Price product={product} className="ro-price" />
                        {add(product, 'ro', 'icon')}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The Spreadsheet (kind `sheet`). */
export function SheetBody() {
  return <LedgerBody motif="sheet" />;
}
/** The Search Results (kind `serp`). */
export function SerpBody() {
  return <LedgerBody motif="serp" />;
}
/** The Typewriter (kind `typew`). */
export function TypewBody() {
  return <LedgerBody motif="typew" />;
}
/** The Cassette (kind `cassette`). */
export function CassetteBody() {
  return <LedgerBody motif="cassette" />;
}
/** The Old Radio (kind `radio`). */
export function RadioBody() {
  return <LedgerBody motif="radio" />;
}
