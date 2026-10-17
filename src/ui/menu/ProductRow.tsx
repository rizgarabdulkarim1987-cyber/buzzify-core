'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { PlusIcon } from '@/ui/Icons';

export function ProductRow({ product, onOpen }: { product: MenuProductView; onOpen: (id: string) => void }) {
  const { t, money, addLine, announce, preview } = useApp();
  const orderable = product.orderState === 'OK';
  const canQuickAdd = orderable && !product.needsChoices && !preview;

  return (
    <li
      data-testid="product-row"
      className="group mx-5 grid grid-cols-[1fr_auto] items-center gap-x-5 border-b border-line py-5"
    >
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpen(product.id)}
          className="block w-full text-start transition-transform duration-150 ease-out-strong active:scale-[0.985]"
        >
          <span className="block font-display text-xl leading-snug">{product.name}</span>
          {product.badges && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {product.badges.map((badge) => (
                <span key={badge} className="rounded-full border border-line px-2 py-px text-xs text-muted">
                  {t(`menu.badge.${badge}`)}
                </span>
              ))}
            </span>
          )}
          {product.description && (
            <span className="mt-1.5 line-clamp-2 block max-w-[34ch] text-sm leading-relaxed text-muted">
              {product.description}
            </span>
          )}
        </button>
        <div className="mt-2 flex min-h-11 items-center gap-4">
          <span className="text-sm tabular-nums text-accent">{money(product.displayPrice)}</span>
          {!orderable && (
            <span className="text-sm text-muted">
              {t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable')}
            </span>
          )}
          {canQuickAdd && (
            <button
              type="button"
              aria-label={t('product.quickAdd', { name: product.name })}
              onClick={() => {
                addLine({ productId: product.id, variantId: null, optionIds: [], quantity: 1 });
                track('ADD_TO_CART', { productId: product.id, payload: { source: 'quick-add' } });
                announce(t('cart.added', { name: product.name }));
              }}
              className="grid size-11 place-items-center rounded-full border border-accent/55 text-accent transition-[color,background-color,scale] duration-150 ease-out-strong active:scale-92 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-on-accent"
            >
              <PlusIcon />
            </button>
          )}
        </div>
      </div>
      {/* The plate repeats the name button for pointer users; keyboard and screen readers use the name. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => onOpen(product.id)}
        className="block rounded-full"
      >
        <ProductVisual
          media={product.media}
          name={product.name}
          slug={product.slug}
          className={`plate size-[84px] transition-transform duration-200 ease-out-strong [@media(hover:hover)]:group-hover:scale-105 ${
            orderable ? '' : 'opacity-50'
          }`}
        />
      </button>
    </li>
  );
}
