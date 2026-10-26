'use client';

import { useRef } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { RowDish } from './shared/RowDish';
import { useKeepInView } from './shared/useKeepInView';
import './shared/shapes.css';
import './elevator.css';

/**
 * An elevator (spec 2026-10-26-menu-styles-in-templates-design.md). A brass button panel stays pinned at the inline
 * edge: a floor display showing the floor in view and one numbered button per section (1 to n, in the menu's numerals).
 * Each section is a floor, stacked on one page, with a row per dish: photo, name, price and an add button. All floors
 * are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them; the lit button follows the page.
 */
export function ElevatorBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, activeId, jumpTo, reduced } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // The floor in view; -1 when a search or a filter hides it, and then the display shows no floor (no button is lit).
  const current = categories.findIndex((category) => category.id === activeId);

  // Keep the lit button in view, moving only the panel (never the page).
  useKeepInView(strip, activeId, 'y', reduced);

  return (
    <div className="tpl-body" data-body="elevator">
      <nav aria-label={t('menu.categories')} data-rail className="el-rail">
        <div data-display aria-hidden className="el-display">
          <span key={current}>{current >= 0 ? n(current + 1) : ''}</span>
        </div>
        <ul ref={strip} className="scroll-hidden el-buttons">
          {categories.map((category, index) => (
            <li key={category.id}>
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                aria-label={t('tpl.elv.goTo', { n: n(index + 1), name: category.name })}
                onClick={() => jumpTo(category.id)}
                className="el-button"
              >
                <b data-floor-no aria-hidden>
                  {n(index + 1)}
                </b>
                <span aria-hidden>{category.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main id="menu" className="el-floors min-w-0">
        {categories.map((category, index) => (
          <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-floor={n(index + 1)} className="tpl-section tpl-tall-last el-floor">
            <div tabIndex={-1} data-heading className="outline-none">
              <h2 id={`h-${category.slug}`} className="tpl-display el-title">
                <span>{category.name}</span>
                <small aria-hidden>{t('tpl.elv.floor', { n: n(index + 1) })}</small>
              </h2>
            </div>
            <ul className="el-rows">
              {(byCategory.get(category.id) ?? []).map((product, row) => (
                <RowDish key={product.id} product={product} prefix="el" suffix="elevator" sizes="64px" priority={index === 0 && row < 5} description />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
