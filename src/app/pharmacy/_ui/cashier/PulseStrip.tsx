'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { formatMinor, type Currency } from '../sell-logic';
import { Num } from '../sell-parts';
import type { CashierPulse } from './cashier-logic';

const CHIP = 'flex min-h-12 min-w-[110px] flex-col justify-center gap-0.5 rounded-ph-xl border px-3 py-1.5 text-start text-xs';
const VALUE = 'text-[17px] font-bold leading-6 tabular-nums';

function clockNow(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** The time, read after mount (the server's clock would not match the till's) and again every 30 seconds. */
function useClock(): string {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = () => setNow(clockNow());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Chip({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div className={`${CHIP} border-ph-line bg-ph-card text-ph-muted`} data-testid={testId} data-pulse-chip="">
      <span>{label}</span>
      <b className={`${VALUE} text-ph-text`}>{children}</b>
    </div>
  );
}

/** A warning chip: a red button that puts its product's name in the search field; a plain chip while there is nothing to warn about. */
function WarnChip({ label, testId, chip, onFind }: { label: string; testId: string; chip: CashierPulse['nearExpiry']; onFind: (name: string) => void }) {
  const name = chip.firstProductName;
  if (chip.count === 0 || !name) {
    return (
      <Chip label={label} testId={testId}>
        <Num>{chip.count}</Num>
      </Chip>
    );
  }
  return (
    <button type="button" className={`${CHIP} cursor-pointer border-ph-red bg-ph-red-wash text-ph-red`} data-testid={testId} data-pulse-chip="" title={name} onClick={() => onFind(name)}>
      <span>{label}</span>
      <b className={VALUE}>
        <Num>{chip.count}</Num> · <bdi className="font-semibold">{name.split(' ')[0]}</bdi>
      </b>
    </button>
  );
}

/**
 * The header strip: the dollar rate and six live chips (shift sales, receipts done, cash in the drawer, near expiry, low
 * stock, the clock). The two warning chips are red, and clicking one fills the search with that product.
 */
export function PulseStrip({ pulse, currency, onFind }: { pulse: CashierPulse; currency: Currency; onFind: (name: string) => void }) {
  const t = useT();
  const clock = useClock();
  const money = (minor: string) => (
    <>
      <Num>{formatMinor(/^-?\d+$/.test(minor) ? BigInt(minor) : 0n, currency)}</Num> <span className="text-xs font-semibold">{currency}</span>
    </>
  );
  return (
    <div className="flex min-w-0 flex-wrap items-stretch gap-2" role="group" aria-label={t('pharmacy.cashier.pulse.region')} data-testid="pulse">
      <p className="flex min-h-12 items-center rounded-ph-xl bg-ph-amber-wash px-3 text-sm font-bold text-ph-amber-ink" data-testid="pulse-rate">
        <Num>{t('pharmacy.cashier.pulse.rate', { rate: String(pulse.usdRate) })}</Num>
      </p>
      <Chip label={t('pharmacy.cashier.pulse.shiftSales')} testId="pulse-sales">
        {money(pulse.shiftNetMinor)}
      </Chip>
      <Chip label={t('pharmacy.cashier.pulse.receiptsDone')} testId="pulse-receipts">
        <Num>{pulse.receiptsDone}</Num>
      </Chip>
      <Chip label={t('pharmacy.cashier.pulse.drawerCash')} testId="pulse-drawer">
        {money(pulse.drawerCashMinor)}
      </Chip>
      <WarnChip label={t('pharmacy.cashier.pulse.nearExpiry')} testId="pulse-near-expiry" chip={pulse.nearExpiry} onFind={onFind} />
      <WarnChip label={t('pharmacy.cashier.pulse.lowStock')} testId="pulse-low-stock" chip={pulse.lowStock} onFind={onFind} />
      <Chip label={t('pharmacy.cashier.pulse.clock')} testId="pulse-clock">
        <Num>{clock || '--:--'}</Num>
      </Chip>
    </div>
  );
}
