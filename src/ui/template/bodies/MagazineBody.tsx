'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Nav } from '../navs';
import { DishCounts, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionHeading } from '../sections';
import { splitLead } from './lead';
import './shared/photo-card.css';
import './shared/shapes.css';
import './magazine.css';

/**
 * The menu as a magazine (spec 2026-10-26-menu-styles-in-templates-design.md). A masthead with the restaurant's name
 * and the issue line, the section strip (the template's navigation kind), then every section as a spread: a bento of
 * photo tiles, each dish a tile with its name and price on the picture. The first dish with a photo is the lead, a big
 * tile two columns wide and two rows tall; two dishes stand beside it, and the rest follow as wide and small tiles. All
 * sections are on the page (the `cat-<slug>` ids stay), so the template's own jump and hash scrolling reach them.
 */
export function MagazineBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, design } = useTemplate();
  const dishes = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body">
      <Nav kind={design.layout.nav} />
      <main id="menu" data-body="magazine" className="min-w-0">
        <div className="mg-mast">
          <p aria-hidden className="tpl-display mg-name">
            {tenant.logoText}
          </p>
          <p className="mg-issue">
            <span>
              {t('tpl.mag.sections', {
                count: categories.length,
                n: n(categories.length),
              })}
            </span>
            <span aria-hidden> · </span>
            <span>{t('tpl.book.dishes', { count: dishes, n: n(dishes) })}</span>
          </p>
        </div>
        {categories.map((category, index) => {
          const { lead, rest } = splitLead(byCategory.get(category.id) ?? []);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section mg-spread">
              <div tabIndex={-1} data-heading className="outline-none">
                <SectionHeading id={`h-${category.slug}`} name={category.name} index={index} style={design.layout.heading} />
              </div>
              <div className="tpl-section-body">
                <div className="mg-bento">
                  {lead && <Tile product={lead} shape="big" lead priority={index === 0} />}
                  {rest.map((product, at) => (
                    <Tile key={product.id} product={product} shape={at >= 2 && at % 2 === 0 ? 'wide' : 'small'} priority={index === 0 && at < 4} />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** One dish as a photo tile: the picture fills it, the caption (name, price, add) sits on a scrim at the foot. */
function Tile({ product, shape, lead = false, priority }: { product: MenuProductView; shape: 'big' | 'wide' | 'small'; lead?: boolean; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <article data-lead={lead ? '' : undefined} data-row className={`mg-tile mg-${shape}`}>
      <div data-zoom className="mg-photo">
        <ProductMedia
          product={product}
          suffix={lead ? 'lead' : 'tile'}
          sizes={shape === 'small' ? '(min-width: 768px) 15rem, 34vw' : '(min-width: 768px) 30rem, 68vw'}
          priority={priority}
          rounded={false}
          className="mg-img"
        />
      </div>
      <SaleChip product={product} className="tpl-photo-off mg-off" />
      <div className="mg-cap">
        <div className="mg-text">
          <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open mg-tile-name text-start${lead ? ' tpl-display mg-lead-name' : ''}`}>
            {product.name}
          </button>
          <DishCounts product={product} />
          <Price product={product} className="mg-price mg-lead-price" />
        </div>
        <QuickAction product={product} variant="icon" className="mg-add relative z-[2]" />
      </div>
    </article>
  );
}
