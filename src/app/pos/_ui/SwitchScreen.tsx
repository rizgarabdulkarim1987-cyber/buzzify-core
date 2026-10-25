'use client';

import { Delete } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PosRole } from '@/server/domain/pos/permissions';
import { formatNumber, formatStamp } from '@/lib/pos-format';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { useSyncOptional } from './sync/SyncProvider';

interface Props {
  deviceName: string;
  staff: { staffId: string; name: string; role: PosRole }[];
}

const MAX_DIGITS = 8;
const MIN_DIGITS = 4;
const KEY = 'flex h-16 min-w-16 items-center justify-center rounded-lg border border-line bg-surface text-xl font-semibold text-text transition-colors hover:bg-hover active:bg-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * The shared device's switch screen: pick a name, tap the PIN, and the till opens as that person. The pad stays
 * left-to-right in every language (digits do not mirror); names follow their own direction. Needs the network.
 */
export function SwitchScreen({ deviceName, staff }: Props) {
  const t = useT();
  const sync = useSyncOptional();
  const online = sync?.online ?? true;
  const [chosen, setChosen] = useState<Props['staff'][number] | null>(null);
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  function choose(person: Props['staff'][number] | null) {
    setChosen(person);
    setPin('');
    setProblem(null);
  }

  async function submit() {
    if (!chosen || sending.current || pin.length < MIN_DIGITS) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch('/api/pos/pin/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ staffId: chosen.staffId, pin }),
      });
      if (response.ok) {
        // A full load on purpose: the new person gets a fresh page, read cache and sync scope.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/pos';
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; retryAt?: string } };
      const code = body.error?.code;
      setPin('');
      if (code === 'pinLocked') setProblem(t('pos.switch.locked', { time: body.error?.retryAt ? formatStamp(body.error.retryAt) : '' }));
      else if (code === 'deviceLimit') setProblem(t('pos.switch.deviceLimit'));
      else if (code === 'tillClosed') setProblem(t('pos.switch.closed'));
      else if (code === 'deviceUnknown') setProblem(t('pos.switch.unknownDevice'));
      else if (code === 'pinRefused') setProblem(t('pos.switch.refused'));
      else setProblem(t('pos.switch.failed'));
    } catch {
      setProblem(t('pos.switch.needsNetwork'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const add = (digit: string) => setPin((now) => (now.length < MAX_DIGITS ? now + digit : now));

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text">{t('pos.switch.title')}</h1>
        <p className="text-sm text-muted">{t('pos.switch.deviceLabel', { name: deviceName })}</p>
      </div>
      {!online ? (
        <p role="alert" className="rounded-lg border border-line px-4 py-3 text-base text-text">
          {t('pos.switch.needsNetwork')}
        </p>
      ) : null}
      {chosen === null ? (
        staff.length === 0 ? (
          <p className="text-base text-muted">{t('pos.switch.none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {staff.map((person) => (
              <li key={person.staffId}>
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => choose(person)}
                  className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-start text-lg text-text hover:bg-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span dir="auto" className="min-w-0 truncate font-semibold">
                    {person.name}
                  </span>
                  <span className="shrink-0 text-sm text-muted">{t(`pos.role.${person.role}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p dir="auto" className="text-base text-text">
            {t('pos.switch.enter', { name: chosen.name })}
          </p>
          <div aria-live="polite" className="flex h-12 items-center justify-center gap-2" dir="ltr">
            {Array.from({ length: Math.max(pin.length, MIN_DIGITS) }, (_, index) => (
              <span key={index} aria-hidden="true" className={`size-4 rounded-full border border-line ${index < pin.length ? 'bg-ink' : ''}`} />
            ))}
            <span className="sr-only">{t('pos.switch.entered', { n: formatNumber(pin.length) })}</span>
          </div>
          {problem ? (
            <p role="alert" className="text-center text-base text-danger">
              {problem}
            </p>
          ) : null}
          <div dir="ltr" className="mx-auto grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button key={digit} type="button" className={KEY} disabled={busy || !online} aria-label={t('pos.switch.digit', { n: digit })} onClick={() => add(digit)}>
                {digit}
              </button>
            ))}
            <button type="button" className={KEY} disabled={busy || pin.length === 0} aria-label={t('pos.switch.delete')} onClick={() => setPin((now) => now.slice(0, -1))}>
              <Delete aria-hidden="true" className="size-6 rtl:rotate-180" />
            </button>
            <button type="button" className={KEY} disabled={busy || !online} aria-label={t('pos.switch.digit', { n: '0' })} onClick={() => add('0')}>
              0
            </button>
            <Button type="submit" size="lg" className="h-16 min-w-16 text-base" pending={busy} disabled={!online || pin.length < MIN_DIGITS}>
              {t('pos.switch.submit')}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="lg" className="min-h-12 self-center" onClick={() => choose(null)}>
            {t('pos.switch.back')}
          </Button>
        </form>
      )}
    </div>
  );
}
