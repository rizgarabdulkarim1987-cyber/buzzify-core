'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/photo-card.css';
import './shared/shapes.css';
import './rugs.css';

/** The halparke line's dancers: a coat colour and a sash colour each, in turn (the rugs' own dyes). */
const COATS = ['#b3202a', '#2f7d4a', '#e9a51b', '#23306b'] as const;
const SASHES = ['#e9a51b', '#b3202a', '#2f7d4a', '#e9a51b'] as const;
const DANCERS = 11;

/**
 * Jajim and Nowruz (the themed-kurd mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A Kurdish evening: a
 * header scene of mountains with the Nowruz fire between them and a sparks burst, a saffron kilim band, a sticky strip
 * of red-bordered tabs, a line of dancers holding hands (the halparke), and under it each section as a red display title
 * over its dishes as framed cards, two across: a jajim-striped border (red, saffron, green, indigo), the photo, the name,
 * then the green add and the price, a red fringe under the card. The scene and the dancers are shown only while no
 * search or filter narrows the menu (hidden, not unmounted). The fire and the dancers move for a few seconds on arrival
 * and then stand still (a static scene has no pause control), and never again. The colours are the template's palette
 * (rugs.css), the dyes the rugs' own. All sections are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them.
 */
export function RugsBody() {
  const { locale, tenant } = useApp();
  const { view, categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const shown = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  // The fire and the dance last a few seconds on arrival; this marks the body when they are over so a later show of the scene (a cleared search) never replays them.
  const [still, setStill] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStill(true), 4200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="tpl-body" data-body="rugs" data-still={still ? '' : undefined}>
      <div className="rg-scene" hidden={shown !== view.products.length} aria-hidden>
        <div className="rg-sky">
          <svg className="rg-mountains" viewBox="0 0 430 120" preserveAspectRatio="none" focusable="false">
            <path d="M0 120 L0 70 L60 30 L110 64 L170 10 L230 60 L280 34 L340 70 L390 40 L430 62 L430 120 Z" fill="#3b2a4a" />
            <path d="M0 120 L0 92 L80 60 L150 90 L215 66 L290 96 L360 70 L430 92 L430 120 Z" fill="#2a1b33" />
          </svg>
          <div className="rg-fire">
            <i />
            <i />
            <i />
            {[-30, 10, 26, -12, 40].map((x, at) => (
              <i key={x} className="rg-spark" style={{ '--sx': `${x}px`, animationDelay: `-${at * 0.5}s` } as CSSProperties} />
            ))}
          </div>
        </div>
        <i className="rg-kilim" />
      </div>
      <SectionStrip marker="tabs" prefix="rg" className="rg-strip" chip="rg-tab">
        {(category) => <span className="rg-tab-label">{category.name}</span>}
      </SectionStrip>
      <div className="rg-dance" hidden={shown !== view.products.length} aria-hidden>
        {Array.from({ length: DANCERS }, (_, at) => (
          <Dancer key={at} coat={COATS[at % 4]!} sash={SASHES[at % 4]!} delay={at * 0.11} />
        ))}
      </div>
      <i aria-hidden className="rg-kilim rg-kilim-thin" />
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id)!;
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last rg-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="rg-front" title="rg-title" />
              <ul className="rg-grid">
                {products.map((product, at) => (
                  <Card key={product.id} product={product} priority={index < 2 && at < 6} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** One dancer of the line: arms out to the next one's hands, a coat and a sash in the rugs' dyes. */
function Dancer({ coat, sash, delay }: { coat: string; sash: string; delay: number }) {
  return (
    <svg className="rg-dancer" viewBox="0 0 34 56" focusable="false" style={{ animationDelay: `-${delay}s` }}>
      <circle cx="17" cy="7" r="5" fill="currentColor" />
      <path d="M17 12 L17 34" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M0 18 L17 16 L34 18" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M10 13 L24 13 L27 36 L7 36 Z" fill={coat} />
      <path d="M12 36 L9 54 M22 36 L25 54" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M8 24 L26 24" stroke={sash} strokeWidth="3" />
    </svg>
  );
}

/** A dish as a framed card: the photo, the name (the button that opens the dish; the card is its tap area), then the green add and the price. */
function Card({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="rg-card">
      <div data-photo className="rg-photo tpl-cover-media tpl-plate">
        <ProductMedia product={product} suffix="rugs" sizes="(min-width: 640px) 240px, 44vw" priority={priority} className="rg-img" rounded={false} />
        <SaleChip product={product} className="tpl-photo-off rg-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name rg-name text-start">
        {product.name}
      </button>
      <div className="rg-foot">
        <QuickAction product={product} variant="icon" className="rg-add relative z-[2]" />
        <Price product={product} className="tpl-price-tight rg-price" />
      </div>
    </li>
  );
}
