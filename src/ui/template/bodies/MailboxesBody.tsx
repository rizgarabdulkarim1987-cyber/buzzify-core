'use client';

import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './mailboxes.css';

/** The number on the nth box (counting from 0) along the whole menu: the first box is 101, as on a real mailbox wall. */
export function boxNumber(index: number): number {
  return 101 + index;
}

/**
 * The Mailbox Wall (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a wall of brass mailboxes under
 * a brass rail that carries its name (its number, the name and the dish count in the menu's numerals); every dish is a
 * box: a small door frame with its number (101 on, along the whole menu), the photo behind a glass window, the name on a
 * brass plate and the price on a stamp beside the number, three boxes a row so many are on screen at once. A strip of brass key tags stays
 * at the top and jumps, lighting the wall in view. All walls are on the page, so the template's own jump and
 * `#cat-<slug>` scrolling reach them.
 */
export function MailboxesBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Where each wall's first box falls along the whole menu: the dishes of the walls before it.
  const starts = categories.reduce<number[]>((all, category, at) => [...all, at === 0 ? 0 : all[at - 1]! + (byCategory.get(categories[at - 1]!.id)?.length ?? 0)], []);

  return (
    <div className="tpl-body" data-body="mailboxes">
      <SectionStrip marker="tags" prefix="bx" className="bx-tags" chip="bx-tag">
        {(category) => <span className="bx-tag-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const first = starts[index]!;
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-wall={n(index + 1)} className="tpl-section tpl-tall-last bx-wall">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.box.wall', { n: n(index + 1) })} count={n(products.length)} className="bx-head" title="bx-rail" />
              <ul className="bx-grid">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="bx"
                    suffix="mailbox"
                    cell="bx-box tpl-rise"
                    head="bx-door"
                    price="bx-stamp"
                    pricePlace="top"
                    media="cover"
                    extras={
                      <span className="bx-no tabular-nums" aria-hidden>
                        {n(boxNumber(first + at))}
                      </span>
                    }
                    inPhoto={<SaleChip product={product} className="bx-off" />}
                    addInPhoto
                    sizes="(min-width: 640px) 180px, 33vw"
                    priority={index === 0 && at < 6}
                    order={Math.min(index * 3 + at, 8)}
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
