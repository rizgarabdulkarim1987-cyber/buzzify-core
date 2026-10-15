'use client';

import { useEffect } from 'react';
import type { BundleView } from '@/server/data/suggestion-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';

export function BundleSuggestion({ bundle, onApply }: { bundle: BundleView; onApply: (bundle: BundleView) => void }) {
  const { t, money } = useApp();

  useEffect(() => {
    track('BUNDLE_IMPRESSION', { suggestionId: bundle.suggestionId }, { once: true });
  }, [bundle.suggestionId]);

  return (
    <section data-testid="bundle-suggestion" aria-labelledby="bundle-title" className="mt-8 rounded-xl border border-line p-4">
      <h3 id="bundle-title" className="font-display text-lg">
        {t('bundle.title')}
      </h3>
      <p className="mt-1">{bundle.name}</p>
      {bundle.description && <p className="text-sm text-muted">{bundle.description}</p>}
      <p className="mt-2 text-sm tabular-nums text-muted">
        {t('bundle.compare', { individual: money(bundle.individualTotal * bundle.times), price: money(bundle.bundlePrice * bundle.times) })}
      </p>
      <p className="text-sm tabular-nums">{t('bundle.save', { amount: money(bundle.savings) })}</p>
      <button
        type="button"
        onClick={() => {
          track('BUNDLE_ACCEPT', { suggestionId: bundle.suggestionId });
          onApply(bundle);
        }}
        className="mt-3 min-h-11 rounded-full bg-accent px-5 text-on-accent"
      >
        {t('bundle.apply')}
      </button>
    </section>
  );
}
