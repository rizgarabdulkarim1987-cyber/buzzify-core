'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Description, DishCounts, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { layoutBook } from './book-pages';
import './shared/photo-card.css';
import './shared/shapes.css';
import './book.css';



/** How long a turned-away page stays in the document, so its turn can finish (a little over the longest turn in book.css). */
const TURN_MS = 650;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/**
 * The menu as a printed book (the "themed-book" mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A dark-red
 * leather cover with a gold double frame; a tap opens it onto the index (the contents), then one page at a time: a section's
 * dishes, four to a page, the rest of a long section on the pages that follow. Pages turn in 3D about the spine (right to
 * left in Arabic); the round arrows, a swipe and the arrow keys turn them, the contents jump to any section, the close
 * button shuts the book to its cover. Only the pages next to the open one are in the document (their photos load with them);
 * every page but the open one is inert. Less motion: the page changes at once. There is no search box: the index is it.
 */
export function BookBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, featured, signature, setCategoryOpener } = useTemplate();
  const n = useCallback((value: number) => formatCount(value, locale, tenant.numeralSystem), [locale, tenant.numeralSystem]);
  const { pages, firstPage } = useMemo(() => layoutBook(categories, (category) => byCategory.get(category.id) ?? []), [categories, byCategory]);
  const last = pages.length - 1;

  // Where the book is open, where it came from (kept while that page turns away), which way, and whose turn it was: only a
  // guest's turn (an arrow, the index, the address) moves the focus, never a change of the pages (a filter).
  const [turn, setTurn] = useState<{ at: number; from: number | null; back: boolean; far: boolean; seq: number; focus: boolean }>({ at: 0, from: null, back: false, far: false, seq: 0, focus: false });
  const [tall, setTall] = useState(false);
  const at = Math.min(turn.at, last);
  const root = useRef<HTMLElement>(null);
  const book = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const latest = useRef({ pages, firstPage, at, last });
  useEffect(() => {
    latest.current = { pages, firstPage, at, last };
  }, [pages, firstPage, at, last]);

  const go = useCallback((target: number, focus = false) => {
    const { at: now, last: end } = latest.current;
    const to = Math.max(0, Math.min(end, target));
    if (to === now) return;
    setTurn((previous) => ({ at: to, from: Math.min(previous.at, end), back: to < now, far: Math.abs(to - now) > 1, seq: previous.seq + 1, focus }));
  }, []);
  const toSection = useCallback((categoryId: string) => {
    const page = latest.current.firstPage.get(categoryId);
    if (page !== undefined) go(page, true);
  }, [go]);

  // The template's own jump (the hero, a link) opens a section through here.
  useEffect(() => {
    setCategoryOpener(toSection);
    return () => setCategoryOpener(null);
  }, [setCategoryOpener, toSection]);

  // The turned-away page leaves the document once its turn is over.
  useEffect(() => {
    if (turn.from === null) return;
    const seq = turn.seq;
    const timer = window.setTimeout(() => setTurn((current) => (current.seq === seq ? { ...current, from: null } : current)), TURN_MS);
    return () => window.clearTimeout(timer);
  }, [turn.seq, turn.from]);

  // An address with #cat-<slug> opens that section, on arrival and when the address changes.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#cat-')) return;
      let slug = hash.slice(5);
      try {
        slug = decodeURIComponent(slug);
      } catch {
        return;
      }
      const match = categories.find((category) => category.slug === slug);
      if (match) toSection(match.id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
    // Read on arrival and when the address changes, never because the categories did: a guest who has turned on must stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toSection]);

  // After the guest jumps (the index, the template's jump), focus goes to the page's heading; the arrows keep their own focus.
  useEffect(() => {
    if (turn.seq === 0 || !turn.focus) return;
    root.current?.querySelector<HTMLElement>(`[data-index="${Math.min(turn.at, latest.current.last)}"] [data-heading]`)?.focus({ preventScroll: true });
  }, [turn]);

  // The arrow keys turn the page (towards the side the book opens to: right to left in Arabic), Escape shuts the book. Not
  // while a field has the keys or the dish sheet is open (it answers Escape itself).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
      const rtl = root.current ? getComputedStyle(root.current).direction === 'rtl' : false;
      if (event.key === 'ArrowRight') go(latest.current.at + (rtl ? -1 : 1));
      else if (event.key === 'ArrowLeft') go(latest.current.at + (rtl ? 1 : -1));
      else if (event.key === 'Escape') go(0);
    };
    // In the capture phase, so a dish sheet that closes itself on this very key is still there to be seen.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go]);

  // A swipe turns the page too (towards the side the book opens to); a tap that ends a swipe is not a tap.
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    start.current = null;
    if (!from) return;
    const dx = event.clientX - from.x;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(event.clientY - from.y) * 1.5) return;
    swiped.current = true;
    const rtl = root.current ? getComputedStyle(root.current).direction === 'rtl' : false;
    go(latest.current.at + (dx > 0 === rtl ? 1 : -1));
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!swiped.current) return;
    swiped.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const enlarge = () => {
    setTall((value) => !value);
    if (!tall) bar.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };

  const shown = new Set(categories.flatMap((category) => (byCategory.get(category.id) ?? []).map((product) => product.id)));
  const house = [...featured, ...(signature ? [signature] : [])].find((product) => shown.has(product.id));
  const page = pages[at]!;
  const announce = page.kind === 'cover' ? t('tpl.book.menu') : page.kind === 'index' ? t('tpl.book.contents') : `${page.category.name} ${n(at)}`;
  const inBook = new Set([at - 1, at, at + 1, ...(turn.from !== null ? [turn.from] : [])]);

  return (
    <main id="menu" ref={root} data-body="book" data-at={at} data-dir={turn.back ? 'back' : 'fwd'} data-far={turn.far ? '' : undefined} data-tall={tall ? '' : undefined} className="min-w-0">
      <div ref={bar} className="bk-bar">
        <button type="button" onClick={() => go(1, true)} className="bk-pill">
          <Icon>
            <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" />
            <path d="M12 6v13.5" />
          </Icon>
          <span>{t('tpl.book.contents')}</span>
        </button>
        <span className="bk-bar-gap" />
        <button type="button" onClick={enlarge} aria-pressed={tall} aria-label={t('tpl.book.enlarge')} className="bk-round">
          <Icon>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </Icon>
        </button>
        <button type="button" onClick={() => go(0)} aria-label={t('tpl.book.close')} className="bk-round">
          <Icon>
            <path d="M6 6l12 12M18 6L6 18" />
          </Icon>
        </button>
      </div>

      <div ref={book} className="bk-book" onPointerDown={onDown} onPointerUp={onUp} onClickCapture={onClickCapture}>
        {pages.map((entry, index) => {
          if (!inBook.has(index)) return null;
          const position = index < at ? 'past' : index === at ? 'open' : 'next';
          const shared = { 'data-index': index, 'data-pos': position, inert: position !== 'open' } as const;
          if (entry.kind === 'cover') {
            return (
              <section key="cover" {...shared} data-page="cover" aria-label={t('tpl.book.menu')} className="bk-page bk-cover-page">
                <button type="button" onClick={() => go(1)} aria-label={`${tenant.logoText}: ${t('tpl.book.open')}`} className="bk-cover">
                  <span className="bk-frame">
                    <small aria-hidden className="bk-since">
                      ◆ ◆ ◆
                    </small>
                    <span className="tpl-display bk-cover-name">{tenant.logoText}</span>
                    <span className="bk-cover-sub">{t('tpl.book.menu')}</span>
                    <span className="bk-tap">{t('tpl.book.open')}</span>
                  </span>
                </button>
              </section>
            );
          }
          if (entry.kind === 'index') {
            return (
              <section key="index" {...shared} data-page="index" aria-labelledby="bk-contents" className="bk-page">
                <div className="bk-sheet">
                  <div tabIndex={-1} data-heading className="bk-head">
                    <h2 id="bk-contents" className="tpl-display bk-title">
                      {t('tpl.book.contents')}
                    </h2>
                    <p aria-hidden className="bk-orn">
                      ◆ ◆ ◆
                    </p>
                  </div>
                  <ol className="bk-contents">
                    {categories.map((category) => {
                      const target = firstPage.get(category.id);
                      return (
                        <li key={category.id} className="bk-entry">
                          <button type="button" data-chapter={category.id} onClick={() => toSection(category.id)} className="bk-chapter">
                            <span className="tpl-display bk-name">{category.name}</span>
                            <span aria-hidden className="bk-leader" />
                            <span className="bk-count">
                              <span aria-hidden>{target === undefined ? '' : n(target)}</span>
                              <span className="sr-only">{t('tpl.book.dishes', { count: (byCategory.get(category.id) ?? []).length, n: n((byCategory.get(category.id) ?? []).length) })}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  {house && <House product={house} />}
                  <p aria-hidden className="bk-folio">
                    {n(index)}
                  </p>
                </div>
              </section>
            );
          }
          const { category } = entry;
          return (
            <section
              key={`${category.id}-${index}`}
              {...shared}
              id={entry.first ? `cat-${category.slug}` : undefined}
              data-page="spread"
              data-spread={category.id}
              aria-labelledby={entry.first ? `h-${category.slug}` : undefined}
              aria-label={entry.first ? undefined : category.name}
              className="bk-page"
            >
              <div className="bk-sheet">
                <div tabIndex={-1} data-heading className="bk-head">
                  {entry.first ? (
                    <h2 id={`h-${category.slug}`} className="tpl-display bk-title">
                      {category.name}
                    </h2>
                  ) : (
                    <p className="tpl-display bk-title bk-title-more">{category.name}</p>
                  )}
                  <p aria-hidden className="bk-orn">
                    ◆ ◆ ◆
                  </p>
                </div>
                <ul className="bk-dishes">
                  {entry.products.map((product) => (
                    <Dish key={product.id} product={product} />
                  ))}
                </ul>
                <p aria-hidden className="bk-folio">
                  {n(index)}
                </p>
              </div>
            </section>
          );
        })}

        <div className="bk-nav">
          <button type="button" onClick={() => go(at - 1)} aria-disabled={at === 0} aria-label={t('tpl.previous')} className="bk-arrow">
            <span aria-hidden>←</span>
          </button>
          <button type="button" onClick={() => go(at + 1)} aria-disabled={at === last} aria-label={t('tpl.next')} className="bk-arrow">
            <span aria-hidden>→</span>
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </main>
  );
}

/** The index's dish of the house: a photo tilted a little, its name, price and add. */
function House({ product }: { product: MenuProductView }) {
  const { openProduct } = useTemplate();
  return (
    <div data-row className="bk-house">
      <div data-photo className="bk-house-photo tpl-plate">
        <ProductMedia product={product} suffix="book-house" sizes="(min-width: 640px) 320px, 70vw" className="bk-img" rounded={false} />
        <SaleChip product={product} className="bk-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display bk-house-name">
        {product.name}
      </button>
      <DishCounts product={product} />
      <span className="bk-house-foot">
        <Price product={product} className="bk-price" />
        <QuickAction product={product} variant="icon" className="relative z-[2]" />
      </span>
    </div>
  );
}

/** A dish on a page: its photo, the name over a dotted leader to the price, the description and the round add. The row opens the dish. */
function Dish({ product }: { product: MenuProductView }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="bk-dish">
      <div data-photo className="bk-photo tpl-plate">
        <ProductMedia product={product} suffix="book" sizes="96px" className="bk-img" rounded={false} />
        <SaleChip product={product} className="bk-off" />
      </div>
      <div className="bk-text">
        <div className="bk-line">
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display bk-dish-name text-start">
            {product.name}
          </button>
          <DishCounts product={product} />
          <span aria-hidden className="bk-leader" />
          <Price product={product} className="bk-price" />
        </div>
        <div className="bk-sub">
          <Description product={product} lines={2} className="bk-desc" />
          <QuickAction product={product} variant="icon" className="bk-add relative z-[2]" />
        </div>
      </div>
    </li>
  );
}
