'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { ProductList } from '../cards';
import { useTemplate } from '../context';
import { Price, ProductMedia } from '../parts';
import { SectionHeading } from '../sections';
import './book.css';

/** Up to three dishes to show on a chapter's line in the index: the ones with a photo first. */
function sample(products: MenuProductView[]): MenuProductView[] {
  const pictured = products.filter((product) => product.media[0]?.kind === 'image');
  return [...pictured, ...products.filter((product) => !pictured.includes(product))].slice(0, 3);
}

function RibbonIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 7h14M5 12h14M5 17h9" />
    </svg>
  );
}

/**
 * The menu as a printed book (spec 2026-10-26-menu-styles-in-templates-design.md). The first page is the index: every
 * chapter with its dish count and a taste of its dishes. A chapter turns to its own page, whose ribbon turns back. The
 * pages are all in the document (the `cat-<slug>` ids stay for deep links); only the open one can be seen or focused,
 * and once a turn ends the closed ones leave the layout (book.css), so they take no room and load no photos.
 */
export function BookBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, jumpTo, setCategoryOpener, design } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // The chapter the guest turned to, and which turn it was: only a guest's turn (a chapter, the ribbon, the address)
  // moves the view and the focus, never a change of `categories` (search, filters) that hides or shows the open page.
  const [turn, setTurn] = useState<{ id: string | null; seq: number }>({ id: null, seq: 0 });
  const openId = turn.id;
  const turnTo = useCallback((id: string | null) => setTurn((previous) => ({ id, seq: previous.seq + 1 })), []);
  const shown = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const open = categories.some((category) => category.id === openId) ? openId : null;

  // The template's jumpTo (navigation, the next-chapter button) opens a chapter through here.
  useEffect(() => {
    setCategoryOpener(turnTo);
    return () => setCategoryOpener(null);
  }, [setCategoryOpener, turnTo]);
  // Read on arrival and when the address changes, never because the categories did (search, filters): a guest who has
  // turned to another chapter must stay there.
  const latest = useRef(categories);
  useEffect(() => {
    latest.current = categories;
  }, [categories]);
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
      const match = latest.current.find((category) => category.slug === slug);
      if (match) turnTo(match.id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [turnTo]);

  // After the guest turns to a chapter, the view and focus move to its heading; after they turn back, focus returns to
  // the chapter that was open. Keyed on the guest's turn only, so search and re-renders never scroll or refocus.
  useEffect(() => {
    if (turn.seq === 0) return;
    const target = turn.id !== null && latest.current.some((category) => category.id === turn.id) ? turn.id : null;
    if (target) {
      shown.current = target;
      const spread = root.current?.querySelector<HTMLElement>(`[data-spread="${CSS.escape(target)}"]`);
      spread?.scrollIntoView({ behavior: 'auto', block: 'start' });
      spread?.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
    } else if (shown.current) {
      const from = shown.current;
      shown.current = null;
      root.current?.querySelector<HTMLElement>(`[data-chapter="${CSS.escape(from)}"]`)?.focus({ preventScroll: true });
      root.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }, [turn]);

  return (
    <main id="menu" ref={root} data-body="book" data-open={open ?? ''} className="min-w-0">
      <div className="bk-book">
        <section data-page="index" data-state={open ? 'closed' : 'open'} inert={open !== null} aria-labelledby="bk-contents" className="bk-page">
          <h2 id="bk-contents" className="tpl-display bk-title">
            {t('tpl.book.contents')}
          </h2>
          <span aria-hidden className="bk-rule" />
          <ol className="bk-contents">
            {categories.map((category, position) => {
              const products = byCategory.get(category.id) ?? [];
              return (
                <li key={category.id} className="bk-entry">
                  <button type="button" data-chapter={category.id} onClick={() => jumpTo(category.id)} className="bk-chapter">
                    <span aria-hidden className="bk-folio">
                      {n(position + 1)}
                    </span>
                    <span className="tpl-display bk-name">{category.name}</span>
                    <span aria-hidden className="bk-leader" />
                    <span className="bk-count">{t('tpl.book.dishes', { count: products.length, n: n(products.length) })}</span>
                  </button>
                  <ul className="bk-taste">
                    {sample(products).map((product) => (
                      <li key={product.id}>
                        <ProductMedia product={product} suffix="book" sizes="96px" dim={false} className="bk-thumb" />
                        <span className="sr-only">{product.name}</span>
                        <Price product={product} className="bk-taste-price" />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>

        {categories.map((category, position) => {
          const next = categories[position + 1];
          const current = open === category.id;
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              data-page="spread"
              data-spread={category.id}
              data-state={current ? 'open' : 'closed'}
              inert={!current}
              aria-labelledby={`h-${category.slug}`}
              className="bk-page tpl-section"
            >
              <button type="button" onClick={() => turnTo(null)} aria-label={t('tpl.book.toContents')} className="bk-ribbon">
                <RibbonIcon />
              </button>
              <div tabIndex={-1} data-heading className="outline-none">
                <SectionHeading id={`h-${category.slug}`} name={category.name} index={position} style={design.layout.heading} />
              </div>
              <div className="tpl-section-body">
                <ProductList products={byCategory.get(category.id) ?? []} kind={design.layout.card} />
              </div>
              {next && (
                <button type="button" onClick={() => jumpTo(next.id)} aria-label={`${t('tpl.next')}: ${next.name}`} className="bk-next tpl-display">
                  <span>{next.name}</span>
                  <span aria-hidden className="bk-arrow">
                    →
                  </span>
                </button>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
