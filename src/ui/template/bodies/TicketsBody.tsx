'use client';

import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { RowDish } from './shared/RowDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './tickets.css';

/**
 * The Kitchen Ticket Rail (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a paper kitchen ticket
 * hung from a steel rail: a clip, its number (in the menu's numerals), its name and dish count, and the dishes as the
 * lines of the ticket, each with photo, name, price and an add button. On a phone the tickets are full-width slips
 * stacked down the page; on a wide screen they hang side by side along the rail. A steel index of ticket numbers stays
 * at the top and jumps, and lights the ticket in view. All tickets are on the page (no sideways rail of columns, so
 * every ticket stays one tap away and the page's own jump and `#cat-<slug>` scrolling reach them).
 */
export function TicketsBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="tickets">
      <SectionStrip marker="index" prefix="tk" className="tk-index">
        {(category, index) => (
          <>
            <b aria-hidden>{n(index + 1)}</b>
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 tk-rail">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-ticket={n(index + 1)}
              className="tpl-section tpl-tall-last tk-ticket"
            >
              <div aria-hidden className="tk-clip" />
              <div className="tk-slip">
                <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.tkt.ticket', { n: n(index + 1) })} count={n(products.length)} className="tk-head" title="tk-title" />
                <ul className="tk-lines">
                  {products.map((product, row) => (
                    <RowDish key={product.id} product={product} prefix="tk" suffix="tickets" sizes="56px" priority={index === 0 && row < 5} order={Math.min(index * 3 + row, 8)} iconAdd />
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
