'use client';

import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/photo-card.css';
import './shared/shapes.css';
import './theatre.css';

/**
 * Curtain and Spotlight (the motion-thr mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A dark stage: a
 * sticky programme strip of pill chips, the menu's featured dish as a big arched hero under velvet curtains that part
 * once, then every section a stage lit by a spotlight cone (the one in view; the cone is a fade of its own layer) with
 * its name in the display face and its dishes as arch-topped cards, three across on a phone, each with its price and
 * a gold add key. The hero is shown only while no search or filter narrows the menu (it is hidden, not unmounted, so
 * the curtains never play again: the first time they finish, the hero is marked parted and the animation is off for good). All stages are on the page, so the template's own jump and `#cat-<slug>` scrolling work.
 */
export function TheatreBody() {
  const { locale, tenant } = useApp();
  const { t } = useApp();
  const { view, categories, byCategory, activeId, featured, signature } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const lit = activeId ?? categories[0]?.id;
  const shown = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  const lead = featured[0] ?? signature;

  return (
    <div className="tpl-body" data-body="theatre">
      <SectionStrip marker="programme" prefix="th" className="th-bar" chip="th-chip">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {lead && (
          <section aria-label={t('tpl.featured')} hidden={shown !== view.products.length} className="th-hero" onAnimationEnd={(event) => event.currentTarget.setAttribute('data-parted', '')}>
            <Hero product={lead} />
            <span className="th-curtain th-curtain-s" aria-hidden />
            <span className="th-curtain th-curtain-e" aria-hidden />
          </section>
        )}
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
              <div className="th-cone" aria-hidden />
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="th-pelmet" title="th-banner" />
              <ul className="th-floor">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="th"
                    suffix="theatre"
                    cell="th-performer tpl-rise"
                    head="th-frame"
                    price="th-price"
                    pricePlace="after"
                    media="fill"
                    inPhoto={<SaleChip product={product} className="th-off" />}
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

/** The featured dish: a big arch of photo under the spotlight, its name, its price and the add key. The whole card opens the dish. */
function Hero({ product }: { product: MenuProductView }) {
  const { openProduct } = useTemplate();
  return (
    <div data-row className="th-hero-card">
      <div data-photo className="th-hero-photo tpl-fill-media tpl-plate">
        <ProductMedia product={product} suffix="theatre-hero" sizes="(min-width: 640px) 480px, 90vw" priority className="th-img" rounded={false} />
        <SaleChip product={product} className="th-off th-hero-off" />
      </div>
      <div className="th-hero-foot">
        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display th-hero-name text-start">
          {product.name}
        </button>
        <Price product={product} className="tpl-price-tight th-hero-price" />
        <QuickAction product={product} variant="icon" className="th-hero-add relative z-[2]" />
      </div>
    </div>
  );
}
