'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import './shared/shapes.css';
import './reveal.css';
import './opera.css';
import './resmal.css';
import './khurjin.css';
import './sadaf.css';
import './mashra.css';
import './fold.css';
import './tone.css';

/** The styles of the reveal family (a cover over each dish or section opens once, near the screen's middle); each is its own body kind. */
export const REVEAL_MOTIFS = ['opera', 'resmal', 'khurjin', 'sadaf', 'mashra', 'fold', 'tone'] as const;
export type RevealMotif = (typeof REVEAL_MOTIFS)[number];

/** How far up the screen (from its foot, 0 to 1) a cover's top must come before it opens: a little past the middle. */
export const REVEAL_LINE = 0.62;

/**
 * Whether every cover stays open: while a search or a filter leaves fewer dishes than the menu has, the results are
 * never behind a cover (`shown` dishes on the page, `total` in the menu).
 */
export function everyOpen(shown: number, total: number): boolean {
  return shown < total;
}

/** The folded paper's halves: the dishes printed on the top half (the first `top`) and the ones on the folded lower half. */
export function foldSplit<T>(items: readonly T[], top = 2): [T[], T[]] {
  return [items.slice(0, top), items.slice(top)];
}

/** A dish's delay (ms) in opening: a row opens across from the start, `step` apart, `cols` dishes a row. */
export function revealDelay(at: number, cols: number, step = 90): number {
  return cols > 0 ? (((at % cols) + cols) % cols) * step : 0;
}

interface Look {
  /** The class prefix of the motif's own CSS. */
  prefix: string;
  /** The strip's data attribute (`tiers` gives `data-tiers`). */
  marker: string;
  /** What carries the cover: each dish, or each section as a whole (the tent's door, the paper's fold). */
  cover: 'dish' | 'section';
  /** Dishes a row on a phone (for the opening's stagger and the photo sizes). */
  cols: 2 | 3;
  add: 'icon' | 'label';
  /** Description lines under the name (0: none). */
  describe: 0 | 1 | 2;
  /** What the add feedback swells, and how far. */
  added: 'photo' | 'row' | 'text';
  swell: number;
}

const LOOKS: Record<RevealMotif, Look> = {
  opera: { prefix: 'op', marker: 'tiers', cover: 'dish', cols: 3, add: 'icon', describe: 0, added: 'photo', swell: 1.06 },
  resmal: { prefix: 'rs', marker: 'tents', cover: 'section', cols: 3, add: 'icon', describe: 0, added: 'row', swell: 1.06 },
  khurjin: { prefix: 'kj', marker: 'bags', cover: 'dish', cols: 2, add: 'label', describe: 0, added: 'photo', swell: 1.06 },
  sadaf: { prefix: 'sd', marker: 'boxes', cover: 'dish', cols: 2, add: 'label', describe: 0, added: 'text', swell: 1.05 },
  mashra: { prefix: 'mr', marker: 'windows', cover: 'dish', cols: 2, add: 'label', describe: 0, added: 'photo', swell: 1.04 },
  fold: { prefix: 'fd', marker: 'papers', cover: 'section', cols: 2, add: 'label', describe: 0, added: 'photo', swell: 1.06 },
  tone: { prefix: 'tn', marker: 'pages', cover: 'dish', cols: 2, add: 'label', describe: 2, added: 'photo', swell: 1.05 },
};

/**
 * The reveal family (spec 2026-10-28-menu-styles-77-addendum.md): every section on the page, a sticky strip of
 * sections, and a cover that opens once, the first time its dish (or its section) comes a little past the middle of the
 * screen (`useOnceInView` on `[data-cover]`, as the theatre's curtains). The cover only ever hides or veils the PHOTO:
 * the name, the price and the add button are always readable. Covers on the first screen are open from the start, every
 * cover is open while a search or a filter is on (`data-all`), and with less motion the hook never arms, so nothing is
 * ever drawn shut. Each motif is its own body kind with its own drawing (CSS under `[data-body='<motif>']`):
 *
 * - `opera`, The Opera Boxes: each section a tier of gilded boxes; each dish a box whose velvet curtains part on its stage.
 * - `resmal`, The Black Tent: each section a goat-hair tent whose two door curtains part on the dishes on coloured felt.
 * - `khurjin`, The Khurjin: each section a woven saddlebag, dishes paired as its pockets; each pocket's flap lifts.
 * - `sadaf`, The Pearl Box: each section an inlaid box, each dish a drawer that slides its dish out.
 * - `mashra`, The Mashrabiya: arched turned-wood windows, two a row; the lattice over the photo thins away.
 * - `fold`, The Folded Paper: each section a paper folded in half; the lower half unfolds in 3D.
 * - `tone`, The Fifties Paper: yellow paper, narrow columns; halftone photos bloom into colour.
 */
