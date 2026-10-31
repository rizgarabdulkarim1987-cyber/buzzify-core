'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/ui/AppProviders';
import { BasketParts, useTableBasket } from './table-basket';

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

function scannedHere(slug: string, table: number): boolean {
  try {
    return window.sessionStorage.getItem(`buzzify:table-seen:${slug}`) === String(table);
  } catch {
    return false;
  }
}

/** The order a guest dismissed, so the table's basket does not bring the same status back. */
function dismissedKey(slug: string): string {
  return `buzzify:basket-dismissed:${slug}`;
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

/** The order panel and the bill button share one question: is ordering open for this table, and was the table scanned. */
function Panel({ canSend }: { canSend: boolean }) {
  const { tenant, table, hydrated, preview } = useApp();
  const [available, setAvailable] = useState(false);
  const [scanned] = useState(() => table !== null && scannedHere(tenant.slug, table));
  const api = `/api/${tenant.slug}/qr-order`;

  useEffect(() => {
    if (!hydrated || preview || table === null || !scanned) return;
    const controller = new AbortController();
    fetch(`${api}/availability?table=${table}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ available: boolean }>) : { available: false }))
      .then((body) => setAvailable(body.available))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, [api, hydrated, preview, table, scanned]);

  return (
    <>
      <OrderPanel canSend={canSend} available={available} scanned={scanned} />
      {available && scanned && !preview && table !== null ? (
        <>
          {tenant.features.callWaiter === true ? <CallButton table={table} kind="WAITER" /> : null}
          <CallButton table={table} kind="BILL" />
        </>
      ) : null}
    </>
  );
}

/** One button: the waiter brings the bill, or comes to the table. Shown only where ordering from the table is open. */
function CallButton({ table, kind }: { table: number; kind: 'BILL' | 'WAITER' }) {
  const { t, tenant } = useApp();
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'tooMany' | 'failed'>('idle');
  const call = async () => {
    if (state === 'busy') return;
    setState('busy');
    try {
      const response = await fetch(`/api/${tenant.slug}/${kind === 'BILL' ? 'bill-call' : 'waiter-call'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table }),
      });
      setState(response.ok ? 'sent' : response.status === 429 ? 'tooMany' : 'failed');
    } catch {
      setState('failed');
    }
  };
  return (
    <section className="mt-6" aria-live="polite" data-testid={kind === 'BILL' ? 'bill-call' : 'waiter-call'}>
      {state === 'sent' ? (
        <p className="rounded-2xl border border-line p-4">{t(kind === 'BILL' ? 'qr.billSent' : 'qr.waiterSent')}</p>
      ) : (
        <>
          {state === 'tooMany' || state === 'failed' ? (
            <p className="mb-2 text-sm text-accent" role="alert">
              {t(state === 'tooMany' ? 'qr.billTooMany' : 'qr.billFailed')}
            </p>
          ) : null}
          <button type="button" onClick={() => void call()} disabled={state === 'busy'} className="min-h-12 w-full rounded-full border border-line px-6 disabled:opacity-60" data-testid={kind === 'BILL' ? 'bill-call-button' : 'waiter-call-button'}>
            {t(kind === 'BILL' ? 'qr.bill' : 'qr.waiter')}
          </button>
        </>
      )}
    </section>
  );
}

