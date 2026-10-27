'use client';

import { Fragment, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { RowDish } from './shared/RowDish';
import { SectionStrip } from './shared/SectionStrip';
import { tabsStack } from './stacked-tabs';
import './shared/shapes.css';
import './stacked.css';

/**
 * Stacked Sheets (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a sheet of coloured paper (a hue
 * of its own, rounded top corners) laid over the one before it, with a tab at its top edge (the name and the dish count)
 * and a compact row per dish (photo, name, price, add). The tabs are `position: sticky` (pure CSS, no scripting): the
 * tabs of the sheets above the one in view stack at the top of the screen and the tabs of the sheets below dock at the
 * bottom, so the next sheet is seen sliding over the last and every section is one tap away. A menu with more than
 * `STACK_MAX` sections would lose too much screen to that, so its tabs are a rail instead (one sticky scrollable strip)
 * and each sheet keeps just its own tab pinned under it. The mode follows the menu's whole list of sections, never a
 * search. All sheets are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function StackedBody() {
  const { t, locale, tenant } = useApp();
  const { view, categories, byCategory, activeId, jumpTo } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const stack = tabsStack(view.categories.length);
  // The sheet in view; the first before the page is scrolled and while a search hides the one that was lit.
  const lit = categories.some((category) => category.id === activeId) ? activeId : categories[0]?.id;
  // A sheet's hue follows its place in the whole menu, so a search does not recolour the sheets.
  const hueOf = (id: string) => hueAt(SHAPE_HUES, Math.max(0, view.categories.findIndex((category) => category.id === id)));

  return (
    <div className="tpl-body" data-body="stacked" data-tabs={stack ? 'stack' : 'rail'}>
      {stack ? null : (
        <SectionStrip marker="rail" prefix="sk" className="sk-rail" chip="sk-chip" chipStyle={(category) => ({ '--h': hueOf(category.id) }) as CSSProperties}>
          {(category, index) => (
            <>
              <small aria-hidden>{n(index + 1)}</small>
              <span>{category.name}</span>
            </>
          )}
        </SectionStrip>
      )}
      {stack ? (
        // The tabs are spread through the sheets, so a screen reader also gets them as one list of sections to jump
        // through (out of the tab order: the visible tabs are the keyboard's).
        <nav aria-label={t('menu.categories')} className="sr-only">
          <ol>
            {categories.map((category) => (
              <li key={category.id}>
                <a
                  href={`#cat-${category.slug}`}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.preventDefault();
                    jumpTo(category.id);
                  }}
                >
                  {category.name}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const style = { '--h': hueOf(category.id), '--i': stack ? index : 0, '--r': stack ? categories.length - 1 - index : 0 } as CSSProperties;
          const count = t('tpl.book.dishes', { count: products.length, n: n(products.length) });
          return (
            <Fragment key={category.id}>
              {stack ? (
                <div className="sk-tab" data-tab style={style}>
                  <button type="button" data-category={category.id} aria-current={category.id === lit ? 'true' : undefined} onClick={() => jumpTo(category.id)} className="sk-tab-button">
                    <span className="sk-tab-name">{category.name}</span>
                    <small aria-hidden className="sk-tab-count">
                      {count}
                    </small>
                  </button>
                </div>
              ) : (
                <div className="sk-tab" data-tab aria-hidden style={style}>
                  <span className="sk-tab-button">
                    <span className="sk-tab-name">{category.name}</span>
                    <small className="sk-tab-count">{count}</small>
                  </span>
                </div>
              )}
              <section id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-sheet={category.id} style={style} className="tpl-section tpl-tall-last sk-sheet">
                <div tabIndex={-1} data-heading className="sr-only outline-none">
                  <h2 id={`h-${category.slug}`}>{category.name}</h2>
                </div>
                <ul className="sk-rows">
                  {products.map((product, at) => (
                    <RowDish key={product.id} product={product} prefix="sk" suffix="stacked" sizes="72px" priority={index === 0 && at < 5} description />
                  ))}
                </ul>
              </section>
            </Fragment>
          );
        })}
      </main>
    </div>
  );
}
