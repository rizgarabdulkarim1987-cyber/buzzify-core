'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/photo-card.css';
import './shared/shapes.css';
import './carpet.css';

/**
 * One Thousand and One Nights (the kurd-arab-lyl mockup, spec 2026-10-26-menu-styles-in-templates-design.md).
 * Scheherazade's night: a purple sky of stars. At the top the menu's featured dish rides a flying carpet (its photo in a
 * red frame with a dashed gold line inside, a gold tassel fringe at both ends, a caption of its name, price and add);
 * the carpet floats a few pixels, twice, on arrival and then lies still. A sticky strip of gold pills jumps, and each
 * section is a gold display title over its dishes as rounded cards (a photo, the name, the price and a gold add), three
 * across on a phone. The hero is shown only while no search or filter narrows the menu (hidden, not unmounted, so it never
 * floats again). The colours are the template's palette (carpet.css), so the default palette is the mockup's night.
 * All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function CarpetBody() {
  const { t, locale, tenant } = useApp();
  const { view, categories, byCategory, featured, signature } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const shown = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  const lead = featured[0] ?? signature;

  return (
    <div className="tpl-body" data-body="carpet">
      {lead && (
        <section aria-label={t('tpl.featured')} hidden={shown !== view.products.length} className="cp-flight" onAnimationEnd={(event) => event.currentTarget.setAttribute('data-floated', '')}>
          <FlyingCarpet product={lead} />
        </section>
      )}
      <SectionStrip marker="rolls" prefix="cp" className="cp-strip" chip="cp-roll">
        {(category) => <span className="cp-roll-name">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last cp-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="cp-front" title="cp-title" />
              <ul className="cp-grid">
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

/** The featured dish on its carpet: the framed photo with a fringe at both ends, then the caption. The whole carpet opens the dish. */
function FlyingCarpet({ product }: { product: MenuProductView }) {
  const { openProduct } = useTemplate();
  return (
    <div data-row className="cp-carpet">
      <div className="cp-ride">
        <i aria-hidden className="cp-tassel" />
        <i aria-hidden className="cp-tassel" />
        <div data-photo className="cp-hero-photo tpl-fill-media tpl-plate">
          <ProductMedia product={product} suffix="carpet-hero" sizes="(min-width: 640px) 560px, 90vw" priority className="cp-img" rounded={false} />
          <SaleChip product={product} className="tpl-photo-off cp-off" />
        </div>
      </div>
      <div className="cp-cap">
        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display cp-cap-name text-start">
          {product.name}
        </button>
        <Price product={product} className="tpl-price-tight cp-cap-price" />
        <QuickAction product={product} variant="icon" className="cp-cap-add relative z-[2]" />
      </div>
    </div>
  );
}

/** A dish as a rounded card: the photo, the name (the button that opens the dish; the card is its tap area), the price and the gold add. */
function Card({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="cp-card">
      <div data-photo className="cp-photo tpl-cover-media tpl-plate">
        <ProductMedia product={product} suffix="carpet" sizes="(min-width: 1024px) 200px, (min-width: 640px) 22vw, 31vw" priority={priority} className="cp-img" rounded={false} />
        <SaleChip product={product} className="tpl-photo-off cp-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name cp-name text-start">
        {product.name}
      </button>
      <div className="cp-foot">
        <Price product={product} className="tpl-price-tight cp-price" />
        <QuickAction product={product} variant="icon" className="cp-add relative z-[2]" />
      </div>
    </li>
  );
}
