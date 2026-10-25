'use client';

import { useState, useSyncExternalStore } from 'react';
import type { Locale } from '@/lib/locale';
import { COMPLAINT_CATEGORIES, COMPLAINT_TEXT_MAX, CONTACT_NAME_MAX } from '@/server/domain/pos/complaint-rules';
import { WORDS } from './words';

type Phase = 'form' | 'sending' | 'sent';

function subscribeOnline(notify: () => void): () => void {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

function newKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

const FIELD = 'min-h-12 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-text';

export function ComplaintForm({ slug, table, locale }: { slug: string; table: number; locale: Locale }) {
  const w = WORDS[locale];
  const [clientKey, setClientKey] = useState(newKey);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [phase, setPhase] = useState<Phase>('form');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');

  async function send() {
    if (body.trim() === '') return setError(w.empty);
    if ((name.trim() || phone.trim()) && !consent) return setError(w.consentNeeded);
    setError('');
    setPhase('sending');
    try {
      const response = await fetch(`/api/${slug}/complaint`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          table,
          locale,
          clientKey,
          body,
          ...(category ? { category } : {}),
          ...(name.trim() ? { contactName: name.trim() } : {}),
          ...(phone.trim() ? { contactPhone: phone.trim() } : {}),
          consent,
          website,
        }),
      });
      if (response.ok) {
        setPhase('sent');
        return;
      }
      setPhase('form');
      setError(response.status === 429 ? w.tooMany : w.failed);
    } catch {
      setPhase('form');
      setError(w.failed);
    }
  }

  if (phase === 'sent') {
    return (
      <div className="flex flex-col gap-4" data-testid="complaint-sent">
        <p className="text-lg text-text" role="status">
          {w.thanks}
        </p>
        <button
          type="button"
          className="inline-flex min-h-12 w-fit items-center rounded-md border border-line px-5 text-base text-text"
          onClick={() => {
            setBody('');
            setCategory('');
            setName('');
            setPhone('');
            setConsent(false);
            setClientKey(newKey());
            setPhase('form');
          }}
        >
          {w.again}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label className="flex flex-col gap-1 text-base text-text">
        {w.what}
        <textarea className={FIELD} dir="auto" rows={5} maxLength={COMPLAINT_TEXT_MAX} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-base text-text">
        {w.category}
        <select className={FIELD} value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">{w.any}</option>
          {COMPLAINT_CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {w[key]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="text-sm text-muted">{w.contactIntro}</legend>
        <input className={FIELD} dir="auto" autoComplete="name" maxLength={CONTACT_NAME_MAX} placeholder={w.name} aria-label={w.name} value={name} onChange={(event) => setName(event.target.value)} />
        <input className={FIELD} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder={w.phone} aria-label={w.phone} value={phone} onChange={(event) => setPhone(event.target.value)} />
        <label className="flex min-h-12 items-center gap-3 text-base text-text">
          <input type="checkbox" className="size-6" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          {w.consent}
        </label>
      </fieldset>
      {/* The honeypot: out of sight and out of the tab order. A person never fills it; a script that fills every field does. */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-base text-text">
          {error}
        </p>
      ) : null}
      {online ? null : <p className="text-sm text-muted">{w.offline}</p>}
      <button type="submit" disabled={!online || phase === 'sending'} className="inline-flex min-h-12 w-fit items-center rounded-md bg-accent px-6 text-base font-medium text-on-accent disabled:opacity-50">
        {phase === 'sending' ? w.sending : w.send}
      </button>
    </form>
  );
}
