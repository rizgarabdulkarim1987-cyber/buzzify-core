'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { CARPET_VARS, weaveOf } from './carpet-night';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './carpet.css';

/**
 * One Thousand and One Nights (spec 2026-10-26-menu-styles-in-templates-design.md). Scheherazade's night: a purple sky of
 * stars. Every section is a magic carpet: a woven band (a lattice of threads over its ground, a tassel fringe at both
 * ends, its corners a little curved) with the section's number, name and dish count embroidered on its front edge, and
 * the dishes on it as round medallions, three across on a phone: a gold-ringed round photo, the price in a small
 * gold-edged tag across its foot, the name under it, the add on the rim. The sticky strip is a row of rolled carpets (a rolled-carpet icon and the
 * name); the one in view is lit, and its carpet floats a few pixels the first time it is the one in view (nothing else
 * moves but the stars' slow twinkle). The fixed colours come from carpet-night.ts as custom properties on the body (one
 * source). All carpets are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function CarpetBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Weaves and numbers go by the section's place in the full menu, so a search never recolours or renumbers a carpet.
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const floated = useRef(new Set<string>());
  // A carpet floats only the first time it is the one in view: the mark is set once per carpet and taken off when the
  // float ends, so coming back to it, a search that redraws it or a new list of categories never plays it again.
  useEffect(() => {
    const node = root.current;
    if (!node || !activeId || floated.current.has(activeId)) return;
    floated.current.add(activeId);
    node.querySelector('[data-float]')?.removeAttribute('data-float');
    node.querySelector(`[data-carpet="${CSS.escape(activeId)}"]`)?.setAttribute('data-float', '');
  }, [activeId]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const settle = (event: AnimationEvent) => {
      if (event.animationName === 'cp-float') (event.target as Element).removeAttribute('data-float');
    };
    node.addEventListener('animationend', settle);
    return () => node.removeEventListener('animationend', settle);
  }, []);

  return (
    <div ref={root} className="tpl-body" data-body="carpet" style={CARPET_VARS as CSSProperties}>
      <SectionStrip marker="rolls" prefix="cp" className="cp-strip" chip="cp-roll">
        {(category) => (
          <>
            <span aria-hidden className="cp-roll-icon" />
            <span className="cp-roll-name">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const weave = weaveOf(placeOf(category));
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              data-carpet={category.id}
              aria-labelledby={`h-${category.slug}`}
              data-lit={category.id === activeId ? '' : undefined}
              style={{ '--cp-base': weave.base, '--cp-thread': weave.thread } as CSSProperties}
              className="tpl-section tpl-tall-last cp-carpet"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="cp-front" title="cp-title" />
              <div className="cp-rug">
                <i aria-hidden className="cp-tassel" />
                <i aria-hidden className="cp-tassel" />
                <ul className="cp-grid">
                  {products.map((product, at) => (
                    <Medallion key={product.id} product={product} priority={index < 2 && at < 6} />
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** A dish on the carpet: the round photo in its gold ring with the price tag across its foot and the add on its rim, then the name (the whole cell opens the dish). */
function Medallion({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="cp-medallion">
      <div className="cp-disc">
        <div data-photo className="cp-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="carpet" sizes="(min-width: 1024px) 160px, (min-width: 640px) 18vw, 30vw" priority={priority} className="cp-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tpl-photo-off cp-off" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add cp-add" />
        <Price product={product} className="tpl-price-tight cp-price" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name cp-name">
        {product.name}
      </button>
    </li>
  );
}
