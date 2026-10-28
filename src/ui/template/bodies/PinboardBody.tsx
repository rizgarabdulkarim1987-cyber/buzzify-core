'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import type { MenuProductView } from '@/server/data/menu-view';
import { useTemplate } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import { clothSway, pinTilt, tapeMarks, ticketSerial, type PinboardMotif } from './pinboard-layout';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './pinboard.css';
import './album.css';
import './afish.css';
import './pass.css';
import './xayat.css';
import './ticket.css';

export { PINBOARD_MOTIFS, type PinboardMotif } from './pinboard-layout';

interface Look {
  /** The class prefix of the motif's own CSS. */
  prefix: string;
  /** The strip's data attribute (`pages` gives `data-pages`). */
  marker: string;
  /** The pieces (and the tape) play an entrance the first time they are seen (`data-in`). */
  entrance: boolean;
}

const LOOKS: Record<PinboardMotif, Look> = {
  album: { prefix: 'al', marker: 'pages', entrance: true },
  afish: { prefix: 'af', marker: 'bills', entrance: true },
  pass: { prefix: 'ps', marker: 'visas', entrance: true },
  xayat: { prefix: 'xy', marker: 'tapes', entrance: true },
  ticket: { prefix: 'ot', marker: 'stubs', entrance: false },
};

const SIZES = '(min-width: 640px) 240px, 46vw';

