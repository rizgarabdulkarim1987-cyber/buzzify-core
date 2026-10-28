'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { WALL_START, WALL_TILES, wallColumns, wallDelta, wallStep, zoneColumns, zoomScroll } from './signature-24';
import './shared/photo-card.css';
import './shared/shapes.css';
import './wall.css';

/** How far (px) a mouse must move before a press on the wall becomes a drag, and the click it ends in is dropped. */
const DRAG_SLOP = 5;

/**
 * The Open Wall (kind `wall`, mockup `signature` / `wall`): the whole menu laid out at once on one big wall, each
 * section a coloured zone of photo tiles, the zones side by side and row under row. The wall scrolls both ways under
 * a finger (native scrolling, so it glides and stops under the finger) and drags with a mouse; − and + in the strip
 * make the tiles smaller (more of the menu at once) or larger. A section's chip flies the wall to its zone.
 *
 * The wall registers its own section opener (`setCategoryOpener`): the page brings the wall up under the strip, and the
 * wall scrolls the zone to its start corner, smoothly unless motion is reduced; focus moves to the zone's heading.
 */
export function WallBody() {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, reduced, openProduct, setCategoryOpener } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const frame = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState(WALL_START);

  const goTo = useCallback(
    (categoryId: string) => {
      const wall = frame.current;
      const category = categories.find((candidate) => candidate.id === categoryId);
      const zone = category ? document.getElementById(`cat-${category.slug}`) : null;
      if (!wall || !zone) return;
      const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
      wall.scrollIntoView({ behavior, block: 'start' });
      const rtl = getComputedStyle(wall).direction === 'rtl';
      wall.scrollBy({ ...wallDelta(zone.getBoundingClientRect(), wall.getBoundingClientRect(), rtl, 8), behavior });
      zone.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
    },
    [categories, reduced],
  );
  useEffect(() => {
    setCategoryOpener(goTo);
    return () => setCategoryOpener(null);
  }, [setCategoryOpener, goTo]);

  // A mouse drags the wall (a finger scrolls it natively); a press that moved drops the click it ends in.
  useEffect(() => {
    const wall = frame.current;
    if (!wall) return;
    let press: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    let dropClick = false;
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if ((event.target as Element).closest('.tpl-add, .tpl-button')) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, left: wall.scrollLeft, top: wall.scrollTop, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
      if (!press.moved) {
        press.moved = true;
        wall.setAttribute('data-drag', '');
        wall.setPointerCapture(press.id);
      }
      wall.scrollLeft = press.left - dx;
      wall.scrollTop = press.top - dy;
    };
    const up = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id) return;
      dropClick = press.moved;
      press = null;
      wall.removeAttribute('data-drag');
    };
    const click = (event: MouseEvent) => {
      if (!dropClick) return;
      dropClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    wall.addEventListener('pointerdown', down);
    wall.addEventListener('pointermove', move);
    wall.addEventListener('pointerup', up);
    wall.addEventListener('pointercancel', up);
    wall.addEventListener('click', click, true);
    return () => {
      wall.removeEventListener('pointerdown', down);
      wall.removeEventListener('pointermove', move);
      wall.removeEventListener('pointerup', up);
      wall.removeEventListener('pointercancel', up);
      wall.removeEventListener('click', click, true);
      wall.removeAttribute('data-drag');
    };
  }, []);

  /** Steps the tile size, keeping the middle of the view where it was once the wall has grown or shrunk. */
  const zoom = (by: -1 | 1) => {
    const next = wallStep(level, by);
    if (next === level) return;
    const wall = frame.current;
    const ratio = WALL_TILES[next] / WALL_TILES[level];
    setLevel(next);
    if (!wall) return;
    const { scrollLeft, scrollTop, clientWidth, clientHeight } = wall;
    const rtl = getComputedStyle(wall).direction === 'rtl';
    requestAnimationFrame(() => {
      wall.scrollLeft = zoomScroll(scrollLeft, clientWidth, ratio, rtl);
      wall.scrollTop = zoomScroll(scrollTop, clientHeight, ratio, false);
    });
  };

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button.closest('[data-tile]')?.animate([{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div className="tpl-body" data-body="wall">
      <SectionStrip
        marker="zones"
        prefix="wl"
        lead={
          <span className="wl-zoom">
            <button type="button" onClick={() => zoom(-1)} disabled={level === 0} aria-label={t('tpl.wall.farther')} className="wl-zoom-button">
              <span aria-hidden>−</span>
            </button>
            <button type="button" onClick={() => zoom(1)} disabled={level === WALL_TILES.length - 1} aria-label={t('tpl.wall.closer')} className="wl-zoom-button">
              <span aria-hidden>+</span>
            </button>
          </span>
        }
      >
        {(category) => (
          <>
            <i aria-hidden className="wl-chip-dot" data-tone={placeOf(category) % 5} />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        <div ref={frame} className="wl-frame" data-zoom={level}>
          <div className="wl-canvas" style={{ '--wl-cols': wallColumns(categories.length), '--wl-tile': `${WALL_TILES[level]}rem` } as CSSProperties}>
            {categories.map((category, index) => {
              const products = byCategory.get(category.id) ?? [];
              return (
                <section
                  key={category.id}
                  id={`cat-${category.slug}`}
                  aria-labelledby={`h-${category.slug}`}
                  data-tone={placeOf(category) % 5}
                  className="tpl-section wl-zone"
                  style={{ '--wl-zone-cols': zoneColumns(products.length) } as CSSProperties}
                >
                  <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="wl-head" title="wl-title" />
                  <ul className="wl-tiles">
                    {products.map((product, at) => (
                      <li key={product.id} data-tile className="wl-tile">
                        <div data-photo className="wl-photo tpl-plate tpl-fill-media">
                          <ProductMedia product={product} suffix="wall" sizes="(min-width: 640px) 160px, 30vw" priority={index === 0 && at < 6} rounded={false} />
                          <Badges product={product} className="wl-badges" />
                          <QuickAction product={product} variant="icon" className="wl-add tpl-rim-add z-[2]" onAdded={added} />
                        </div>
                        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open wl-name text-start">
                          {product.name}
                        </button>
                        <Price product={product} className="wl-price tpl-price-tight" />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
