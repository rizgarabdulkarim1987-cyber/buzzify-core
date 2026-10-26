'use client';

import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction } from '../parts';
import './periodic.css';

/** The hues of the groups, spread around the colour wheel so neighbours differ; a ninth group starts the wheel again. */
const HUES = [8, 38, 132, 176, 214, 262, 312, 346] as const;

/** The hue (in degrees) of the nth group. */
export function groupHue(index: number): number {
  return HUES[((index % HUES.length) + HUES.length) % HUES.length]!;
}

/**
 * A dish's element symbol: a capital and a small letter for a Latin name ("Butter croissant" is Bu), the first two
 * letters as they are for Arabic, Sorani and other scripts that join letters (never split per letter, so no join
 * breaks), and a dot when the name has no letter at all. Marks stay with their letter.
 */
export function elementSymbol(name: string): string {
  const word = name.match(/\p{L}[\p{L}\p{M}]*/u)?.[0];
  if (!word) return '·';
  const letters = word.match(/\p{L}\p{M}*/gu) ?? [];
  const first = letters[0]!;
  if (!/^\p{Script=Latin}/u.test(first)) return letters.slice(0, 2).join('');
  return first.toLocaleUpperCase() + (letters[1]?.toLocaleLowerCase() ?? '');
}

/**
 * A periodic table of food (spec 2026-10-26-menu-styles-in-templates-design.md). The whole menu is one grid of element
 * tiles: a photo with the dish's symbol, its number (counted through the whole menu, in the menu's numerals) and its
 * price on a dark label, the name under it. Each section is a coloured group of the table; a legend of the groups
 * stays at the top and jumps. All groups are on the page, so the template's own jump and `#cat-<slug>` scrolling
 * reach them, and the legend lights the group in view.
 */
export function PeriodicBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, activeId, jumpTo } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // The number of the first dish of each group: the dishes before it, counted through the whole menu.
  const starts = categories.reduce<number[]>((all, category, index) => [...all, (all[index - 1] ?? 0) + (index > 0 ? (byCategory.get(categories[index - 1]!.id) ?? []).length : 0)], []);

  return (
    <div className="tpl-body" data-body="periodic">
      <nav aria-label={t('menu.categories')} data-legend className="pt-legend">
        <ul className="pt-legend-list">
          {categories.map((category, index) => (
            <li key={category.id}>
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                onClick={() => jumpTo(category.id)}
                className="pt-chip"
                style={{ '--g': groupHue(index) } as CSSProperties}
              >
                <span>{category.name}</span>
                <b aria-hidden>{n((byCategory.get(category.id) ?? []).length)}</b>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const first = starts[index]!;
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section pt-group"
              style={{ '--g': groupHue(index) } as CSSProperties}
            >
              <div tabIndex={-1} data-heading className="outline-none">
                <h2 id={`h-${category.slug}`} className="pt-title">
                  <small aria-hidden>{t('tpl.per.group', { n: n(index + 1) })}</small>
                  <span>{category.name}</span>
                </h2>
              </div>
              <ul className="pt-grid">
                {products.map((product, row) => (
                  <Tile key={product.id} product={product} number={n(first + row + 1)} order={Math.min(first + row, 11)} priority={first + row < 12} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Tile({ product, number, order, priority }: { product: MenuProductView; number: string; order: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="pt-tile" style={{ '--i': order } as CSSProperties}>
      <div data-photo className="pt-photo">
        <ProductMedia product={product} suffix="periodic" sizes="96px" priority={priority} rounded={false} className="pt-img" />
        <span data-number aria-hidden className="pt-number">
          {number}
        </span>
        <span className="pt-bar">
          <b data-symbol aria-hidden className="pt-symbol">
            {elementSymbol(product.name)}
          </b>
          <Price product={product} className="pt-price" />
        </span>
        <QuickAction product={product} className="pt-add relative z-[2]" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open pt-name text-start">
        {product.name}
      </button>
    </li>
  );
}
