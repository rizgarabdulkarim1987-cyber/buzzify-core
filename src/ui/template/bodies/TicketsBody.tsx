'use client';

import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './tickets.css';

/** Slight tilts (degrees) the tickets hang at, so the rail reads as hung by hand; the pattern repeats. */
const TILTS = [-0.6, 0.5, -0.3, 0.7, -0.5] as const;

/**
 * The Kitchen Ticket Rail (spec 2026-10-26-menu-styles-in-templates-design.md). A dark kitchen pass: every section is a
 * steel rail with its name and ticket count, and every dish hangs from it as its own paper order ticket (a clip tab, its
 * number, the photo, the name, a dashed rule, the price and a dark add stamp, a torn edge underneath), each hanging at its
 * own slight angle. On a phone the rails are stacked down the page; on a wide screen they run side by side. A steel
 * index of section numbers stays at the top and jumps, and lights the rail in view. All rails are on the page (no
 * sideways rail of columns, so every section stays one tap away and the page's own jump and `#cat-<slug>` scrolling
 * reach them).
 */
export function TicketsBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  /** The ticket number as three digits in the menu's numerals: #001. */
  const no = (at: number) => `#${n(Math.floor(at / 100) % 10)}${n(Math.floor(at / 10) % 10)}${n(at % 10)}`;

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
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-ticket={n(index + 1)} className="tpl-section tpl-tall-last tk-ticket">
              <div aria-hidden className="tk-clip" />
              <div className="tk-slab">
                <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.tkt.ticket', { n: n(index + 1) })} count={n(products.length)} className="tk-head" title="tk-title" />
                <ul className="tk-lines">
                  {products.map((product, row) => (
                    <Ticket
                      key={product.id}
                      product={product}
                      number={no(row + 1)}
                      tilt={TILTS[(index + row) % TILTS.length]!}
                      priority={index === 0 && row < 5}
                      order={Math.min(index * 3 + row, 8)}
                    />
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

function Ticket({ product, number, tilt, priority, order }: { product: MenuProductView; number: string; tilt: number; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="tk-row tk-slip" style={{ '--i': order, '--tilt': `${tilt}deg` } as CSSProperties}>
      <div data-photo className="tk-photo">
        <ProductMedia product={product} suffix="tickets" sizes="72px" priority={priority} className="tk-img" />
      </div>
      <div className="tk-text">
        <span className="tk-top">
          <span aria-hidden className="tk-no">
            {number}
          </span>
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tk-name text-start">
            {product.name}
          </button>
          <Badges product={product} className="tk-badges" />
        </span>
        <span className="tk-meta">
          <Price product={product} className="tk-price" />
          <QuickAction product={product} variant="icon" className="tk-add relative z-[2]" />
        </span>
      </div>
    </li>
  );
}
