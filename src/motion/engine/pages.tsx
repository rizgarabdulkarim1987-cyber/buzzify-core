'use client';

import type { CSSProperties } from 'react';
import { inkOn, mix } from './color';
import { dishAt, DishPicture, formatPrice, TextBar } from './menu';

/**
 * The two pages every transition plays between: a light breakfast list and a dark dinner page with a large picture.
 * Both fill their box, and both are drawn from bars and pictures so they read the same in any language. Positions are
 * in percent of the page, so a shared element can be moved from its place on one page to its place on the other.
 */

/** Where the list's first thumbnail sits on page A, and where the hero sits on page B (percent of the page). */
export const THUMB = { left: 8, top: 26, width: 20, height: 22 } as const;
export const HERO = { left: 0, top: 0, width: 100, height: 56 } as const;

const fill: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden' };

export function PageA({ background, style, hideFirstThumb = false }: { background: string; style?: CSSProperties; hideFirstThumb?: boolean }) {
  const ink = inkOn(background);
  return (
    <div style={{ ...fill, background, ...style }}>
      <div style={{ position: 'absolute', top: '8%', insetInline: '8%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextBar width="34%" height="2.8cqmin" color={ink} />
        <span style={{ width: '6cqmin', height: '6cqmin', borderRadius: '50%', background: mix(background, ink, 0.12) }} />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ position: 'absolute', insetInline: '8%', top: `${THUMB.top + i * 25}%`, height: `${THUMB.height}%`, display: 'flex', alignItems: 'center', gap: '4%' }}>
          <span style={{ position: 'relative', width: `${(THUMB.width / 84) * 100}%`, height: '100%', borderRadius: '1.8cqmin', overflow: 'hidden', visibility: i === 0 && hideFirstThumb ? 'hidden' : 'visible' }}>
            <DishPicture dish={dishAt(i)} />
          </span>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.6cqmin' }}>
            <TextBar width="70%" height="2cqmin" color={ink} style={{ opacity: 0.85 }} />
            <TextBar width="45%" height="1.3cqmin" color={ink} style={{ opacity: 0.35 }} />
          </span>
          <span style={{ color: ink, fontWeight: 600, fontSize: '3cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dishAt(i).price)}</span>
        </div>
      ))}
    </div>
  );
}

export function PageB({ background, style, hideHero = false }: { background: string; style?: CSSProperties; hideHero?: boolean }) {
  const ink = inkOn(background);
  return (
    <div style={{ ...fill, background, ...style }}>
      <div style={{ position: 'absolute', left: `${HERO.left}%`, top: `${HERO.top}%`, width: `${HERO.width}%`, height: `${HERO.height}%`, visibility: hideHero ? 'hidden' : 'visible' }}>
        <DishPicture dish={dishAt(0)} />
      </div>
      <div style={{ position: 'absolute', top: '62%', insetInline: '8%', display: 'flex', flexDirection: 'column', gap: '2.2cqmin' }}>
        <TextBar width="56%" height="3.2cqmin" color={ink} />
        <TextBar width="88%" height="1.4cqmin" color={ink} style={{ opacity: 0.35 }} />
        <TextBar width="72%" height="1.4cqmin" color={ink} style={{ opacity: 0.35 }} />
        <span style={{ alignSelf: 'flex-end', marginTop: '1cqmin', padding: '1.6cqmin 4cqmin', borderRadius: 999, background: mix(background, '#f2b705', 0.85), color: '#1d140e', fontWeight: 700, fontSize: '3.2cqmin', fontVariantNumeric: 'tabular-nums' }}>
          {formatPrice(dishAt(0).price)}
        </span>
      </div>
    </div>
  );
}
