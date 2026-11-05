'use client';

import { CircleAlert, CircleCheck, Hourglass, Lock, Printer, Search, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { returnSlip } from '@/app/pharmacy/_actions/receipts';
import { returnableLines } from '@/app/pharmacy/_actions/returns';
import { listSales } from '@/app/pharmacy/_actions/sales';
import type { ReceiptResult } from '@/server/pharmacy/receipt-print';
import type { ReturnResult } from '@/server/pharmacy/returns';
import type { Returnable } from '@/server/pharmacy/returns-reads';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { phMessage } from '../ph-failure';
import { ReturnWorkspace } from '../ReturnWorkspace';
import { formatMinor, type Currency } from '../sell-logic';
import { FieldInput, Note, Num, PH_BTN, PH_FIELD, PH_PRIMARY } from '../sell-parts';
import { ThermalNote } from '../ThermalNote';
import { useThermal, useThermalJob } from '../use-thermal';
import { saleNumberOf } from './panels-logic';

/**
 * Return mode, inline in the work panel: a return is always against its ORIGINAL sale, found by the receipt number, and goes
 * through the existing returns screen's form (`ReturnWorkspace`: per line what was sold, returned and is left, the quantity capped at
 * what is left, the server's refund figure, one key per request) and action (`ph.returns.create`, which takes the same batches and
 * prices the sale took, and needs `return.approve`). Nothing here opens the cash drawer: the return slip is printed with the drawer
 * off. A return without the original sale is never sent from here: the way without it says who decides.
 */
export function ReturnFlow({ canReturn, shiftCurrency }: { canReturn: boolean; shiftCurrency: Currency }) {
  const t = useT();
  const { locale } = useLocale();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [noSale, setNoSale] = useState(false);
  const [found, setFound] = useState<Returnable | null>(null);
  const [done, setDone] = useState<ReturnResult | null>(null);

  const note = (
    <p className="text-xs text-ph-muted" data-testid="return-note">
      {t('pharmacy.cashier.return.note')}
    </p>
  );
  if (!canReturn) {
    return (
      <div className="flex flex-col gap-2">
        <Note look="ph" icon={<Lock aria-hidden />} role="status" testId="return-role">
          {t('pharmacy.cashier.return.role')}
        </Note>
        {note}
      </div>
    );
  }
  const again = () => void (setFound(null), setDone(null), setText(''), setNotFound(null), setProblem(null));
  if (done) return <ReturnSlip result={done} onAgain={again} />;

  const find = async (event: FormEvent) => {
    event.preventDefault();
    const number = saleNumberOf(text);
    if (busy || number === '') return;
    setBusy(true);
    setProblem(null);
    setNotFound(null);
    const list = await settle(() => listSales({ number, pageSize: 5 }));
    const sale = list.ok ? (list.data as { items: { id: string }[] }).items[0] : undefined;
    const lines = sale ? await settle(() => returnableLines({ saleId: sale.id })) : null;
    setBusy(false);
    if (!list.ok) setProblem(phMessage(t, locale, list.error, 'pharmacy.returns'));
    else if (!lines) setNotFound(number);
    else if (!lines.ok) setProblem(phMessage(t, locale, lines.error, 'pharmacy.returns'));
    else setFound(lines.data as Returnable);
  };

  if (found) {
    const blocked = !found.window.withinWindow && !found.window.mayOverride;
    return (
      <div className="flex min-w-0 flex-col gap-2.5" data-testid="return-sale">
        <p className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-ph-text">
          <span>{t('pharmacy.cashier.return.sale', { number: found.number ?? '' })}</span>
          <button type="button" className={PH_BTN} data-testid="return-other" onClick={again}>
            <Search aria-hidden className="size-4" />
            {t('pharmacy.cashier.return.other')}
          </button>
        </p>
        {blocked ? (
          <Note look="ph" icon={<Lock aria-hidden />} tone="danger" role="status" testId="return-window">
            {t('pharmacy.returns.fail.RETURN_WINDOW_PASSED', { days: found.window.days })}
          </Note>
        ) : !found.returnable ? (
          <Note look="ph" icon={<Lock aria-hidden />} role="status" testId="nothing-to-return">
            {t('pharmacy.returns.fail.NOTHING_TO_RETURN')}
          </Note>
        ) : (
          <ReturnWorkspace data={found} shiftOk={shiftCurrency === found.currency} onDone={setDone} />
        )}
        {note}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void find(event)}>
        <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm font-semibold text-ph-text">
          {t('pharmacy.cashier.return.number')}
          <FieldInput className={PH_FIELD} dir="ltr" autoComplete="off" inputMode="text" maxLength={40} value={text} data-testid="return-number" onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="submit" className={PH_PRIMARY} data-testid="return-find" disabled={busy || saleNumberOf(text) === ''}>
          {busy ? <Hourglass aria-hidden className="size-4" /> : <Search aria-hidden className="size-4" />}
          {t('pharmacy.cashier.return.find')}
        </button>
      </form>
      {notFound !== null && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="status" testId="return-notfound">
          {t('pharmacy.cashier.return.notFound', { number: notFound })}
        </Note>
      )}
      {problem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="return-problem">
          {problem}
        </Note>
      )}
      <button type="button" className={PH_BTN} aria-expanded={noSale} data-testid="return-nosale" onClick={() => setNoSale((on) => !on)}>
        <Undo2 aria-hidden className="size-4" />
        {t('pharmacy.cashier.return.noSale')}
      </button>
      {noSale && (
        <Note look="ph" icon={<Lock aria-hidden />} role="status" testId="return-nosale-note">
          <span>
            {t('pharmacy.cashier.return.noSaleNote')}{' '}
            <Link href="/pharmacy/sales" className="font-medium underline underline-offset-2">
              {t('pharmacy.nav.sales')}
            </Link>
          </span>
        </Note>
      )}
      {note}
    </div>
  );
}

