'use client';

import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { ProductList } from '../cards';
import { useTemplate } from '../context';
import { Nav } from '../navs';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionHeading } from '../sections';
import './magazine.css';

/**
 * The menu as a magazine (spec 2026-10-26-menu-styles-in-templates-design.md). A masthead with the restaurant's name
 * and the issue line, the section strip (the template's navigation kind), then every section as a spread: its first
 * dish is the lead, a large photo with name and price, and the rest follow in the template's card kind. All sections
 * are on the page (the `cat-<slug>` ids stay), so the template's own jump and hash scrolling reach them.
 */
export function MagazineBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, openProduct, design } = useTemplate();
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
            <span>{t('tpl.mag.sections', { count: categories.length, n: n(categories.length) })}</span>
            <span aria-hidden> · </span>
            <span>{t('tpl.book.dishes', { count: dishes, n: n(dishes) })}</span>
          </p>
        </div>
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          // The lead is the section's first dish that has a real photo (else its first dish); the rest keep menu order.
          const lead = products.find((product) => product.media[0]?.kind === 'image') ?? products[0];
          const rest = products.filter((product) => product !== lead);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section mg-spread">
              <div tabIndex={-1} data-heading className="outline-none">
                <SectionHeading id={`h-${category.slug}`} name={category.name} index={index} style={design.layout.heading} />
              </div>
              <div className="tpl-section-body">
                {lead && (
                  <article data-lead className="mg-lead">
                    <div data-zoom className="mg-photo">
                      <ProductMedia product={lead} suffix="lead" sizes="(min-width: 768px) 46rem, 100vw" priority={index === 0} rounded={false} className="mg-img" />
                    </div>
                    <div className="mg-cap">
                      <button type="button" onClick={() => openProduct(lead.id)} className="tpl-open tpl-display mg-lead-name text-start">
                        {lead.name}
                      </button>
                      <Price product={lead} className="mg-lead-price" />
                      <Badges product={lead} className="mg-badges" />
                      <QuickAction product={lead} className="mg-add relative z-[2]" />
                    </div>
                  </article>
                )}
                {rest.length > 0 && (
                  <div className="mg-rest">
                    <ProductList products={rest} kind={design.layout.card} />
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
