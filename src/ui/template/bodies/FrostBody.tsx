'use client';

import { useEffect, useRef, type PointerEvent } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './shared/name-chip.css';
import './frost.css';

/**
 * The frost on the featured dish's window: a canvas laid over its photo, filled with the frost colour (the canvas's own CSS
 * `color`) and rubbed clear by a finger or a mouse (`destination-out` strokes). A first soft wipe opens a window through the
 * middle on its own (about a second; with less motion the window is simply there), so the dish is on show before anyone
 * touches it; the edges stay frosted until they are wiped. A tap (no drag) opens the dish; a vertical drag scrolls the page
 * (`touch-action: pan-y`), a sideways one wipes. Decoration only: the dish's name button is the real control.
 */
function Frost({ reduced, onTap }: { reduced: boolean; onTap: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; at: number; moved: number } | null>(null);
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) return;
    const box = node.getBoundingClientRect();
    const scale = Math.min(2, window.devicePixelRatio || 1);
    node.width = Math.max(1, Math.round(box.width * scale));
    node.height = Math.max(1, Math.round(box.height * scale));
    const { width, height } = node;
    const frost = getComputedStyle(node).color;
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = frost;
    context.globalAlpha = 0.88;
    context.fillRect(0, 0, width, height);
    // Rime: a scatter of pale specks, so the frost is not a flat veil.
    context.globalAlpha = 0.5;
    for (let speck = 0; speck < 90; speck++) {
      context.beginPath();
      context.arc(Math.random() * width, Math.random() * height, (0.6 + Math.random() * 1.8) * scale, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'destination-out';
    const rub = (x: number, y: number, radius: number) => {
      const brush = context.createRadialGradient(x, y, 0, x, y, radius);
      brush.addColorStop(0, 'rgba(0,0,0,1)');
      brush.addColorStop(0.6, 'rgba(0,0,0,0.9)');
      brush.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = brush;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };
    // The first wipe: a slow S through the middle of the pane.
    const path = (t: number): [number, number] => [width * (0.2 + 0.6 * t), height * (0.5 + 0.22 * Math.sin(t * Math.PI * 2.2))];
    const brush = Math.min(width, height) * 0.3;
    if (reduced) {
      for (let step = 0; step <= 6; step++) rub(...path(step / 6), brush);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const sweep = (now: number) => {
      const t = Math.min(1, (now - start - 250) / 1100);
      if (t >= 0) for (let step = 0; step <= 3; step++) rub(...path(Math.max(0, t - step * 0.02)), brush);
      if (t < 1) frame = requestAnimationFrame(sweep);
    };
    frame = requestAnimationFrame(sweep);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const wipe = (event: PointerEvent<HTMLCanvasElement>) => {
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) return;
    const box = node.getBoundingClientRect();
    const x = ((event.clientX - box.left) * node.width) / box.width;
    const y = ((event.clientY - box.top) * node.height) / box.height;
    const radius = Math.min(node.width, node.height) * 0.2;
    const brush = context.createRadialGradient(x, y, 0, x, y, radius);
    brush.addColorStop(0, 'rgba(0,0,0,1)');
    brush.addColorStop(0.6, 'rgba(0,0,0,0.9)');
    brush.addColorStop(1, 'rgba(0,0,0,0)');
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = brush;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="fr-ice"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, moved: 0 };
        wipe(event);
      }}
      onPointerMove={(event) => {
        if (!drag.current && event.pointerType !== 'mouse') return;
        if (drag.current) drag.current.moved = Math.max(drag.current.moved, Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y));
        if (drag.current || event.pointerType === 'mouse') wipe(event);
      }}
      onPointerUp={(event) => {
        const was = drag.current;
        drag.current = null;
        if (was && was.moved < 8 && event.timeStamp - was.at < 600) onTap();
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}

/**
 * Frosted Window (poster themed-win of the 35 mockups; spec 2026-10-26-menu-styles-in-templates-design.md). A winter window
 * with snow falling. The menu's featured dish (the first featured one, else the first dish) is in the WINDOW at the top: its
 * photo behind a pane of frost that a first soft wipe opens and that anyone can rub clear with a finger (`Frost`), its name,
 * price and add beside it (it is the dish's own cell, so no dish is shown twice; with no other dish in its section it stays in
 * the grid and there is no window). A sticky strip of translucent pills (the one in view white) jumps. Each section is a
 * heading over a grid of snow-capped cards (a pale card, a cap of snow on its top edge that drops in once, the photo, the
 * name, the price and the add on a row). The snow falls once and stops (a still drift of flakes behind the page). All
 * sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function FrostBody() {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, featured, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-glass', id: 'data-glass', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a section.
  const placeOf = usePlaceOf();
  // The window's dish: the featured one while it is still among the results (and not alone in its section), else the first dish.
  const first = featured[0] ?? categories.flatMap((category) => byCategory.get(category.id) ?? [])[0];
  const home = first ? categories.find((category) => (byCategory.get(category.id) ?? []).some((product) => product.id === first.id)) : undefined;
  const hero = first && home && (byCategory.get(home.id) ?? []).length > 1 ? first : undefined;

  return (
    <div ref={root} className="tpl-body" data-body="frost">
      {hero ? <FrostWindow product={hero} label={t('tpl.featured')} reduced={reduced} /> : null}
      <SectionStrip marker="icicles" prefix="fr" className="fr-strip" chip="tpl-name-chip fr-chip">
        {(category) => <span className="tpl-chip-name fr-chip-name">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0 fr-wall">
        {categories.map((category, index) => {
          const products = (byCategory.get(category.id) ?? []).filter((product) => product.id !== hero?.id);
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-glass={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last fr-pane">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="fr-head" title="fr-title" />
              <ul className="fr-grid">
                {products.map((product, at) => (
                  <Card key={product.id} product={product} at={at} priority={index < 1 && at < 4} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The window: the featured dish behind its frost, the name, price and add beside it (the discount on the glass's foot). */
function FrostWindow({ product, label, reduced }: { product: MenuProductView; label: string; reduced: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <div className="fr-hero-wrap">
      <div data-row data-hero className="fr-hero">
        <div className="fr-glass">
          <div data-photo className="fr-photo tpl-cover-media tpl-plate">
            <ProductMedia product={product} suffix="frost" sizes="(min-width: 640px) 320px, 45vw" priority className="fr-img" rounded={false} />
          </div>
          <Frost reduced={reduced} onTap={() => openProduct(product.id)} />
          <SaleChip product={product} className="tpl-photo-off fr-off" />
        </div>
        <div className="fr-cap">
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display fr-hero-name">
            <span className="sr-only">{label}: </span>
            {product.name}
          </button>
          <div className="fr-meta">
            <Price product={product} className="fr-price" />
            <QuickAction product={product} variant="icon" className="tpl-rim-add fr-add" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A dish as a snow-capped card: a pale card with a cap of snow on its top edge (it drops in once, as the section first
 * comes into view; `at` staggers it), the photo, the discount on the photo's foot, the name, then the price and the add on a
 * row. The whole card opens the dish.
 */
function Card({ product, at, priority }: { product: MenuProductView; at: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="fr-card" style={{ ['--fr-at' as string]: Math.min(at, 8) }}>
      <div className="fr-shot">
        <div data-photo className="fr-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="frost" sizes="(min-width: 640px) 200px, 30vw" priority={priority} className="fr-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tpl-photo-off fr-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name fr-name">
        {product.name}
      </button>
      <div className="fr-meta">
        <Price product={product} className="fr-price" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add fr-add" />
      </div>
    </li>
  );
}
