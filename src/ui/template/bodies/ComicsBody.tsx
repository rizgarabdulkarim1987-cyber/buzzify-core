'use client';

import { useRef, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { useKeepInView } from './shared/useKeepInView';
import './shared/shapes.css';
import './comics.css';

/**
 * How many of the page's two columns each panel spans: the first is a wide splash panel, then every fourth is wide
 * again and the rest sit side by side. A wide panel only starts on a fresh row and the last panel widens when it would
 * stand alone, so the two-column grid never has a hole.
 */
export function panelSpans(count: number): Array<1 | 2> {
  const spans: Array<1 | 2> = [];
  let column = 0;
  for (let index = 0; index < count; index += 1) {
    const wide = column === 0 && (index === 0 || index % 4 === 3 || index === count - 1);
    spans.push(wide ? 2 : 1);
    if (!wide) column = column === 0 ? 1 : 0;
  }
  return spans;
}

/**
 * Kitchen Comics (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a comic page: a caption box
 * (page number, name, panel count in the menu's numerals) over a dense panel grid, a wide splash panel first and the
 * others one or two columns wide. The dish photo is the panel art; its name speaks from a solid white speech bubble and
 * its price sits in a star burst, so text keeps its contrast on any photo. A strip of page chips stays at the top and
 * jumps, and lights the page in view. All pages are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them.
 */
export function ComicsBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, activeId, jumpTo, reduced } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  // Keep the lit chip in view, moving only the strip (never the page).
  useKeepInView(strip, activeId, 'x', reduced);

  return (
    <div className="tpl-body" data-body="comics">
      <nav aria-label={t('menu.categories')} data-pages className="tpl-strip-sticky cm-chips">
        <ul ref={strip} className="scroll-hidden cm-chips-list">
          {categories.map((category, index) => (
            <li key={category.id}>
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                onClick={() => jumpTo(category.id)}
                className="cm-chip"
              >
                <small aria-hidden>{n(index + 1)}</small>
                {category.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const spans = panelSpans(products.length);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-page={n(index + 1)}
              className="tpl-section tpl-tall-last cm-sheet"
            >
              <div tabIndex={-1} data-heading className="outline-none cm-head">
                <h2 id={`h-${category.slug}`} className="tpl-display cm-caption">
                  <small aria-hidden>{t('tpl.cmc.page', { n: n(index + 1) })}</small>
                  <span>{category.name}</span>
                  <b data-count aria-hidden>
                    {n(products.length)}
                  </b>
                </h2>
              </div>
              <ul className="cm-page">
                {products.map((product, row) => (
                  <Panel key={product.id} product={product} wide={spans[row] === 2} splash={row === 0} priority={index === 0 && row < 4} order={Math.min(index * 3 + row, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Panel({ product, wide, splash, priority, order }: { product: MenuProductView; wide: boolean; splash: boolean; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className={`cm-panel${wide ? ' cm-wide' : ''}${splash ? ' cm-splash' : ''}`} style={{ '--i': order } as CSSProperties}>
      <div data-photo className="cm-art">
        <ProductMedia product={product} suffix="comics" sizes={wide ? '(min-width: 640px) 440px, 92vw' : '(min-width: 640px) 220px, 46vw'} priority={priority} className="cm-img" rounded={false} />
      </div>
      <div className="cm-says">
        <div className="cm-bubble">
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open cm-name">
            {product.name}
          </button>
        </div>
        <i aria-hidden className="cm-tail" />
      </div>
      <Price product={product} className="cm-burst" />
      <QuickAction product={product} className="cm-add" />
      <Badges product={product} className="cm-badges" />
    </li>
  );
}
