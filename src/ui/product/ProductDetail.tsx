'use client';

import { useEffect, useMemo, useState } from 'react';
import { unitPriceFromMenu } from '@/lib/menu-price';
import { stageTone } from '@/lib/stage';
import type { MenuProductView } from '@/server/data/menu-view';
import type { UpsellOffer } from '@/server/domain';
import { formatCount } from '@/server/domain/money';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { RollingMoney } from '@/ui/RollingMoney';
import { CloseIcon, MinusIcon, PlusIcon } from '@/ui/Icons';
import { ProductStage } from '@/ui/stage/ProductStage';
import { useSuggestions } from '@/ui/useSuggestions';
import { OptionGroup } from './OptionGroup';
import { PairingList } from './PairingList';
import { UpgradeOffers } from './UpgradeOffers';

interface Props {
  product: MenuProductView;
  mode: 'sheet' | 'page';
  titleId: string;
  /** Called after the item is added, or when the sheet is dismissed. */
  onDone: () => void;
  /** Replaces the open product with another one (an upgrade swap or a pairing that needs choices). */
  onSwitch: (productId: string) => void;
}

export function ProductDetail({ product, mode, titleId, onDone, onSwitch }: Props) {
  const { t, money, addLine, announce, cart, dismissed, dismiss, locale, tenant, preview } = useApp();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  const orderable = product.orderState === 'OK';
  const staged = stageTone(product.media) !== null;
  const unit = unitPriceFromMenu(product, variantId, selected);
  const missing = product.groups.filter(
    (group) => group.minSelect > group.options.filter((option) => selected.includes(option.id)).length,
  );
  const canAdd = orderable && missing.length === 0;

  const body = useMemo(
    () => ({
      context: 'product' as const,
      product: { productId: product.id, variantId, optionIds: selected },
      cart,
      dismissedIds: dismissed,
    }),
    [product.id, variantId, selected, cart, dismissed],
  );
  const { data } = useSuggestions(orderable ? body : null);

  useEffect(() => {
    if (mode === 'page') track('PRODUCT_VIEW', { productId: product.id }, { once: true });
  }, [mode, product.id]);

  const toggle = (groupId: string, optionId: string) => {
    const group = product.groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setSelected((current) => {
      const inGroup = group.options.map((option) => option.id);
      const chosen = current.filter((id) => inGroup.includes(id));
      const others = current.filter((id) => !inGroup.includes(id));
      if (current.includes(optionId)) {
        return group.minSelect > 0 && group.maxSelect === 1 ? current : [...others, ...chosen.filter((id) => id !== optionId)];
      }
      if (group.maxSelect === 1) return [...others, optionId];
      if (chosen.length >= group.maxSelect) return current;
      return [...others, ...chosen, optionId];
    });
  };

  const accept = (offer: UpsellOffer) => {
    if (offer.kind === 'VARIANT') setVariantId(offer.refId);
    else if (offer.kind === 'OPTION') {
      const group = product.groups.find((candidate) => candidate.options.some((option) => option.id === offer.refId));
      if (group) toggle(group.id, offer.refId);
    } else onSwitch(offer.refId);
  };

  const add = () => {
    if (!canAdd) return;
    addLine({ productId: product.id, variantId, optionIds: selected, quantity });
    track('ADD_TO_CART', { productId: product.id, payload: { source: 'detail', options: selected.length } });
    announce(t('cart.added', { name: product.name }));
    onDone();
  };

  const Heading = mode === 'page' ? 'h1' : 'h2';
  const defaultVariant = product.variants.find((variant) => variant.isDefault)?.id ?? null;
  const effectiveVariant = variantId ?? defaultVariant;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="stage-light relative">
        {staged ? (
          <ProductStage
            product={product}
            selectedIds={selected}
            variant="sheet"
            testId="sheet-stage"
            posterSlug={`${product.slug}-detail`}
            className="aspect-[16/10] w-full"
          />
        ) : (
          <ProductVisual
            media={product.media}
            name={product.name}
            slug={`${product.slug}-detail`}
            priority
            placeholder
            sizes="(min-width: 640px) 576px, 100vw"
            className="aspect-[16/10] w-full"
          />
        )}
        {mode === 'sheet' && (
          <button
            type="button"
            onClick={onDone}
            aria-label={t('product.close')}
            className="absolute end-3 top-3 grid size-11 place-items-center rounded-full bg-bg/80 text-text"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <Heading id={titleId} className="mt-4 font-display text-[2.5rem] leading-[1.02] tracking-[-0.01em]">
          {product.name}
        </Heading>
        {product.description && <p className="mt-2 max-w-prose text-muted">{product.description}</p>}
        <p className="mt-3 text-lg tabular-nums text-accent">{money(product.displayPrice)}</p>
        {!orderable && (
          <p className="mt-3 text-accent">
            {t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable')}
          </p>
        )}

        {product.variants.length > 1 && (
          <OptionGroup
            title={t('product.size')}
            min={1}
            max={1}
            selected={effectiveVariant ? [effectiveVariant] : []}
            items={product.variants.map((variant) => ({
              id: variant.id,
              name: variant.name,
              priceDelta: variant.priceDelta - (product.variants.find((v) => v.isDefault)?.priceDelta ?? 0),
            }))}
            onToggle={(id) => setVariantId(id === defaultVariant ? null : id)}
          />
        )}

        {product.groups.map((group) => (
          <OptionGroup
            key={group.id}
            title={group.name}
            min={group.minSelect}
            max={group.maxSelect}
            selected={selected}
            items={group.options.map((option) => ({
              id: option.id,
              name: option.name,
              effect: option.effect,
              priceDelta: option.priceDelta,
              disabled: !option.isAvailable,
            }))}
            onToggle={(id) => toggle(group.id, id)}
          />
        ))}

        {orderable && <UpgradeOffers productId={product.id} offers={data?.upgrades ?? []} onAccept={accept} />}

        {orderable && (
          <PairingList
            offers={data?.pairings ?? []}
            onAdd={(offer) => {
              addLine({ productId: offer.productId, variantId: null, optionIds: [], quantity: 1 });
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              announce(t('cart.added', { name: offer.name }));
            }}
            onChoose={(offer) => {
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              onSwitch(offer.productId);
            }}
            onDismiss={(offer) => dismiss(offer.suggestionId)}
          />
        )}

        {product.ingredients.length > 0 && (
          <section className="mt-8">
            <h3 className="font-display text-lg">{t('product.ingredients')}</h3>
            <p className="mt-1 text-muted">{product.ingredients.join(', ')}</p>
          </section>
        )}
        {product.allergens.length > 0 && (
          <p className="mt-4 text-sm text-muted">
            {t('product.allergens')}: {product.allergens.map((key) => t(`allergen.${key}`)).join(', ')}
          </p>
        )}
        {(product.dietary || product.calories !== undefined) && (
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted" aria-label={t('menu.dietary.label')}>
            {product.dietary?.map((tag) => (
              <li key={tag}>{t(`menu.dietary.${tag}`)}</li>
            ))}
            {product.calories !== undefined && (
              <li className="tabular-nums">{t('menu.calories', { count: formatCount(product.calories, locale, tenant.numeralSystem) })}</li>
            )}
          </ul>
        )}
      </div>

      {!preview && (
      <div className="border-t border-line bg-surface px-5 py-4">
        {!canAdd && orderable && <p className="mb-3 text-sm text-accent">{t('product.makeChoices')}</p>}
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-full border border-line" role="group" aria-label={t('product.quantity')}>
            <button
              type="button"
              aria-label={t('product.decrease')}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="grid size-11 place-items-center"
            >
              <MinusIcon />
            </button>
            <output className="min-w-6 text-center tabular-nums" aria-live="polite">
              {quantity}
            </output>
            <button
              type="button"
              aria-label={t('product.increase')}
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              className="grid size-11 place-items-center"
            >
              <PlusIcon />
            </button>
          </div>
          <button
            type="button"
            disabled={!canAdd}
            onClick={add}
            className="flex min-h-12 flex-1 items-center justify-between rounded-full bg-accent px-6 text-on-accent transition-transform duration-150 ease-out-strong active:scale-[0.98] disabled:opacity-40"
          >
            <span>{t('product.add')}</span>
            <RollingMoney value={unit * quantity} className="tabular-nums" />
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
