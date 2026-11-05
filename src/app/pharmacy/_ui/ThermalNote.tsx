import { CircleAlert, CircleCheck, Hourglass } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Note } from './sell-parts';
import type { ThermalState } from './use-thermal';

/** What happened to the thermal print, in a calm sentence. A failure says the sale is safe and what to check. Nothing for "idle". */
export function ThermalNote({ state, look }: { state: ThermalState; look?: 'ph' }) {
  const t = useT();
  if (state === 'idle') return null;
  const lookProps = look ? { look } : {};
  if (state === 'printing') return <Note {...lookProps} icon={<Hourglass aria-hidden />} role="status" testId="thermal-printing">{t('pharmacy.print.thermal.printing')}</Note>;
  if (state === 'ok') return <Note {...lookProps} icon={<CircleCheck aria-hidden />} tone="success" role="status" testId="thermal-printed">{t('pharmacy.print.thermal.printed')}</Note>;
  return (
    <Note {...lookProps} icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="thermal-failed">
      {t(state === 'printer' ? 'pharmacy.print.thermal.failedPrinter' : 'pharmacy.print.thermal.failedBridge')}
    </Note>
  );
}
