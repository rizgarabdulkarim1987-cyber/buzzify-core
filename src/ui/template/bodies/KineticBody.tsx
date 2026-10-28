'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { dishWords, useRowEntrance } from './useRowEntrance';
import './shared/photo-card.css';
import './shared/shapes.css';
import './kinetic.css';

/**
 * Dancing Letters (the motion-kin mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A typographic poster on
 * paper: a black marquee band of the section names slides once, a sticky strip of boxed chips jumps, and each section is
 * a giant display word over a two-column grid of big square photos, every dish with its name in bold, its price in
 * oversized numerals and a red add square. The words rise one after another (the section's word and each dish name),
 * the photos are revealed bottom-up and the price flips, each once, the first time it comes into view (`useOnceInView`;
 * CSS transitions on whole words, never letters, because Arabic and Kurdish letters stay joined). With less motion
 * nothing is hidden or moves.
 */
export function KineticBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useRowEntrance(root, reduced);
  useOnceInView(root, reduced, { item: 'data-sec', id: 'data-sec', mark: 'data-seen', line: 0.92 });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div ref={root} className="tpl-body" data-body="kinetic">
      <Marquee names={categories.map((category) => category.name)} />
      <SectionStrip marker="chips" prefix="kn">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-sec={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last kn-section">
              <div tabIndex={-1} data-heading className="kn-head outline-none">
                <h2 id={`h-${category.slug}`} className="tpl-display kn-title">
                  <span>
                    {dishWords(category.name).map((word, at) => (
                      <span key={at}>
                        {at > 0 ? ' ' : null}
                        <span className="kn-word" style={{ '--w': at } as CSSProperties}>
                          <span>{word}</span>
                        </span>
                      </span>
                    ))}
                  </span>
                  <b data-count aria-hidden>
                    {n(products.length)}
                  </b>
                </h2>
              </div>
              <ul className="kn-grid">
                {products.map((product, at) => (
                  <KineticItem key={product.id} product={product} at={at} priority={index === 0 && at < 4} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The black band: the section names, slid once into place (decoration only; the strip below is the navigation). */
function Marquee({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const half = (key: string) => (
    <span key={key} className="kn-mq-half">
      {[0, 1].flatMap((round) => names.map((name, at) => <span key={`${round}-${at}`}>{name}<b>{'●'}</b></span>))}
    </span>
  );
  return (
    <div className="kn-marquee" aria-hidden>
      <span className="kn-mq-track">
        {half('a')}
        {half('b')}
      </span>
    </div>
  );
}

/** One dish of the grid: the big square photo, the name's words, the price numerals and the red add; the cell is the name button's tap area. */
function KineticItem({ product, at, priority }: { product: MenuProductView; at: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  const words = dishWords(product.name);
  return (
    <li data-row data-id={product.id} className="kn-item" style={{ '--d': `${(at % 2) * 90}ms` } as CSSProperties}>
      <div data-photo className="kn-photo tpl-cover-media tpl-plate">
        <ProductMedia product={product} suffix="kinetic" sizes="(min-width: 1024px) 240px, (min-width: 640px) 30vw, 46vw" priority={priority} className="kn-img" rounded={false} />
        <SaleChip product={product} className="tpl-photo-off kn-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open kn-name text-start">
        {words.map((word, i) => (
          <span key={i}>
            {i > 0 ? ' ' : null}
            <span className="kn-word" style={{ '--w': i } as CSSProperties}>
              <span>{word}</span>
            </span>
          </span>
        ))}
      </button>
      <div className="kn-foot">
        <span className="kn-spin">
          <Price product={product} className="tpl-price-tight kn-price" />
        </span>
        <QuickAction product={product} variant="icon" className="kn-add relative z-[2]" />
      </div>
    </li>
  );
}
