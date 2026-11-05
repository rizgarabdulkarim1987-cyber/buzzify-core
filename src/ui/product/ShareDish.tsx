'use client';

import { useState } from 'react';
import { useApp } from '@/ui/AppProviders';

/**
 * Shares the open dish as a card: the picture with its name and price where the phone can share files, else the dish's
 * link, else the card is saved. Absent when the plan lacks it and in the Studio's preview.
 */
export function ShareDish({ slug, name }: { slug: string; name: string }) {
  const { tenant, locale, t, href, preview } = useApp();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (tenant.features.shareCards !== true || preview) return null;

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const link = new URL(href(`/p/${encodeURIComponent(slug)}`), window.location.origin).toString();
    try {
      const response = await fetch(`/api/${tenant.slug}/share-card?slug=${encodeURIComponent(slug)}&locale=${locale}`);
      if (!response.ok) throw new Error('card');
      const blob = await response.blob();
      const file = new File([blob], `${slug}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name, url: link });
      } else if (navigator.share) {
        await navigator.share({ title: name, url: link });
      } else {
        const saved = document.createElement('a');
        saved.href = URL.createObjectURL(blob);
        saved.download = file.name;
        saved.click();
        URL.revokeObjectURL(saved.href);
      }
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <button type="button" onClick={() => void share()} disabled={busy} className="min-h-11 rounded-full border border-line px-5 text-sm disabled:opacity-60" data-testid="share-dish">
        {busy ? t('share.making') : t('share.dish')}
      </button>
      {failed ? (
        <p className="mt-2 text-sm text-accent" role="alert">
          {t('share.failed')}
        </p>
      ) : null}
    </div>
  );
}
