'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/ui/AppProviders';

const POLL_MS = 5_000;

type Phase = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
interface Sent {
  publicId: string;
  table: number;
}

function storageKey(slug: string): string {
  return `buzzify:qr-order:${slug}`;
}

function readSent(slug: string): Sent | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey(slug)) ?? 'null') as Sent | null;
    return parsed && typeof parsed.publicId === 'string' && Number.isInteger(parsed.table) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSent(slug: string, sent: Sent | null): void {
  try {
    if (sent) window.sessionStorage.setItem(storageKey(slug), JSON.stringify(sent));
    else window.sessionStorage.removeItem(storageKey(slug));
  } catch {
    // Without storage the request is still sent; only the follow-up after a reload is lost.
  }
}

/**
 * Lets a guest at a table send the cart to the cashier, then shows whether it was accepted. Nothing but ids and quantities is
 * sent: the server prices the order itself. It stays hidden when the restaurant takes no QR orders at this table.
 */
export function SendToWaiter({ canSend }: { canSend: boolean }) {
  const { hydrated } = useApp();
  // The saved request is read from sessionStorage when this mounts, so it mounts only after hydration.
  return hydrated ? <Panel canSend={canSend} /> : null;
}

function Panel({ canSend }: { canSend: boolean }) {
  const { t, tenant, locale, table, cart, hydrated, preview, replaceCart, announce } = useApp();
  const [available, setAvailable] = useState(false);
  const [sent, setSent] = useState<Sent | null>(() => readSent(tenant.slug));
  const [phase, setPhase] = useState<Phase>('PENDING');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const api = `/api/${tenant.slug}/qr-order`;

  useEffect(() => {
    if (!hydrated || preview || table === null) return;
    const controller = new AbortController();
    fetch(`${api}/availability?table=${table}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ available: boolean }>) : { available: false }))
      .then((body) => setAvailable(body.available))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, [api, hydrated, preview, table]);

  useEffect(() => {
    if (!sent || phase !== 'PENDING') return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(`${api}/${sent.publicId}?table=${sent.table}`, { cache: 'no-store' });
        if (response.status === 404) {
          if (!stopped) {
            writeSent(tenant.slug, null);
            setSent(null);
          }
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as { status: Phase; rejectReason: string };
        if (stopped || body.status === 'PENDING') return;
        setPhase(body.status);
        setReason(body.rejectReason);
        announce(t(`qr.${body.status}`));
      } catch {
        // A dropped connection is retried on the next tick.
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [api, sent, phase, tenant.slug, announce, t]);

  const send = useCallback(async () => {
    if (table === null || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          table,
          locale,
          cart: {
            lines: cart.lines.map((line) => ({ productId: line.productId, variantId: line.variantId, optionIds: line.optionIds, quantity: line.quantity })),
            bundles: [],
          },
          note,
        }),
      });
      if (!response.ok) {
        setError(t(response.status === 429 ? 'qr.tooMany' : 'qr.failed'));
        return;
      }
      const body = (await response.json()) as { publicId: string };
      const next = { publicId: body.publicId, table };
      writeSent(tenant.slug, next);
      setPhase('PENDING');
      setReason('');
      setNote('');
      setSent(next);
      replaceCart({ lines: [], bundles: [] });
    } catch {
      setError(t('qr.failed'));
    } finally {
      setBusy(false);
    }
  }, [api, busy, cart.lines, locale, note, replaceCart, t, table, tenant.slug]);

  const again = () => {
    writeSent(tenant.slug, null);
    setSent(null);
  };

  if (preview || table === null) return null;

  if (sent) {
    return (
      <section className="mt-8 rounded-2xl border border-line p-4" aria-live="polite" data-testid="qr-status">
        <h2 className="font-display text-xl">{t(`qr.${phase}.title`)}</h2>
        <p className="mt-1 text-muted">{t(`qr.${phase}.body`)}</p>
        {phase === 'REJECTED' && reason ? <p className="mt-2 break-words" dir="auto">{reason}</p> : null}
        {phase !== 'PENDING' ? (
          <button type="button" onClick={again} className="mt-4 min-h-12 rounded-full border border-line px-6">
            {t('qr.dismiss')}
          </button>
        ) : null}
      </section>
    );
  }

  if (!canSend || !available || cart.bundles.length > 0) return null;

  return (
    <section className="mt-8" aria-labelledby="qr-send-title">
      <h2 id="qr-send-title" className="font-display text-xl">
        {t('qr.title', { table })}
      </h2>
      <label className="mt-3 block text-sm text-muted" htmlFor="qr-note">
        {t('qr.note')}
      </label>
      <textarea
        id="qr-note"
        value={note}
        maxLength={300}
        onChange={(event) => setNote(event.target.value)}
        dir="auto"
        rows={2}
        className="mt-1 w-full rounded-xl border border-line bg-transparent p-3"
      />
      {error ? <p className="mt-2 text-sm text-accent" role="alert">{error}</p> : null}
      <button type="button" onClick={() => void send()} disabled={busy} className="mt-4 min-h-12 w-full rounded-full bg-accent px-6 text-lg text-on-accent disabled:opacity-60" data-testid="qr-send">
        {busy ? t('qr.sending') : t('qr.send')}
      </button>
    </section>
  );
}
