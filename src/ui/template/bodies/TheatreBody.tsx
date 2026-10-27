'use client';

import { useRef } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import './shared/shapes.css';
import './theatre.css';

/**
 * Curtain and Spotlight (spec 2026-10-26-menu-styles-in-templates-design.md). A theatre: every section is a stage, a
 * proscenium with velvet curtains at its sides and a banner on the pelmet (the act number, the name and the dish
 * count in the menu's numerals); its dishes stand on the stage floor as spotlit performers, arch-topped photo cards
 * with a price ticket and a name plate, three across. A spotlight cone lights the stage in view and the others dim
 * (opacity on the stage's backdrop only: the dishes' own text is never dimmed). A sticky programme strip of act chips
 * jumps. The first time a stage comes into view its curtains part once (`useOnceInView` on `[data-stage]`; a translate, off with less
 * motion, never replayed). All stages are on the page, so the template's own jump and `#cat-<slug>` scrolling work.
 */
export function TheatreBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-stage', id: 'data-stage', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const lit = activeId ?? categories[0]?.id;

  return (
    <div ref={root} className="tpl-body" data-body="theatre">
      <SectionStrip marker="programme" prefix="th" className="th-bar" chip="th-chip">
        {(category, index) => (
          <>
            <small aria-hidden>{n(index + 1)}</small>
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-stage={category.id}
              data-lit={category.id === lit ? '' : undefined}
              className="tpl-section tpl-tall-last th-stage"
            >
              <div className="th-backdrop" aria-hidden />
              <div className="th-cone" aria-hidden />
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.thr.act', { n: n(index + 1) })} count={n(products.length)} className="th-pelmet" title="th-banner" />
              <ul className="th-floor">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="th"
                    suffix="theatre"
                    cell="th-performer tpl-rise"
                    head="th-frame"
                    price="th-ticket"
                    pricePlace="head"
                    media="fill"
                    inPhoto={<SaleChip product={product} className="th-off" />}
                    sizes="(min-width: 640px) 180px, 33vw"
                    priority={index === 0 && at < 6}
                    order={Math.min(index * 3 + at, 8)}
                  />
                ))}
              </ul>
              <span className="th-curtain th-curtain-s" aria-hidden />
              <span className="th-curtain th-curtain-e" aria-hidden />
            </section>
          );
        })}
      </main>
    </div>
  );
}
