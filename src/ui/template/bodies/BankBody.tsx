'use client';

import { useRef, type CSSProperties } from 'react';
import { localDigits } from '@/lib/digits';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { noteSerial, noteTurn } from './signature-25';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './bank.css';

/**
 * The Bank of Taste (kind `bank`, mockup signature-2 `bank`): every dish a banknote. Each section is a denomination
 * with its own note colour (the palette's accent turned round the colour wheel, its lightness kept), headed by the
 * restaurant's name as the issuing bank and a guilloche seal. Each note carries the dish's photo in the portrait's oval
 * framed by a guilloche rosette, its name and serial number, and its real price as the note's value (with the sale price
 * and the struck regular price, and the offer badge, exactly as on every other menu).
 *
 * Motion: the notes are dealt in the first time they are seen, and an added note gives a quick flick, as if counted. Off
 * with less motion. All sections are on the page, so the template's jump and `#cat-<slug>` reach them.
 */
export function BankBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useOnceInView(root, reduced, { item: 'data-note', id: 'data-note', mark: 'data-in' });

  /** Added: the note flicks, as a counted banknote does. */
  const flick = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.animate([{ rotate: '0deg' }, { rotate: '-2.5deg', scale: '1.02' }, { rotate: '1deg' }, { rotate: '0deg' }], { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="bank">
      <SectionStrip marker="denominations" prefix="bk" chipStyle={(category) => ({ '--turn': noteTurn(placeOf(category)) }) as CSSProperties}>
        {(category) => (
          <>
            <i aria-hidden className="bk-chip-note" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 bk-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section tpl-tall-last bk-section"
              style={{ '--turn': noteTurn(place) } as CSSProperties}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={tenant.logoText || undefined}
                count={n(products.length)}
                className="bk-head"
                title="bk-title"
                lead={<i aria-hidden className="bk-seal" />}
              />
              <ul className="bk-wallet">
                {products.map((product, at) => (
                  <li key={product.id} data-row data-note={product.id} className="bk-note" style={{ '--i': at } as CSSProperties}>
                    <div data-photo className="bk-portrait tpl-plate">
                      <ProductMedia product={product} suffix="bank" sizes="96px" priority={index === 0 && at < 5} rounded={false} className="bk-img" />
                    </div>
                    <div className="bk-words">
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open bk-name text-start">
                        {product.name}
                      </button>
                      <span aria-hidden dir="ltr" className="bk-serial">
                        {localDigits(noteSerial(place, at), tenant.numeralSystem)}
                      </span>
                      <Badges product={product} className="bk-badges" />
                    </div>
                    <div className="bk-den">
                      <Price product={product} className="bk-price" />
                      <QuickAction product={product} variant="icon" className="bk-add relative z-[2]" onAdded={flick} />
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
