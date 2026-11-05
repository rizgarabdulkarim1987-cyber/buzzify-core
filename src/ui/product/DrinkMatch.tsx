'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';

/** "Goes well with": the drinks that suit the open dish (plan feature `guest.drinkMatch`). Tapping one opens that drink. */
export function DrinkMatch({ product, onOpen }: { product: MenuProductView; onOpen: (id: string) => void }) {
  const { t, price } = useApp();
  const match = product.match;
  if (!match || match.length === 0) return null;
  return (
    <section aria-labelledby={`match-${product.id}`} className="mt-8">
      <h3 id={`match-${product.id}`} className="font-display text-lg">
        {t('match.title')}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {match.map((drink) => (
          <li key={drink.id}>
            <button
              type="button"
              onClick={() => onOpen(drink.id)}
              aria-label={t('match.open', { name: drink.name })}
              className="flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm"
            >
              <span>{drink.name}</span>
              <span className="tabular-nums text-muted">{price(drink.price)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
