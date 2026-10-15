'use client';

import { useEffect } from 'react';
import type { PairingView } from '@/server/data/suggestion-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { CloseIcon } from '@/ui/Icons';

export function PairingList({
  offers,
  onAdd,
  onChoose,
  onDismiss,
}: {
  offers: PairingView[];
  onAdd: (offer: PairingView) => void;
  onChoose: (offer: PairingView) => void;
  onDismiss: (offer: PairingView) => void;
}) {
  const { t, money } = useApp();

  useEffect(() => {
    for (const offer of offers) {
      track('PAIRING_IMPRESSION', { productId: offer.productId, suggestionId: offer.suggestionId }, { once: true });
    }
  }, [offers]);

  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="pairing-title" className="mt-8">
      <h3 id="pairing-title" className="font-display text-lg">
        {t('pairing.title')}
      </h3>
      <ul className="mt-1">
        {offers.map((offer) => (
          <li key={offer.suggestionId} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
            <ProductVisual
              media={offer.media}
              name={offer.name}
              slug={`pair-${offer.productId}`}
              className="size-14 shrink-0 rounded-lg"
              sizes="56px"
            />
            <div className="min-w-0 flex-1">
              <p>{offer.name}</p>
              {offer.reason && <p className="text-sm text-muted">{offer.reason}</p>}
              <p className="text-sm tabular-nums text-muted">{money(offer.price)}</p>
            </div>
            <button
              type="button"
              onClick={() => (offer.needsChoices ? onChoose(offer) : onAdd(offer))}
              aria-label={offer.needsChoices ? t('pairing.choose', { name: offer.name }) : t('pairing.add', { name: offer.name })}
              className="min-h-11 shrink-0 rounded-full border border-accent px-4 text-sm text-accent"
            >
              {t('upgrade.add')}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(offer)}
              aria-label={t('pairing.dismiss')}
              title={t('pairing.dismiss')}
              className="grid size-11 shrink-0 place-items-center text-muted"
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
