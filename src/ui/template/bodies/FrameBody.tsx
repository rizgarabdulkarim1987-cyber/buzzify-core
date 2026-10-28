'use client';

import { useRef } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { useLiveMarks } from './lens-depth';
import './shared/photo-card.css';
import './shared/shapes.css';
import './frame.css';
import './deco.css';
import './marquee.css';

/** The styles of the frame family (each section in an ornate frame, its dishes in two columns); each is its own body kind. */
export const FRAME_MOTIFS = ['deco', 'marquee'] as const;
export type FrameMotif = (typeof FRAME_MOTIFS)[number];

interface Look {
  /** The class prefix of the motif's own CSS. */
  prefix: string;
  /** The strip's data attribute. */
  marker: string;
  add: 'icon' | 'label';
  /** What the add feedback swells. */
  added: string;
  swell: number;
}

const LOOKS: Record<FrameMotif, Look> = {
  deco: { prefix: 'dc', marker: 'carriages', add: 'label', added: '.dc-arch', swell: 1.05 },
  marquee: { prefix: 'mq', marker: 'screens', add: 'icon', added: '.mq-poster', swell: 1.04 },
};

/**
 * The frame family (spec 2026-10-28-menu-styles-77-addendum.md): each section an ornate frame holding its dishes in two
 * columns, a sticky strip of sections over them. Each motif is its own body kind with its own drawing and motion:
 *
 * - `deco`, Art Deco: a 1920s luxury train's dining car in black and gold; a gold sunburst turning slowly at the top,
 *   frames with cut corners, photos arched like carriage doors, gold rules that draw as their section comes in.
 * - `marquee`, The Picture House: an old cinema at night; each section a sign ringed with chasing bulbs, its dishes
 *   film posters in glass frames, the price the ticket; a poster lights up when its dish is added. The house's name is
 *   the restaurant's own.
 *
 * With less motion the rules are drawn, the sun and the bulbs still: the structure stays.
 */
export function FrameFamily({ motif }: { motif: FrameMotif }) {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  const look = LOOKS[motif];
  const p = look.prefix;

  useOnceInView(root, reduced || motif !== 'deco', { item: 'data-frame', id: 'data-frame', mark: 'data-in' });
  useLiveMarks(root, !reduced, '[data-live-zone]');

  const added = (button: HTMLButtonElement) => {
    const dish = button.closest('[data-dish]');
    if (motif === 'marquee') dish?.querySelector('.mq-poster')?.setAttribute('data-lit', '');
    if (reduced) return;
    dish
      ?.querySelector(look.added)
      ?.animate([{ scale: '1' }, { scale: String(look.swell) }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      <SectionStrip
        marker={look.marker}
        prefix={p}
        chip="fr-chip"
        lead={
          motif === 'marquee' ? (
            <p aria-hidden className="mq-house tpl-display">
              {tenant.logoText}
            </p>
          ) : undefined
        }
      >
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className={`min-w-0 fr-main ${p}-main`}>
        {motif === 'deco' ? (
          <div aria-hidden data-live-zone className="dc-sun">
            <i className="dc-rays" />
          </div>
        ) : null}
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className={`tpl-section tpl-tall-last fr-section ${p}-section`}
            >
              <div data-frame={category.id} data-live-zone={motif === 'marquee' ? '' : undefined} className={`fr-sign ${p}-sign`}>
                {motif === 'deco' ? <i aria-hidden className="dc-rule" /> : null}
                {motif === 'marquee' ? (
                  <span aria-hidden className="mq-now">
                    {t('tpl.nowShowing')}
                  </span>
                ) : null}
                <ShapeHeading
                  id={`h-${category.slug}`}
                  name={category.name}
                  count={n(products.length)}
                  className={`fr-head ${p}-head`}
                  title={`fr-title ${p}-title`}
                />
                {motif === 'deco' ? <i aria-hidden className="dc-rule" /> : null}
              </div>
              <ul className={`fr-grid ${p}-frame`}>
                {products.map((product, at) => (
                  <li key={product.id} data-dish className={`fr-dish ${p}-dish`}>
                    <div className={motif === 'deco' ? 'dc-arch' : 'mq-poster'}>
                      <div className={`fr-photo ${p}-photo tpl-fill-media`}>
                        <ProductMedia
                          product={product}
                          suffix={motif}
                          sizes="(min-width: 640px) 320px, 46vw"
                          priority={index === 0 && at < 4}
                          rounded={false}
                        />
                      </div>
                    </div>
                    <div className={`fr-text ${p}-text`}>
                      <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open fr-name ${p}-name`}>
                        {product.name}
                      </button>
                      <Badges product={product} className={`fr-badges ${p}-badges`} />
                      <span className={`fr-meta ${p}-meta`}>
                        <Price product={product} className={`fr-price ${p}-price${motif === 'marquee' ? ' tpl-price-tight' : ''}`} />
                        <QuickAction product={product} variant={look.add} className={`fr-add ${p}-add relative z-[2]`} onAdded={added} />
                      </span>
                    </div>
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

/** Art Deco (kind `deco`). */
export function DecoBody() {
  return <FrameFamily motif="deco" />;
}
/** The Picture House (kind `marquee`). */
export function MarqueeBody() {
  return <FrameFamily motif="marquee" />;
}
