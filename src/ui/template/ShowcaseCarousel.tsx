'use client';

import { useId, useRef } from 'react';
import { direction } from '@/lib/locale';
import type { ShowcaseCardView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import type { CartInput } from '@/server/domain/types';
import { useApp } from '@/ui/AppProviders';
import { PlusIcon } from '@/ui/Icons';
import { useTemplate } from './context';
import { formatWindow } from './showcase-window';
import './showcase.css';

/**
 * The showcase cards around the search box (docs/superpowers/specs/2026-10-30-menu-occasions-showcase-design.md,
 * "Guest carousel"): a labelled list the guest scrolls sideways with the browser's own scroll snapping. Nothing moves
 * by itself and nothing animates: no autoplay, no transforms, no layers of its own, so a long menu stays light on a
 * phone. A slot without cards draws nothing.
 */
export function ShowcaseCarousel({ slot }: { slot: 'aboveSearch' | 'belowSearch' }) {
  const { view } = useTemplate();
  const { t, locale } = useApp();
  const id = useId();
  const cards = view.showcase[slot];
  if (cards.length === 0) return null;
  return (
    <section id={id} aria-label={t(slot === 'aboveSearch' ? 'showcase.labelAbove' : 'showcase.labelBelow')} dir={direction(locale)} className="tpl-showcase">
      {/* Focusable so a keyboard can scroll a strip of cards with no button (Safari does not focus scroll containers);
          named by the region's label rather than a second copy of it. */}
      <ul tabIndex={0} aria-labelledby={id} className="tpl-showcase-strip scroll-hidden">
        {cards.map((card) => (
          <ShowcaseCard key={card.id} card={card} />
        ))}
      </ul>
    </section>
  );
}

function quantityOf(cart: CartInput, bundleId: string): number {
  return cart.bundles.find((bundle) => bundle.bundleId === bundleId)?.quantity ?? 0;
}

function ShowcaseCard({ card }: { card: ShowcaseCardView }) {
  const { openProduct, jumpTo, canOrder } = useTemplate();
  const { t, locale, tenant, price, cart, preview, setBundleQuantity, announce } = useApp();
  // The quantity this card last set, with the cart it read it from: a second tap before the cart has re-rendered
  // counts on from there instead of from the stale cart, so two quick taps give two sets.
  const lastSet = useRef<{ cart: CartInput; quantity: number } | null>(null);

  // An offer card opens its dish, or else goes to its category. The title's button stretches over the whole card, so
  // the card is one tap target while its heading stays a heading. A card with neither is plain content.
  const { productId, categoryId } = card;
  const open =
    card.kind !== 'OFFER' ? null : productId !== null ? () => openProduct(productId) : categoryId !== null ? () => jumpTo(categoryId) : null;

  const body = (
    <div className="tpl-showcase-body">
      {card.occasion && (
        <p data-occasion>
          <span className="tpl-badge tpl-badge-special">{card.occasion}</span>
        </p>
      )}
      <h3 className="tpl-display tpl-name">
        {open ? (
          <button type="button" onClick={open} className="tpl-showcase-link">
            {card.title}
          </button>
        ) : (
          card.title
        )}
      </h3>
      {card.text && <p className="tpl-showcase-text">{card.text}</p>}
    </div>
  );

  if (card.kind === 'OFFER') {
    return <li className={open ? 'tpl-showcase-card tpl-showcase-card-tap' : 'tpl-showcase-card'}>{body}</li>;
  }

  if (card.kind === 'SET') {
    const { bundleId } = card;
    const add = () => {
      if (bundleId === null) return;
      const current = lastSet.current?.cart === cart ? lastSet.current.quantity : quantityOf(cart, bundleId);
      setBundleQuantity(bundleId, current + 1);
      lastSet.current = { cart, quantity: current + 1 };
      announce(t('cart.added', { name: card.title }));
    };
    return (
      <li className="tpl-showcase-card">
        {body}
        <div className="tpl-showcase-foot">
          <p className="tpl-showcase-facts">
            {card.price !== null && <span className="tpl-showcase-price">{price(card.price)}</span>}
            {card.people !== null && (
              <span className="tpl-showcase-note">{t('showcase.forPeople', { count: card.people, n: formatCount(card.people, locale, tenant.numeralSystem) })}</span>
            )}
          </p>
          {canOrder && !preview && bundleId !== null && (
            <button type="button" onClick={add} aria-label={t('product.quickAdd', { name: card.title })} className="tpl-showcase-add">
              <PlusIcon className="size-4" aria-hidden />
              {t('showcase.add')}
            </button>
          )}
        </div>
      </li>
    );
  }

  // BUFFET: information only, no button.
  const hours = card.when ? formatWindow(card.when, t, tenant.numeralSystem) : null;
  return (
    <li className="tpl-showcase-card">
      {body}
      <div className="tpl-showcase-foot">
        <p className="tpl-showcase-facts">
          {card.price !== null && (
            <span className="tpl-showcase-price">
              {price(card.price)}
              {card.perPerson && <span className="tpl-showcase-per"> {t('showcase.perPerson')}</span>}
            </span>
          )}
          {hours && (
            <span className="tpl-showcase-note">
              {hours.days && <>{hours.days} · </>}
              {card.when?.startMinute === null || card.when?.endMinute === null ? (
                hours.hours
              ) : (
                <bdi dir="ltr" className="tabular-nums">
                  {hours.hours}
                </bdi>
              )}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}
