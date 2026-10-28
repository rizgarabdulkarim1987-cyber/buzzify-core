'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './bento.css';

/** How many compartments a row of the tray has: three, or two when a box holds just two dishes (the mockup's `n2`). */
export function trayColumns(count: number): 2 | 3 {
  return count === 2 ? 2 : 3;
}

/**
 * The Bento Box (spec 2026-10-26-menu-styles-in-templates-design.md, the mockup layout-2-bnt). The whole menu is one
 * black lacquer bento box on a wooden table, with a pair of chopsticks laid across its top: every section is a red
 * compartment tray inside it (a paper label with its number, name and dish count in the menu's numerals), cut into
 * square compartments three across (two across for a section of two), each dish's photo filling its compartment with a
 * paper flag at its foot carrying the add button and the name, and the price on an accent flag at its corner. A strip
 * of lid-handle tabs stays at the top and jumps, lighting the tray in view. All trays are on the page, so the template's
 * own jump and `#cat-<slug>` scrolling reach them.
 */
export function BentoBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="bento">
      <div aria-hidden className="bn-sticks">
        <i />
        <i />
      </div>
      <SectionStrip marker="lids" prefix="bn" className="bn-lids" chip="bn-lid">
        {(category) => <span className="bn-lid-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        <div className="bn-lacquer">
          {categories.map((category, index) => {
            const products = byCategory.get(category.id) ?? [];
            return (
              <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-box={n(index + 1)} className="tpl-section tpl-tall-last bn-box">
                <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.bnt.box', { n: n(index + 1) })} count={n(products.length)} className="bn-head" title="bn-tag" />
                <ul className="bn-tray" data-cols={trayColumns(products.length)}>
                  {products.map((product, at) => (
                    <Compartment key={product.id} product={product} priority={index === 0 && at < 6} order={Math.min(index * 3 + at, 8)} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function Compartment({ product, priority, order }: { product: MenuProductView; priority: boolean; order: number }) {
  return (
    <IconDish
      product={product}
      prefix="bn"
      suffix="bento"
      cell="bn-cell tpl-rise"
      head="bn-top"
      price="bn-price"
      pricePlace="head"
      media="cover"
      extras={<SaleChip product={product} className="bn-off" />}
      sizes="(min-width: 640px) 220px, 34vw"
      priority={priority}
      order={order}
    />
  );
}
