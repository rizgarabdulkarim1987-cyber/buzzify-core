'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { localDigits } from '@/lib/digits';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { useKeepInView } from './shared/useKeepInView';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import './board.css';

/** Gate letters run A to Z, then A1 to Z1 and so on, so a menu with many sections still has distinct tabs. */
export function gateLetter(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  const round = Math.floor(index / 26);
  return round === 0 ? letter : `${letter}${round}`;
}

/** At most this many rows of one section are staggered, 30 ms apart, so a long section never waits to land. */
const STAGGER_ROWS = 8;

/**
 * A departures board (spec 2026-10-26-menu-styles-in-templates-design.md). Gate tabs (A, B, C…) stay at the top and
 * jump to a section; each section is a gate with a row per dish: photo, name, a gate code (letter and number in the
 * menu's numerals), the price, and an add button where ordering is on. All sections are on the page, so the template's
 * own jump and `#cat-<slug>` scrolling reach them. With motion allowed a row flaps in the first time it comes into view.
 */
export function BoardBody() {
  const { t, tenant } = useApp();
  const { categories, byCategory, activeId, jumpTo, reduced } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);

  // Keep the active gate tab in view, moving only the strip (never the page).
  useKeepInView(strip, activeId, 'x', reduced, 24);

  return (
    <div className="tpl-body" data-body="board">
      <nav aria-label={t('menu.categories')} className="tpl-nav bd-tabs">
        <ul ref={strip} className="scroll-hidden bd-tabs-strip">
          {categories.map((category, index) => (
            <li key={category.id} className="shrink-0">
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                aria-label={t('tpl.board.gate', { letter: gateLetter(index), name: category.name })}
                onClick={() => jumpTo(category.id)}
                className="bd-tab"
              >
                <b aria-hidden>{gateLetter(index)}</b>
                <span aria-hidden>{category.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const letter = gateLetter(index);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section bd-gate">
              <div tabIndex={-1} data-heading className="outline-none">
                <h2 id={`h-${category.slug}`} className="bd-gate-title">
                  <b aria-hidden>{letter}</b>
                  <span>{category.name}</span>
                </h2>
              </div>
              <ul className="bd-rows">
                {(byCategory.get(category.id) ?? []).map((product, row) => (
                  <Row key={product.id} product={product} code={`${letter}${localDigits(String(row + 1), tenant.numeralSystem)}`} order={row % STAGGER_ROWS} priority={index === 0 && row < 3} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Row({ product, code, order, priority }: { product: MenuProductView; code: string; order: number; priority: boolean }) {
  const { openProduct, reduced } = useTemplate();
  const row = useRef<HTMLLIElement>(null);

  // The first time the row is in view it flaps in. The attribute is set on the element itself (not through React state),
  // so nothing re-renders, and this runs once per row: it does not follow the list's identity.
  useEffect(() => {
    const node = row.current;
    if (!node || reduced || typeof IntersectionObserver === 'undefined') return;
    const bounds = node.getBoundingClientRect();
    if (bounds.top < window.innerHeight && bounds.bottom > 0) {
      node.dataset.flap = 'go';
      return;
    }
    node.dataset.flap = 'wait';
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      node.dataset.flap = 'go';
      observer.disconnect();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <li ref={row} data-row className="bd-row" style={{ '--i': order } as CSSProperties}>
      <div data-photo className="bd-photo">
        <ProductMedia product={product} suffix="board" sizes="72px" priority={priority} className="bd-img" />
      </div>
      <div className="bd-text">
        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open bd-name text-start">
          {product.name}
        </button>
        <span className="bd-sub">
          <span data-code className="bd-code">
            {code}
          </span>
          <Badges product={product} className="bd-badges" />
          <Description product={product} lines={1} className="bd-desc" />
        </span>
      </div>
      <div className="bd-end">
        <Price product={product} className="bd-price" />
        <QuickAction product={product} className="bd-add relative z-[2]" />
      </div>
    </li>
  );
}
