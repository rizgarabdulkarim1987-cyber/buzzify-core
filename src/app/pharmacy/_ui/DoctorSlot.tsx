import { ArrowRight, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import { DoctorPanel, DoctorSheet } from './DoctorPanel';

/**
 * Where the AI Doctor appears on Home and on Sell. It draws nothing for a person without access (`enabled` is the layout's
 * `doctorEnabledThisRequest`: the plan's AI budget, the role and the owner's switch) and nothing on Sell without a branch.
 *  - `home`: the green card that opens the full page (/pharmacy/doctor);
 *  - `sell`: the side panel (the Sell screen's start-side column, shown from `lg:`), adding straight into the cart (`cart-bridge`);
 *  - `sell-phone`: the floating button and bottom sheet below `lg:`.
 */
export function DoctorSlot({ where, enabled, branchId, t }: { where: 'home' | 'sell' | 'sell-phone'; enabled: boolean; branchId: string | null; t: Translate }) {
  if (!enabled) return null;
  if (where === 'home') {
    return (
      <section data-testid="home-doctor" aria-labelledby="home-doctor-title" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[22px] bg-ph-g9 p-5 text-ph-on-green">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-ph-xl bg-ph-g8 [&_svg]:size-6">
          <Stethoscope />
        </span>
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <h2 id="home-doctor-title" className="text-lg font-bold">
            {t('pharmacy.doctor.title')}
          </h2>
          <p className="text-sm text-ph-on-green-muted">{t('pharmacy.doctor.home.body')}</p>
        </div>
        <Link href="/pharmacy/doctor" className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-ph-2xl bg-ph-card px-5 text-base font-bold text-ph-g8 hover:bg-ph-g1">
          {t('pharmacy.doctor.home.open')}
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
        </Link>
      </section>
    );
  }
  if (!branchId) return null;
  return where === 'sell' ? <DoctorPanel branchId={branchId} addMode="bridge" /> : <DoctorSheet branchId={branchId} />;
}
