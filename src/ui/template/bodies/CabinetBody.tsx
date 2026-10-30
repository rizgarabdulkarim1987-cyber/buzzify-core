'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { themeOf } from '@/lib/templates/palette';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { DishCounts, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import './shared/shapes.css';
import './cabinet.css';

/** The drawers after `id` is pulled or pushed: a new set, every other drawer as it was. */
export function toggleDrawer(open: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The drawers with every drawer in `ids` (the ones holding a search or filter result) pulled out too; the same set when they all already are. */
export function withResults(open: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  if (ids.every((id) => open.has(id))) return open;
  const next = new Set(open);
  for (const id of ids) next.add(id);
  return next;
}

/** Drawers open on arrival: the first, and the next ones until at least `MIN_SHOWN` dishes are showing. */
const MIN_SHOWN = 4;
export function firstOpen(sizes: readonly number[], ids: readonly string[]): Set<string> {
  const open = new Set<string>();
  let shown = 0;
  for (let index = 0; index < ids.length && shown < MIN_SHOWN; index += 1) {
    open.add(ids[index]!);
    shown += sizes[index] ?? 0;
  }
  return open;
}

/**
 * A chest of drawers (spec 2026-10-26-menu-styles-in-templates-design.md; the layout-cab mockup). Every section is a drawer
 * front of wood with a brass handle, its name, thumbnails of its first dishes and its dish count (in the menu's numerals). Drawers are independent accordions: several can be open
 * at once, the first is open on arrival (with the next ones too while fewer than four dishes show), and an open drawer
 * shows its tray of dishes (two across on a phone, three from 640px, four from 1024px): a big square photo, name, price and an add
 * button. While a search or a filter is on, every drawer holding a result is pulled out whenever the results change,
 * so a result never hides behind a closed front; nothing moves the view or the focus for it. A closed drawer renders no dishes at all (no layout, no photos), but its front is a button, so every
 * section is one tap away. The template's own jump, the `#cat-<slug>` address and the lit-section tracking all find a
 * section by its element, which every drawer keeps; a jump to a closed drawer opens it first, then scrolls to it.
 */
export function CabinetBody() {
  const { t, locale, tenant } = useApp();
  const { view, design, categories, byCategory, setCategoryOpener } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // The results of a search or a filter, as a key ('' when nothing is filtered): a string, so a new `categories` with
  // the same results changes nothing.
  const shown = categories.flatMap((category) => (byCategory.get(category.id) ?? []).map((product) => product.id));
  const results = shown.length < view.products.length ? shown.join(',') : '';
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const ids = categories.map((category) => category.id);
    const first = firstOpen(categories.map((category) => (byCategory.get(category.id) ?? []).length), ids);
    return results === '' ? first : withResults(first, ids);
  });
  // When the results change, the drawers holding them are pulled out (adjusted while rendering, so no closed front
  // flashes first); the guest can still push one back in until the results change again.
  const [seen, setSeen] = useState(results);
  if (results !== seen) {
    setSeen(results);
    if (results !== '') setOpen((current) => withResults(current, categories.map((category) => category.id)));
  }
  // A guest's jump (the navigation, the address): which drawer, and which jump it was. Only a jump moves the view and the
  // focus, never a change of `categories` (search, filters).
  const [jump, setJump] = useState<{ id: string | null; seq: number }>({ id: null, seq: 0 });
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(categories);
  useEffect(() => {
    latest.current = categories;
  }, [categories]);

  const goTo = useCallback((id: string) => {
    setOpen((current) => (current.has(id) ? current : new Set(current).add(id)));
    setJump((previous) => ({ id, seq: previous.seq + 1 }));
  }, []);
  useEffect(() => {
    setCategoryOpener(goTo);
    return () => setCategoryOpener(null);
  }, [setCategoryOpener, goTo]);

  // An address to a section (`#cat-<slug>`) opens its drawer on arrival and when the address changes.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#cat-')) return;
      let slug = hash.slice(5);
      try {
        slug = decodeURIComponent(slug);
      } catch {
        return;
      }
      const match = latest.current.find((category) => category.slug === slug);
      if (match) goTo(match.id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [goTo]);

  // After a jump, once the drawer is open, the view and the focus move to its heading (keyed on the jump only).
  useEffect(() => {
    if (jump.seq === 0 || jump.id === null) return;
    const section = root.current?.querySelector<HTMLElement>(`[data-drawer="${CSS.escape(jump.id)}"]`);
    if (!section) return;
    section.scrollIntoView({ behavior: 'auto', block: 'start' });
    section.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
  }, [jump]);

  return (
    <div className="tpl-body" data-body="cabinet" data-tone={themeOf(design.palette.bg)} ref={root}>
      <main id="menu" className="min-w-0 cb-chest">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const isOpen = open.has(category.id);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              data-drawer={category.id}
              data-open={isOpen ? 'true' : 'false'}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section cb-drawer"
            >
              <div tabIndex={-1} data-heading data-front className="outline-none cb-front">
                <h2 id={`h-${category.slug}`} className="tpl-display cb-title">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? `tray-${category.slug}` : undefined}
                    onClick={() => setOpen((current) => toggleDrawer(current, category.id))}
                    className="cb-pull"
                  >
                    <span className="cb-info">
                      <span className="cb-label">{category.name}</span>
                      <span className="cb-peek">
                        <span aria-hidden className="cb-thumbs">
                          {products.slice(0, 4).map((product) => (
                            <span key={product.id} className="cb-thumb">
                              <ProductMedia product={product} suffix="cabinet-peek" sizes="34px" rounded={false} dim={false} />
                            </span>
                          ))}
                        </span>
                        <em data-count className="cb-count">
                          {t('tpl.book.dishes', { count: products.length, n: n(products.length) })}
                        </em>
                      </span>
                    </span>
                    <i aria-hidden className="cb-handle" />
                  </button>
                </h2>
              </div>
              {isOpen ? (
                <div id={`tray-${category.slug}`} role="region" aria-labelledby={`h-${category.slug}`} className="cb-tray">
                  <ul className="cb-grid">
                    {products.map((product, row) => (
                      <Card key={product.id} product={product} priority={index === 0 && row < 4} order={Math.min(row, 8)} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** A dish in an open tray: a big square photo (with the sale chip), the name, then the add button and the price. */
function Card({ product, priority, order }: { product: MenuProductView; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="cb-card" style={{ '--i': order } as CSSProperties}>
      <div data-photo className="cb-photo">
        <ProductMedia product={product} suffix="cabinet" sizes="(min-width: 640px) 220px, 45vw" priority={priority} className="cb-img" />
        <SaleChip product={product} className="cb-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open cb-name text-start">
        {product.name}
      </button>
      <DishCounts product={product} />
      <span className="cb-foot">
        <QuickAction product={product} className="cb-add relative z-[2]" />
        <Price product={product} className="cb-price" />
      </span>
    </li>
  );
}
