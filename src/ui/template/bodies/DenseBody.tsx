'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { useLiveInView } from './float-motion';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './dense.css';
import './ads.css';
import './space-ctrl.css';

export const DENSE_MOTIFS = ['ads', 'space-ctrl'] as const;
export type DenseMotif = (typeof DENSE_MOTIFS)[number];

/**
 * Whether a dish's box spans two columns: on the classifieds page the first ad of every five is a display ad (photo
 * beside the words), as a real page mixes a few large ads among the small ones; the control room's modules are all one
 * size. A section of fewer than three dishes has no large ad (it would leave a hole).
 */
export function denseWide(motif: DenseMotif, at: number, count: number): boolean {
  return motif === 'ads' && count >= 3 && at % 5 === 0;
}

/** The pen's circle round a picked ad (a loose hand-drawn loop that overshoots its start), in a 100 × 100 box. */
const PEN = 'M52 4 C84 3 98 26 96 52 C94 82 70 97 46 96 C18 95 3 74 4 48 C5 22 24 6 58 8';

/**
 * The `dense` family (spec 2026-10-28-menu-styles-77-addendum.md): the densest browse shape, many small boxes in three
 * columns, so a phone's first screen shows eight dishes or more. Every box keeps a photo, the name (the tap target),
 * the price (with the sale) and the add button.
 *
 * - `ads`: a classifieds page. Small boxed ads, a grey newsprint photo, a bold title and the price; the ad a guest
 *   picks gets a red pen circle drawn round it (and keeps it).
 * - `space-ctrl`: a mission-control HUD (buzzify.me's deep-space look, no logo or agency copy). A radar sweeps at the
 *   head of the sticky strip; every section is a panel whose status lamp says ready; every dish is a module with a
 *   blinking lamp, a camera-feed photo (scan lines, corner brackets) and monospace readouts. Adding lights the module.
 *
 * The lamps and the radar run only while seen and untouched, and not at all with less motion.
 */
export function DenseBody({ motif }: { motif: DenseMotif }) {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  useLiveInView(root, '[data-dn-live]', reduced);

  const added = (button: HTMLButtonElement) => {
    const box = button.closest<HTMLElement>('[data-dn-box]');
    if (!box) return;
    box.setAttribute('data-picked', '');
    if (reduced || motif !== 'space-ctrl') return;
    box.animate([{ scale: '1' }, { scale: '1.04' }, { scale: '1' }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  const space = motif === 'space-ctrl';

  return (
    <div ref={root} className="tpl-body" data-body={motif} data-calm={reduced ? '' : undefined}>
      <SectionStrip
        marker="dense"
        prefix="dn"
        lead={
          space ? (
            <span aria-hidden data-dn-live className="dn-radar">
              <i className="dn-sweep" />
            </span>
          ) : undefined
        }
      >
        {(category) => (
          <>
            <i aria-hidden className="dn-chip-mark" />
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
              data-dn-live
              className="tpl-section tpl-tall-last dn-section"
            >
              <div className="dn-panel-head">
                <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="dn-head" title="dn-title" />
                {space ? (
                  <span className="dn-status">
                    <i aria-hidden className="dn-status-lamp" />
                    {t('tpl.dense.ready')}
                  </span>
                ) : null}
              </div>
              <ul className="dn-grid">
                {products.map((product, at) => (
                  <li
                    key={product.id}
                    data-dn-box
                    data-wide={denseWide(motif, at, products.length) ? '' : undefined}
                    className="dn-box"
                    style={{ '--i': at } as CSSProperties}
                  >
                    {space ? (
                      <span aria-hidden className="dn-code">
                        <span>{n(at + 1)}</span>
                        <i className="dn-lamp" />
                      </span>
                    ) : null}
                    <div className="dn-photo tpl-plate tpl-fill-media">
                      <ProductMedia product={product} suffix={motif} sizes="(min-width: 640px) 180px, 32vw" rounded={false} priority={index === 0 && at < 9} />
                    </div>
                    <div className="dn-text">
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open dn-name text-start">
                        {product.name}
                      </button>
                      <Badges product={product} className="dn-badges" />
                      <span className="dn-meta">
                        <Price product={product} className="dn-price" />
                        <QuickAction product={product} variant="icon" className="dn-add relative z-[2]" onAdded={added} />
                      </span>
                    </div>
                    {motif === 'ads' ? (
                      <svg aria-hidden className="dn-ring" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <path pathLength={1} d={PEN} />
                      </svg>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

export function AdsBody() {
  return <DenseBody motif="ads" />;
}
export function SpaceCtrlBody() {
  return <DenseBody motif="space-ctrl" />;
}