/**
 * The finished return and its slip: the server's rendering of the stored return, printed once by itself on the workstation's
 * thermal printer with the drawer OFF (a return never opens it), else by the browser from the frame.
 */
function ReturnSlip({ result, onAgain }: { result: ReturnResult; onAgain: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  const [slip, setSlip] = useState<ReceiptResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const workstation = useThermal();
  const thermal = useThermalJob(workstation);
  const { run } = thermal;
  const printed = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void settle(() => returnSlip({ returnId: result.id, width: '80', locale })).then((answer) => {
      if (cancelled) return;
      if (answer.ok) setSlip(answer.data as ReceiptResult);
      else setProblem(phMessage(t, locale, answer.error, 'pharmacy.returns'));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the slip is read once per return
  }, [result.id, locale]);
  useEffect(() => {
    if (!slip || !thermal.enabled || printed.current) return;
    printed.current = true;
    void run(slip.model, { drawer: false });
  }, [slip, thermal.enabled, run]);
  const print = () => {
    if (thermal.enabled && slip) return void run(slip.model, { drawer: false });
    frame.current?.contentWindow?.print();
  };
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="return-slip">
      <Note look="ph" icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="return-done">
        {t(result.replayed ? 'pharmacy.returns.done.replayed' : 'pharmacy.returns.done.title')} · <Num>{result.number ?? ''}</Num> · {t('pharmacy.returns.refund')}{' '}
        <Num>{formatMinor(BigInt(result.refundMinor), result.currency)}</Num> {result.currency}
      </Note>
      <p className="text-xs text-ph-muted">{t('pharmacy.returns.done.quarantine')}</p>
      {problem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert">
          {problem}
        </Note>
      )}
      {slip && <iframe ref={frame} title={t('pharmacy.cashier.return.slip')} sandbox="allow-same-origin allow-modals" srcDoc={slip.html} className="h-48 w-full rounded-ph-xl border border-ph-line bg-white" />}
      <ThermalNote state={thermal.state} look="ph" />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={PH_BTN} data-testid="return-print" disabled={!slip || thermal.state === 'printing'} onClick={print}>
          <Printer aria-hidden className="size-4" />
          {t('pharmacy.cashier.return.print')}
        </button>
        <button type="button" className={PH_PRIMARY} data-testid="return-again" onClick={onAgain}>
          <Undo2 aria-hidden className="size-4" />
          {t('pharmacy.cashier.return.again')}
        </button>
      </div>
    </div>
  );
}
