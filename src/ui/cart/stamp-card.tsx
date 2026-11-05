'use client';

import { useEffect, useState } from 'react';
import type { CardView } from '@/server/pos/loyalty';
import { useApp } from '@/ui/AppProviders';

/** The secret this phone keeps for the restaurant's stamp card. Made once and kept; clearing the browser loses the card. */
function cardToken(slug: string): string {
  const key = `buzzify:stamp-card:${slug}`;
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  try {
    const saved = window.localStorage.getItem(key);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const made = make();
    window.localStorage.setItem(key, made);
    return made;
  } catch {
    // Without storage the card lasts for this page view only.
    return make();
  }
}

export interface StampCard {
  card: CardView | null;
  token: string;
  /** The guest ticked "use my reward"; true only while the card is full. */
  redeem: boolean;
  setRedeem(value: boolean): void;
}

/** The guest's stamp card at this table, read when the order panel opens (and again when `again` changes). Null while the program is off or unreachable. */
export function useStampCard(enabled: boolean, again: unknown): StampCard {
  const { tenant, table } = useApp();
  const [card, setCard] = useState<CardView | null>(null);
  // Read when this mounts, which is only after hydration (the order panel mounts then), so storage is there.
  const [token] = useState(() => cardToken(tenant.slug));
  const [redeem, setRedeem] = useState(false);

  useEffect(() => {
    if (!enabled || table === null) return;
    const controller = new AbortController();
    fetch(`/api/${tenant.slug}/loyalty-card?table=${table}`, { headers: { 'x-card-token': token }, cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<CardView>) : null))
      .then((body) => {
        setCard(body);
        if (!body?.full) setRedeem(false);
      })
      .catch(() => setCard(null));
    return () => controller.abort();
  }, [enabled, table, tenant.slug, token, again]);

  return { card, token, redeem: redeem && card?.full === true, setRedeem };
}

/** The card as the guest sees it: a dot per stamp, the reward, and the box that asks for it with this order. */
export function StampCardPanel({ stamp }: { stamp: StampCard }) {
  const { t } = useApp();
  const { card } = stamp;
  if (!card) return null;
  const filled = Math.min(card.stamps, card.required);
  return (
    <section className="mt-6 rounded-2xl border border-line p-4" aria-label={t('card.title')} data-testid="stamp-card">
      <h3 className="font-display text-lg">{t('card.title')}</h3>
      <ul className="mt-3 flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: card.required }, (_, index) => (
          <li key={index} className={`size-6 rounded-full border border-line-strong ${index < filled ? 'bg-accent' : ''}`} />
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted" data-testid="stamp-count">
        {t('card.progress', { stamps: filled, required: card.required })}
      </p>
      <p className="mt-1 break-words text-sm" dir="auto">
        {t('card.reward', { reward: card.reward })}
      </p>
      {card.full ? (
        <label className="mt-3 flex min-h-12 items-center gap-3">
          <input type="checkbox" checked={stamp.redeem} onChange={(event) => stamp.setRedeem(event.target.checked)} className="size-5" data-testid="stamp-redeem" />
          <span>{t('card.use')}</span>
        </label>
      ) : null}
    </section>
  );
}
