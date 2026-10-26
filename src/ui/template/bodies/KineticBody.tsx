'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { dishWords, useRowEntrance } from './useRowEntrance';
import './shared/shapes.css';
import './kinetic.css';

/**
 * Dancing Letters (spec 2026-10-26-menu-styles-in-templates-design.md). A typographic menu: every dish is a poster-type
 * row, its name set large in the display face, its price in oversized numerals and a small round photo at the row's end.
 * Section headings are giant outlined words; a sticky strip of boxed chips jumps. When a row first comes into view its
 * words rise one after another and its price flips once (`useRowEntrance`; CSS transitions, only on the words, never on
 * letters, because Arabic and Kurdish letters stay joined); a row never plays twice, and with less motion nothing moves.
 */
export function KineticBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useRowEntrance(root, reduced);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div ref={root} className="tpl-body" data-body="kinetic">
      <SectionStrip marker="chips" prefix="kn">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last kn-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="kn-head" title="kn-title" />
              <ul className="kn-list">
                {products.map((product, at) => (
                  <KineticRow key={product.id} product={product} priority={index === 0 && at < 5} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** One poster row: the name's words, the price's numerals, the round photo; the row is the name button's tap area. */
function KineticRow({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  const words = dishWords(product.name);
  return (
    <li data-row data-id={product.id} className="kn-row">
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display kn-name text-start">
        {words.map((word, at) => (
          <span key={at}>
            {at > 0 ? ' ' : null}
            <span className="kn-word" style={{ '--w': at } as CSSProperties}>
              <span>{word}</span>
            </span>
          </span>
        ))}
      </button>
      <span className="kn-meta">
        <span className="kn-spin">
          <Price product={product} className="tpl-price-tight kn-price" />
        </span>
        <SaleChip product={product} className="kn-off" />
      </span>
      <div className="kn-thumb">
        <div data-photo className="kn-photo tpl-fill-media">
          <ProductMedia product={product} suffix="kinetic" sizes="(min-width: 640px) 96px, 52px" priority={priority} className="kn-img" rounded={false} />
        </div>
        <QuickAction product={product} variant="icon" className="tpl-rim-add kn-add relative z-[2]" />
      </div>
    </li>
  );
}
