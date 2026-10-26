'use client';

import { useEffect, useRef, useState } from 'react';
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
 * pages are all in the document (the `cat-<slug>` ids stay for deep links); only the open one can be seen or focused.
 */
export function BookBody() {
  const { t } = useApp();
  const { categories, byCategory, jumpTo, setCategoryOpener, design } = useTemplate();
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const open = categories.some((category) => category.id === openId) ? openId : null;

  // The template's jumpTo (hero buttons, navigation) and a #cat-<slug> address both open a chapter through here.
  useEffect(() => {
    setCategoryOpener(setOpenId);
    return () => setCategoryOpener(null);
  }, [setCategoryOpener]);
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
      if (match) setOpenId(match.id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // After the page turns to a chapter, the view and focus move to its heading; after it turns back, focus returns to
  // the chapter that was open. Keyed on the open chapter only, so a re-render never scrolls the guest again.
  useEffect(() => {
    if (open) {
      shown.current = open;
      const spread = root.current?.querySelector<HTMLElement>(`[data-spread="${CSS.escape(open)}"]`);
      spread?.scrollIntoView({ behavior: 'auto', block: 'start' });
      spread?.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
    } else if (shown.current) {
      const from = shown.current;
      shown.current = null;
      root.current?.querySelector<HTMLElement>(`[data-chapter="${CSS.escape(from)}"]`)?.focus({ preventScroll: true });
      root.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }, [open]);

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
                      {position + 1}
                    </span>
                    <span className="tpl-display bk-name">{category.name}</span>
                    <span aria-hidden className="bk-leader" />
                    <span className="bk-count">{t('tpl.book.dishes', { count: products.length })}</span>
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
              <button type="button" onClick={() => setOpenId(null)} aria-label={t('tpl.book.toContents')} className="bk-ribbon">
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
