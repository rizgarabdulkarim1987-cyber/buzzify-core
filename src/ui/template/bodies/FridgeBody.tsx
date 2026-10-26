'use client';

import type { CSSProperties } from 'react';
import { localDigits } from '@/lib/digits';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction } from '../parts';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './fridge.css';

/** The hues (degrees) of the lid stripes, spread around the wheel so neighbouring shelves differ; a seventh starts again. */
const HUES = [352, 28, 150, 205, 265, 48] as const;

/** The hue (in degrees) of the nth shelf's lid stripe. */
export function shelfHue(index: number): number {
  return hueAt(HUES, index);
}

/**
 * The Fridge (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is the inside of a fridge: every section is
 * a glass shelf (cool glass, a rail under each row of jars) with a frost label at its top (the shelf's number, its name
 * and its dish count in the menu's numerals); every dish is a jar: a lid band carrying the price, the photo in the jar's
 * glass and a name sticker below, three jars a row so many are on screen at once. A strip of fridge-door panels (each
 * with its handle) stays at the top and jumps, lighting the shelf in view. All shelves are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function FridgeBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="fridge">
      <SectionStrip marker="doors" prefix="fr" className="fr-doors" chip="fr-door" chipStyle={(_, index) => ({ '--s-h': shelfHue(index) }) as CSSProperties}>
        {(category) => <span className="fr-door-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-shelf={n(index + 1)}
              style={{ '--s-h': shelfHue(index) } as CSSProperties}
              className="tpl-section tpl-tall-last fr-shelf"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.frg.shelf', { n: n(index + 1) })} count={n(products.length)} className="fr-head" title="fr-frost" />
              <ul className="fr-row">
                {products.map((product, at) => (
                  <Jar key={product.id} product={product} priority={index === 0 && at < 6} order={Math.min(index * 3 + at, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Jar({ product, priority, order }: { product: MenuProductView; priority: boolean; order: number }) {
  const { t, tenant } = useApp();
  const { openProduct } = useTemplate();
  const off = product.regularPrice !== undefined && product.percentOff ? product.percentOff : 0;
  return (
    <li data-row className="fr-jar" style={{ '--i': order } as CSSProperties}>
      <div className="fr-glass">
        <Price product={product} className="tpl-price-tight fr-lid" />
        <div data-photo className="fr-photo">
          <ProductMedia product={product} suffix="fridge" sizes="112px" priority={priority} className="fr-img" rounded={false} />
          {off ? <span className="fr-off tabular-nums">{t('menu.percentOff', { percent: localDigits(String(off), tenant.numeralSystem) })}</span> : null}
          <QuickAction product={product} variant="icon" className="fr-add relative z-[2]" />
        </div>
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open fr-name text-center">
        {product.name}
      </button>
    </li>
  );
}
