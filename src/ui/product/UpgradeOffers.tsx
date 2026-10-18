'use client';

import { useEffect } from 'react';
import type { UpsellOffer } from '@/server/domain';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';

export function UpgradeOffers({
  productId,
  offers,
  onAccept,
}: {
  productId: string;
  offers: UpsellOffer[];
  onAccept: (offer: UpsellOffer) => void;
}) {
  const { t, price } = useApp();

  useEffect(() => {
    for (const offer of offers) {
      track('UPSELL_IMPRESSION', { productId, suggestionId: offer.suggestionId }, { once: true });
    }
  }, [offers, productId]);

  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="upgrades-title" className="mt-8">
      <h3 id="upgrades-title" className="font-display text-lg">
        {t('upgrade.title')}
      </h3>
      <ul className="mt-1">
        {offers.map((offer) => (
          <li key={offer.suggestionId} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p>{offer.title}</p>
              {offer.effect && <p className="text-sm text-muted">{offer.effect}</p>}
              <p className="text-sm text-muted tabular-nums">
                {t('upgrade.becomes', { amount: price(offer.resultingTotal) })}
              </p>
            </div>
            <span className="shrink-0 text-sm tabular-nums">+{price(offer.priceDelta)}</span>
            <button
              type="button"
              onClick={() => {
                track('UPSELL_ACCEPT', { productId, suggestionId: offer.suggestionId });
                onAccept(offer);
              }}
              className="min-h-11 shrink-0 rounded-full border border-accent px-4 text-sm text-accent"
              aria-label={`${offer.kind === 'SWAP' ? t('upgrade.switch') : t('upgrade.add')} ${offer.title}`}
            >
              {offer.kind === 'SWAP' ? t('upgrade.switch') : t('upgrade.add')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