/**
 * The pinboard family (spec 2026-10-28-menu-styles-77-addendum.md, batch 20): every dish a piece stuck slightly tilted
 * onto a page, two across on a phone, the lean taken from a fixed pattern by the dish's place (never random). Each motif
 * is its own body kind with its own drawing and motion (the CSS under `[data-body='<motif>']`):
 *
 * - `album`, The Family Album: black pages, every dish a white-bordered photo held by paper photo-corners, its name and
 *   price written underneath in white pen; a camera flash on add.
 * - `afish`, Cinema Posters: hand-painted film posters, the name huge in red in a yellow frame like a film title, a
 *   starring ribbon with the description, the price where the ticket price goes; pasted on as you scroll.
 * - `pass`, The Taste Passport: each section a visa page, each dish a tilted coloured stamp; adding prints a red done
 *   stamp on it. The cover carries the tenant's name.
 * - `xayat`, The Shawl Tailor: each section opens with a numbered tape measure that unrolls as you reach it, each dish a
 *   piece of wool cut with pinking shears, pinned to the board, fluttering a little from its pin.
 * - `ticket`, Old Tickets: coloured cinema and train tickets, a perforated stub with the price; on add the stub tears
 *   along the perforation and drops, then comes back.
 *
 * All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function PinboardFamily({ motif }: { motif: PinboardMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const look = LOOKS[motif];
  const p = look.prefix;

  useOnceInView(root, reduced || !look.entrance, { item: 'data-pin', id: 'data-pin', mark: 'data-in', line: 0.92 });
  useSpineWatch(root, !reduced && motif === 'xayat', '.xy-section', 'data-live');
  useSpineHold(root, !reduced && motif === 'xayat');

  const added = (button: HTMLButtonElement) => {
    const piece = button.closest<HTMLElement>('[data-piece]');
    if (!piece) return;
    if (motif === 'pass') piece.setAttribute('data-stamped', '');
    if (reduced) return;
    const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
    switch (motif) {
      case 'album':
        piece.querySelector('.al-flash')?.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
        return;
      case 'pass':
        piece.querySelector('.ps-done')?.animate([{ scale: '1.8', opacity: 0 }, { scale: '1', opacity: 1 }], { duration: 220, easing: ease });
        return;
      case 'ticket':
        piece.querySelector('.ot-stub')?.animate(
          [
            { transform: 'none', opacity: 1, offset: 0 },
            { transform: 'translateY(3rem) rotate(16deg)', opacity: 0, offset: 0.45 },
            { transform: 'none', opacity: 0, offset: 0.6 },
            { transform: 'none', opacity: 1, offset: 1 },
          ],
          { duration: 1300, easing: 'ease-out' },
        );
        return;
      default:
        piece.animate([{ scale: '1' }, { scale: motif === 'xayat' ? '1.05' : '1.03' }, { scale: '1' }], { duration: 360, easing: ease });
    }
  };

  const name = (product: MenuProductView) => (
    <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open ${p}-name text-start`}>
      {product.name}
    </button>
  );
  const photo = (product: MenuProductView, first: boolean, extra: ReactNode = null) => (
    <div data-photo className={`${p}-photo tpl-plate tpl-cover-media`}>
      <ProductMedia product={product} suffix={motif} sizes={SIZES} priority={first} className={`${p}-img`} />
      {extra}
    </div>
  );

  const piece = (product: MenuProductView, at: number, place: number, first: boolean): ReactNode => {
    switch (motif) {
      case 'album':
        return (
          <>
            <div className="al-frame">
              <i aria-hidden className="al-corner" data-c="ss" />
              <i aria-hidden className="al-corner" data-c="se" />
              <i aria-hidden className="al-corner" data-c="es" />
              <i aria-hidden className="al-corner" data-c="ee" />
              {photo(product, first, <i aria-hidden className="al-flash" />)}
            </div>
            {name(product)}
            <span className="al-meta">
              <Price product={product} className="al-price" />
              <Badges product={product} className="al-badges" />
            </span>
            <QuickAction product={product} variant="label" className="al-add relative z-[2]" onAdded={added} />
          </>
        );
      case 'afish':
        return (
          <>
            {photo(product, first)}
            {name(product)}
            <Description product={product} lines={1} className="af-rib" />
            <Badges product={product} className="af-badges" />
            <span className="af-line">
              <span className="af-door">
                <Price product={product} className="af-price" />
              </span>
              <QuickAction product={product} variant="label" className="af-add relative z-[2]" onAdded={added} />
            </span>
          </>
        );
      case 'pass':
        return (
          <>
            {photo(product, first)}
            {name(product)}
            <Price product={product} className="ps-fee" />
            <Badges product={product} className="ps-badges" />
            <QuickAction product={product} variant="label" className="ps-add relative z-[2]" onAdded={added} />
            <i aria-hidden className="ps-done">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </i>
          </>
        );
      case 'xayat':
        return (
          <>
            <i aria-hidden className="xy-pin" />
            {photo(product, first)}
            {name(product)}
            <Badges product={product} className="xy-badges" />
            <span className="xy-line">
              <Price product={product} className="xy-price" />
              <QuickAction product={product} variant="icon" className="xy-add relative z-[2]" onAdded={added} />
            </span>
          </>
        );
      case 'ticket':
        return (
          <>
            <div className="ot-main">
              <small aria-hidden dir="ltr" className="ot-no">
                № {n(ticketSerial(place, at))}
              </small>
              {photo(product, first)}
              {name(product)}
              <Badges product={product} className="ot-badges" />
            </div>
            <div className="ot-stub">
              <Price product={product} className="ot-price" />
              <QuickAction product={product} variant="icon" className="ot-add relative z-[2]" onAdded={added} />
            </div>
          </>
        );
    }
  };

  const heading = (slug: string, title: string, place: number, count: number) => {
    const head = (
      <ShapeHeading
        id={`h-${slug}`}
        name={title}
        label={motif === 'pass' ? n(place + 1) : undefined}
        count={n(count)}
        className={`${p}-head`}
        title={`${p}-title`}
      />
    );
    if (motif !== 'xayat') return head;
    return (
      <div data-pin={`tape-${slug}`} className="xy-tape">
        <span aria-hidden dir="ltr" className="xy-ruler">
          {tapeMarks(14).map((mark) => (
            <i key={mark}>{n(mark)}</i>
          ))}
        </span>
        {head}
      </div>
    );
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      <SectionStrip marker={look.marker} prefix={p}>
        {(category) => (
          <>
            <i aria-hidden className={`${p}-chip-mark`} />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className={`min-w-0 pb-main ${p}-main`}>
        {motif === 'pass' && categories.length > 0 ? (
          <div className="ps-cover">
            <i aria-hidden className="ps-emblem">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
              </svg>
            </i>
            <span className="ps-brand">{tenant.logoText}</span>
          </div>
        ) : null}
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className={`tpl-section tpl-tall-last pb-section ${p}-section`}
            >
              {heading(category.slug, category.name, place, products.length)}
              <ul className={`pb-board ${p}-board`}>
                {products.map((product, at) => {
                  const sway = motif === 'xayat' ? clothSway(place * 50 + at + 1) : null;
                  const style = {
                    '--r': `${pinTilt(motif, at)}deg`,
                    '--i': at % 4,
                    ...(sway ? { '--t': `${sway.time}s`, '--dl': `${sway.delay}s` } : {}),
                  } as CSSProperties;
                  return (
                    <li key={product.id} data-piece data-pin={look.entrance ? product.id : undefined} className={`pb-piece ${p}-piece`} style={style}>
                      {piece(product, at, place, index === 0 && at < 4)}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The Family Album (kind `album`). */
export function AlbumBody() {
  return <PinboardFamily motif="album" />;
}
/** Cinema Posters (kind `afish`). */
export function AfishBody() {
  return <PinboardFamily motif="afish" />;
}
/** The Taste Passport (kind `pass`). */
export function PassBody() {
  return <PinboardFamily motif="pass" />;
}
/** The Shawl Tailor (kind `xayat`). */
export function XayatBody() {
  return <PinboardFamily motif="xayat" />;
}
/** Old Tickets (kind `ticket`). */
export function TicketBody() {
  return <PinboardFamily motif="ticket" />;
}