function OrderPanel({ canSend, available, scanned }: { canSend: boolean; available: boolean; scanned: boolean }) {
  const { t, tenant, locale, table, cart, preview, replaceCart } = useApp();
  const [sent, setSent] = useState<Sent | null>(() => readSent(tenant.slug));
  const [phase, setPhase] = useState<Phase>('PENDING');
  const [reason, setReason] = useState('');
  // Held for the captain's check before the cashier sees it as ready to accept.
  const [withCaptain, setWithCaptain] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const api = `/api/${tenant.slug}/qr-order`;
  // One basket for the whole table when the plan has it; otherwise this phone orders alone.
  const shared = tenant.features.tableBasket === true && !preview && table !== null && available && scanned && canSend;
  const basket = useTableBasket(shared && !sent);
  const followed = basket.view?.sent?.publicId ?? null;

  // Another phone at the table sent the basket: follow the same order.
  useEffect(() => {
    if (!followed || sent || table === null) return;
    try {
      if (window.sessionStorage.getItem(dismissedKey(tenant.slug)) === followed) return;
    } catch {
      // Without storage a dismissed status may come back once.
    }
    const next = { publicId: followed, table };
    writeSent(tenant.slug, next);
    setPhase('PENDING');
    setWithCaptain(false);
    setReason('');
    setSent(next);
  }, [followed, sent, table, tenant.slug]);

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
        const body = (await response.json()) as { status: Phase; rejectReason: string; awaitingCaptain?: boolean };
        if (stopped) return;
        setWithCaptain(body.status === 'PENDING' && body.awaitingCaptain === true);
        if (body.status === 'PENDING') return;
        setPhase(body.status);
        setReason(body.rejectReason);
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
  }, [api, sent, phase, tenant.slug]);

  const send = useCallback(async () => {
    if (table === null || busy) return;
    setBusy(true);
    setError('');
    try {
      let response: Response;
      if (shared) {
        // The guest's own part is written first, so the order holds everything on their phone.
        if (!(await basket.flush())) {
          setError(t('qr.failed'));
          return;
        }
        response = await fetch(`/api/${tenant.slug}/table-basket/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ table, token: basket.token, locale, note }),
        });
      } else {
        response = await fetch(api, {
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
      }
      if (!response.ok) {
        setError(t(response.status === 429 ? 'qr.tooMany' : 'qr.failed'));
        return;
      }
      const body = (await response.json()) as { publicId: string };
      const next = { publicId: body.publicId, table };
      writeSent(tenant.slug, next);
      setPhase('PENDING');
      setWithCaptain(false);
      setReason('');
      setNote('');
      setSent(next);
      replaceCart({ lines: [], bundles: [] });
    } catch {
      setError(t('qr.failed'));
    } finally {
      setBusy(false);
    }
  }, [api, basket, busy, cart.lines, locale, note, replaceCart, shared, t, table, tenant.slug]);

  const again = () => {
    try {
      if (sent) window.sessionStorage.setItem(dismissedKey(tenant.slug), sent.publicId);
    } catch {
      // Without storage a dismissed status may come back once.
    }
    writeSent(tenant.slug, null);
    setSent(null);
  };

  if (preview || table === null) return null;

  if (sent) {
    return (
      <section className="mt-8 rounded-2xl border border-line p-4" aria-live="polite" data-testid="qr-status">
        <h2 className="font-display text-xl">{t(`qr.${phase}.title`)}</h2>
        <p className="mt-1 text-muted">{t(`qr.${phase}.body`)}</p>
        {phase === 'PENDING' && withCaptain ? (
          <p className="mt-2" data-testid="qr-with-captain">
            {t('qr.captain')}
          </p>
        ) : null}
        {phase === 'REJECTED' && reason ? <p className="mt-2 break-words" dir="auto">{reason}</p> : null}
        {phase !== 'PENDING' ? (
          <button type="button" onClick={again} className="mt-4 min-h-12 rounded-full border border-line px-6">
            {t('qr.dismiss')}
          </button>
        ) : null}
      </section>
    );
  }

  if (!canSend || !available || !scanned) return null;
  if (cart.bundles.length > 0) return <p className="mt-8 text-sm text-muted">{t('qr.bundles')}</p>;
  const others = basket.view?.parts.some((part) => !part.mine) === true;
  const blocked = basket.view?.parts.some((part) => part.invalid) === true;
  const nothing = cart.lines.length === 0 && !others;

  return (
    <section className="mt-8" aria-labelledby="qr-send-title">
      <h2 id="qr-send-title" className="font-display text-xl">
        {t(shared ? 'basket.title' : 'qr.title', { table })}
      </h2>
      {shared ? <p className="mt-1 text-sm text-muted">{t('basket.intro')}</p> : null}
      {shared && basket.view ? <BasketParts view={basket.view} /> : null}
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
      <button type="button" onClick={() => void send()} disabled={busy || (shared && (nothing || blocked))} className="mt-4 min-h-12 w-full rounded-full bg-accent px-6 text-lg text-on-accent disabled:opacity-60" data-testid="qr-send">
        {busy ? t('qr.sending') : t(shared ? 'basket.send' : 'qr.send')}
      </button>
    </section>
  );
}
