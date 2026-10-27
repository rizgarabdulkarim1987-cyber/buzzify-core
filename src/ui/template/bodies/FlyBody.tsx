'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { QuickAction } from '../parts';
import { flyToCart } from './fly-flight';
import { PhotoCard } from './shared/PhotoCard';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './fly.css';

/**
 * Fly to Cart (spec 2026-10-26-menu-styles-in-templates-design.md). An ordering-first dense menu: every section is a
 * labelled shelf (its name, its dish count, a ledge line) holding a uniform grid of compact square dish cards, three
 * across on a phone (more on a wide screen): the photo, the name, the price, and a big round + on the photo's corner.
 * Adding with + flies a small copy of the photo to the cart bar, which then pulses once (fly-flight.ts). Where ordering
 * is off the cards are plain tap-to-open cards with no +. A sticky strip of pill tabs at the top jumps to a section; all
 * sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function FlyBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="fly">
      <SectionStrip marker="tabs" prefix="fl">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-shelf={n(index + 1)} className="tpl-section tpl-tall-last fl-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="fl-head" title="fl-title" />
              <ul className="fl-grid">
                {products.map((product, at) => (
                  <PhotoCard
                    key={product.id}
                    product={product}
                    prefix="fl"
                    suffix="fly"
                    className="fl-card"
                    style={{ '--i': Math.min(index * 3 + at, 8) } as CSSProperties}
                    sizes="(min-width: 1024px) 220px, (min-width: 640px) 25vw, 33vw"
                    priority={index === 0 && at < 6}
                    add={<QuickAction product={product} variant="icon" className="tpl-rim-add fl-add" onAdded={(button) => flyToCart({ photo: button.closest('[data-photo]'), button, reduced })} />}
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
