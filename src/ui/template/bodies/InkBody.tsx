'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { bandColour, inkOn, paperOf } from './ink-bands';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { useBandFlood } from './useBandFlood';
import './shared/shapes.css';
import './ink.css';

/**
 * Section Ink (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a full-width colour band in a saturated
 * colour of its own, its top edge bled like spilt ink, with the section's name set large and its dish count; the dishes
 * sit on the band as paper-white cards, three across on a phone (photo, name, price, a round add on the photo), so their text reads
 * whatever the band or the menu's palette. The signature motion: a band's colour floods in (a growing circle, from its
 * top corner or from the chip that was tapped) the first time it scrolls into view, once per band (`useBandFlood`).
 * A sticky strip of chips, each in its band's colour with the text colour that reads on it, jumps to a band. All bands are
 * on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function InkBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, design } = useTemplate();
  const { paper, onPaper } = paperOf(design.palette);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  const flood = useBandFlood(root, reduced);
  const placeOf = usePlaceOf();
  // By the section's place in the full menu, so a search never recolours the bands it leaves.
  const colours = (category: { id: string }) => {
    const band = bandColour(placeOf(category));
    return { '--band': band, '--band-ink': inkOn(band) } as CSSProperties;
  };

  return (
    <div className='tpl-body' data-body='ink' ref={root} style={{ '--ik-paper': paper, '--ik-on-paper': onPaper } as CSSProperties}>
      <SectionStrip
        marker='chips'
        prefix='ik'
        chipStyle={(category) => colours(category)}
        onPick={(category, button) => flood(category.id, button)}
      >
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id='menu' className='min-w-0'>
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-band
              data-id={category.id}
              data-edge={placeOf(category) % 3}
              className='tpl-section tpl-tall-last ik-band'
              style={colours(category)}
            >
              <div className='ik-flood'>
                <ShapeHeading
                  id={`h-${category.slug}`}
                  name={category.name}
                  count={n(products.length)}
                  className='ik-head'
                  title='ik-title'
                />
                <ul className='ik-grid'>
                  {products.map((product, at) => (
                    <IconDish
                      key={product.id}
                      product={product}
                      prefix='ik'
                      suffix='ink'
                      cell='ik-card'
                      head='ik-head-photo'
                      price='ik-price'
                      pricePlace='after'
                      media='cover'
                      addInPhoto
                      plate
                      inPhoto={
                        <SaleChip product={product} className='ik-off' />
                      }
                      sizes='(min-width: 1024px) 260px, (min-width: 640px) 30vw, 50vw'
                      priority={index === 0 && at < 4}
                      order={Math.min(index * 2 + at, 8)}
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
