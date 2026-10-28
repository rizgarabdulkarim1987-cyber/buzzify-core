'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { IconDish } from './shared/IconDish';
import { SectionStrip } from './shared/SectionStrip';
import { useDepthShift } from './useDepthShift';
import './shared/shapes.css';
import './depth.css';

/**
 * Scroll Depth (the motion-dep mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A black gallery: a sticky strip
 * of plain words (the lit one underlined), the menu's featured dish as a huge framed photo with its name, price and add
 * under it, then every section titled by its name in giant outlined letters that slide sideways as the page scrolls (the
 * echo of the name is decoration), over a two-across grid of tall frames. Every photo is larger than its frame and
 * shifts inside it as the page scrolls. The shift and the slide are CSS scroll-driven animations where the browser has
 * them, else a small scroll fallback (`useDepthShift`) that touches only what is in view; none of it when the guest
 * prefers less motion. The hero is shown only while no search or filter narrows the menu, and stands in for its dish
 * in the grid then. All sections are on the page,
 * so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function DepthBody() {
  const { t, locale, tenant } = useApp();
  const { view, categories, byCategory, reduced, featured, signature } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useDepthShift(root, reduced);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const shown = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  const lead = featured[0] ?? signature;
  // The hero is its dish's place while it is shown (so the first screen never counts one dish twice); a search brings the dish back to its section.
  const heroOn = !!lead && shown === view.products.length;

  return (
    <div ref={root} className="tpl-body" data-body="depth" data-hero={heroOn ? '' : undefined} data-reduced={reduced ? '' : undefined}>
      <SectionStrip marker="chips" prefix="dp">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {lead && (
          <section aria-label={t('tpl.featured')} hidden={!heroOn} className="dp-hero">
            <Hero product={lead} />
          </section>
        )}
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-depth={n(index + 1)} style={{ '--dir': index % 2 ? -1 : 1 } as CSSProperties} className="tpl-section tpl-tall-last dp-section">
              <div tabIndex={-1} data-heading data-band className="dp-head outline-none">
                <h2 id={`h-${category.slug}`} className="tpl-display dp-title">
                  <span>{category.name}</span>
                  <span aria-hidden className="dp-echo">
                    {` · ${category.name} · ${category.name}`}
                  </span>
                  <b data-count aria-hidden>
                    {n(products.length)}
                  </b>
                </h2>
              </div>
              <ul className="dp-grid">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="dp"
                    suffix="depth"
                    cell="dp-card tpl-rise"
                    head="dp-frame"
                    price="dp-price"
                    pricePlace="below"
                    media="cover"
                    inPhoto={<SaleChip product={product} className="dp-off" />}
                    sizes="(min-width: 640px) 640px, 50vw"
                    priority={index === 0 && at < 4}
                    order={Math.min(index * 2 + at, 8)}
                    cellProps={products.length > 1 && product.id === lead?.id ? { 'data-lead': '' } : undefined}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The featured dish: a huge frame whose photo shifts inside it, then its name, price and add. The whole card opens the dish. */
function Hero({ product }: { product: MenuProductView }) {
  const { openProduct } = useTemplate();
  return (
    <div data-row className="dp-card dp-hero-card">
      <div data-photo className="dp-photo dp-hero-photo tpl-cover-media tpl-plate">
        <ProductMedia product={product} suffix="depth-hero" sizes="(min-width: 640px) 640px, 100vw" priority className="dp-img" rounded={false} />
        <SaleChip product={product} className="dp-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display dp-hero-name text-start">
        {product.name}
      </button>
      <Price product={product} className="tpl-price-tight dp-hero-price" />
      <QuickAction product={product} variant="icon" className="tpl-rim-add dp-add dp-hero-add relative z-[2]" />
    </div>
  );
}
