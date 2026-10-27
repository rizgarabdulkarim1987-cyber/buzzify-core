'use client';

import { useRef, useState } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './shared/name-chip.css';
import './gate.css';

/**
 * Ishtar Gate (poster themed-bab of the 35 mockups; spec 2026-10-26-menu-styles-in-templates-design.md). Babylon's glazed
 * lapis-blue brick with gold. The menu's featured dish (the first featured one, else the first dish) stands in the GATE at
 * the top of the page: its photo in a tall arched frame edged in gold, two lapis door leaves studded with gold that part
 * once over it, and its name, price and add beside it (it is the dish's own cell, so no dish is shown twice; with no other
 * dish in its section it stays in the grid and there is no gate). A band of gold rosettes, then a sticky strip of square
 * gold-edged tabs (one per section, the one in view filled with gold) jumps. Each section is a centred heading over a
 * grid of arched relief cards (lapis, edged in gold, the photo under a round arch, the name, the gold price and the add
 * under it, the discount on the card's foot). The cards of a section drop in once, the first time it comes into view
 * (`useOnceInView` on `[data-gate]`; opacity and transform, off with less motion, never replayed, never hiding a dish when
 * the observer does not report). All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling
 * reach them.
 */
export function GateBody() {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, featured, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-gate', id: 'data-gate', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a section.
  const placeOf = usePlaceOf();
  // The doors part once: a gate that mounts later (a search cleared) is already open.
  const [seen, setSeen] = useState(false);
  // The gate's dish: the featured one while it is still among the results (and not alone in its section), else the first dish.
  const first = featured[0] ?? categories.flatMap((category) => byCategory.get(category.id) ?? [])[0];
  const home = first ? categories.find((category) => (byCategory.get(category.id) ?? []).some((product) => product.id === first.id)) : undefined;
  const hero = first && home && (byCategory.get(home.id) ?? []).length > 1 ? first : undefined;

  return (
    <div ref={root} className="tpl-body" data-body="gate">
      {hero ? <Gate product={hero} label={t('tpl.featured')} open={seen} onOpened={() => setSeen(true)} /> : null}
      <span aria-hidden className="gt-band" />
      <SectionStrip marker="gates" prefix="gt" className="gt-strip" chip="tpl-name-chip gt-chip">
        {(category) => <span className="tpl-chip-name gt-chip-name">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = (byCategory.get(category.id) ?? []).filter((product) => product.id !== hero?.id);
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-gate={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last gt-gate">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="gt-head" title="gt-title" />
              <ul className="gt-grid">
                {products.map((product, at) => (
                  <Tile key={product.id} product={product} at={at} priority={index < 1 && at < 4} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/**
 * The gate: the featured dish's photo in a tall arched frame with two door leaves that part once, and beside it the
 * name, the price and the add (the discount on the frame's foot). The whole cell opens the dish.
 */
function Gate({ product, label, open, onOpened }: { product: MenuProductView; label: string; open: boolean; onOpened: () => void }) {
  const { openProduct } = useTemplate();
  return (
    <div className="gt-hero-wrap">
      <div data-row data-hero data-opened={open ? '' : undefined} className="gt-hero">
        <div className="gt-arch">
          <div data-photo className="gt-photo tpl-cover-media tpl-plate">
            <ProductMedia product={product} suffix="gate" sizes="(min-width: 640px) 320px, 40vw" priority className="gt-img" rounded={false} />
          </div>
          <span aria-hidden className="gt-leaf gt-leaf-s" onAnimationEnd={onOpened} />
          <span aria-hidden className="gt-leaf gt-leaf-e" />
        </div>
        <SaleChip product={product} className="tpl-photo-off gt-off" />
        <div className="gt-cap">
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display gt-hero-name">
            <span className="sr-only">{label}: </span>
            {product.name}
          </button>
          <div className="gt-meta">
            <Price product={product} className="gt-price" />
            <QuickAction product={product} variant="icon" className="tpl-rim-add gt-add" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A dish as an arched relief card: the photo under a round arch in a lapis card edged in gold, the discount on the
 * photo's foot, the name, then the price and the add on a row. The whole card opens the dish; `at` staggers the drop-in.
 */
function Tile({ product, at, priority }: { product: MenuProductView; at: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="gt-tile" style={{ ['--gt-at' as string]: Math.min(at, 8) }}>
      <div className="gt-relief">
        <div data-photo className="gt-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="gate" sizes="(min-width: 640px) 200px, 30vw" priority={priority} className="gt-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tpl-photo-off gt-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name gt-name">
        {product.name}
      </button>
      <div className="gt-meta">
        <Price product={product} className="gt-price" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add gt-add" />
      </div>
    </li>
  );
}
