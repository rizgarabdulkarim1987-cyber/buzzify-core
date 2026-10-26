'use client';

import { useState } from 'react';
import { unitPriceFromMenu } from '@/lib/menu-price';
import type { MenuGroupView, MenuProductView } from '@/server/data/menu-view';
import type { UpsellOffer } from '@/server/domain';

/**
 * What a guest has chosen for one product: its size, its options and how many. The same rules as the classic product
 * sheet: a single-choice required group always keeps one choice, a group never takes more than its maximum.
 */
export function useProductChoice(product: MenuProductView, initialVariantId: string | null = null) {
  const defaultVariant = product.variants.find((variant) => variant.isDefault)?.id ?? null;
  const [variantId, setVariantId] = useState<string | null>(
    initialVariantId && initialVariantId !== defaultVariant && product.variants.some((variant) => variant.id === initialVariantId) ? initialVariantId : null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

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

  const chooseVariant = (id: string) => setVariantId(id === defaultVariant ? null : id);

  /** Applies an upgrade the engine offered: a size, an option, or (returned) another product to open. */
  const accept = (offer: UpsellOffer): string | null => {
    if (offer.kind === 'VARIANT') setVariantId(offer.refId);
    else if (offer.kind === 'OPTION') {
      const group = product.groups.find((candidate) => candidate.options.some((option) => option.id === offer.refId));
      if (group) toggle(group.id, offer.refId);
    } else return offer.refId;
    return null;
  };

  const missingIn = (group: MenuGroupView) => group.minSelect > group.options.filter((option) => selected.includes(option.id)).length;
  const missing = product.groups.filter(missingIn);
  const orderable = product.orderState === 'OK';

  return {
    variantId,
    effectiveVariant: variantId ?? defaultVariant,
    defaultVariant,
    selected,
    quantity,
    setQuantity,
    toggle,
    chooseVariant,
    accept,
    missing,
    missingIn,
    orderable,
    canAdd: orderable && missing.length === 0,
    unit: unitPriceFromMenu(product, variantId, selected),
  };
}

export type ProductChoice = ReturnType<typeof useProductChoice>;