export function RevealFamily({ motif }: { motif: RevealMotif }) {
  const { locale, tenant } = useApp();
  const { view, categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  const look = LOOKS[motif];
  const p = look.prefix;

  useOnceInView(root, reduced, { item: 'data-cover', id: 'data-cover', mark: 'data-open', line: REVEAL_LINE });

  const shown = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  const all = everyOpen(shown, view.products.length);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    const row = button.closest<HTMLElement>('[data-row]');
    const target = look.added === 'row' ? row : look.added === 'text' ? row?.querySelector('[data-text]') : row?.querySelector('[data-photo]');
    target?.animate([{ scale: '1' }, { scale: String(look.swell) }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  const sizes = look.cols === 3 ? '(min-width: 640px) 200px, 33vw' : '(min-width: 640px) 320px, 50vw';

  /** The decoration drawn over a dish's photo (inside its frame): curtains, a flap, a lattice, halftone dots. */
  const overPhoto = (): ReactNode => {
    switch (motif) {
      case 'opera':
        return (
          <>
            <i aria-hidden className="op-cu op-cu-s" />
            <i aria-hidden className="op-cu op-cu-e" />
            <i aria-hidden className="op-valance" />
          </>
        );
      case 'khurjin':
        return <i aria-hidden className="kj-flap" />;
      case 'mashra':
        return <i aria-hidden className="mr-grid" />;
      case 'tone':
        return <i aria-hidden className="tn-dots" />;
      default:
        return null;
    }
  };

  const dish = (product: MenuProductView, at: number, first: boolean) => (
    <li
      key={product.id}
      data-row
      data-cover={look.cover === 'dish' ? product.id : undefined}
      className={`${p}-dish`}
      style={{ '--i': `${revealDelay(at, look.cols)}ms` } as CSSProperties}
    >
      <div data-photo className={`${p}-frame`}>
        <div className={`${p}-pic`}>
          <ProductMedia product={product} suffix={motif} sizes={sizes} priority={first && at < 6} rounded={false} className={`${p}-img`} />
        </div>
        {overPhoto()}
      </div>
      {motif === 'opera' ? <i aria-hidden className="op-rail" /> : null}
      <div data-text className={`${p}-text`}>
        {motif === 'sadaf' ? <i aria-hidden className="sd-knob" /> : null}
        <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open ${p}-name text-start`}>
          {product.name}
        </button>
        {look.describe ? <Description product={product} lines={look.describe} className={`${p}-desc`} /> : null}
        <span className={`${p}-meta`}>
          <Price product={product} className={`${p}-price`} />
          <QuickAction product={product} variant={look.add} className={`${p}-add relative z-[2]`} onAdded={added} />
        </span>
        <Badges product={product} className={`${p}-badges`} />
      </div>
      {motif === 'khurjin' ? <i aria-hidden className="kj-tassel" /> : null}
    </li>
  );

  const list = (products: readonly MenuProductView[], first: boolean, offset = 0) => (
    <ul className={`${p}-dishes`}>{products.map((product, at) => dish(product, at + offset, first))}</ul>
  );

  const heading = (slug: string, name: string, count: number, lead?: ReactNode) => (
    <ShapeHeading id={`h-${slug}`} name={name} count={n(count)} className={`${p}-head`} title={`${p}-title`} lead={lead} />
  );

  return (
    <div ref={root} className="tpl-body" data-body={motif} data-all={all ? '' : undefined}>
      <SectionStrip marker={look.marker} prefix={p}>
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className={`min-w-0 ${p}-main`}>
        {motif === 'opera' ? <div aria-hidden className="op-drape" /> : null}
        {motif === 'tone' ? (
          <header className="tn-mast">
            <i aria-hidden className="tn-orn">
              ❦
            </i>
            <p className="tpl-display tn-mast-name">{tenant.logoText}</p>
            <i aria-hidden className="tn-orn">
              ❦
            </i>
          </header>
        ) : null}
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const first = index === 0;
          const section = (children: ReactNode) => (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className={`tpl-section tpl-tall-last ${p}-section`}>
              {children}
            </section>
          );
          switch (motif) {
            case 'resmal':
              return section(
                <>
                  <div className={`${p}-roof`}>{heading(category.slug, category.name, products.length)}</div>
                  <div data-cover={category.id} className="rs-tent">
                    {list(products, first)}
                    <i aria-hidden className="rs-door rs-door-s" />
                    <i aria-hidden className="rs-door rs-door-e" />
                  </div>
                </>,
              );
            case 'sadaf':
              return section(
                <div className="sd-chest">
                  {heading(category.slug, category.name, products.length)}
                  {list(products, first)}
                </div>,
              );
            case 'fold': {
              const [top, rest] = foldSplit(products);
              return section(
                <div className="fd-sheet">
                  <div className="fd-top">
                    <p aria-hidden className="fd-mast">
                      {tenant.logoText}
                    </p>
                    {heading(category.slug, category.name, products.length)}
                    {list(top, first)}
                  </div>
                  {rest.length ? (
                    <div data-cover={category.id} className="fd-flap">
                      <i aria-hidden className="fd-crease" />
                      {list(rest, first, top.length)}
                    </div>
                  ) : null}
                </div>,
              );
            }
            default:
              return section(
                <>
                  {heading(category.slug, category.name, products.length)}
                  {list(products, first)}
                </>,
              );
          }
        })}
      </main>
    </div>
  );
}

/** The Opera Boxes (kind `opera`). */
export function OperaBody() {
  return <RevealFamily motif="opera" />;
}
/** The Black Tent (kind `resmal`). */
export function ResmalBody() {
  return <RevealFamily motif="resmal" />;
}
/** The Khurjin (kind `khurjin`). */
export function KhurjinBody() {
  return <RevealFamily motif="khurjin" />;
}
/** The Pearl Box (kind `sadaf`). */
export function SadafBody() {
  return <RevealFamily motif="sadaf" />;
}
/** The Mashrabiya (kind `mashra`). */
export function MashraBody() {
  return <RevealFamily motif="mashra" />;
}
/** The Folded Paper (kind `fold`). */
export function FoldBody() {
  return <RevealFamily motif="fold" />;
}
/** The Fifties Paper (kind `tone`). */
export function ToneBody() {
  return <RevealFamily motif="tone" />;
}
