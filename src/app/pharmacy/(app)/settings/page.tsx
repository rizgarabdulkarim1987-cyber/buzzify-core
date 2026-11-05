import { ChevronRight, ClipboardCheck, Lock, Printer, Stethoscope } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { PharmacySettings } from '@/app/pharmacy/_ui/PharmacySettings';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { get as getControlled } from '@/server/pharmacy/queries/controlled-settings';
import { get as getCredit } from '@/server/pharmacy/queries/credit-settings';
import { get as getRate } from '@/server/pharmacy/queries/exchange-rate';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.settings.title') };
}

/**
 * Pharmacy settings. The owner (`settings.manage`) changes them; a branch manager reads them and sees no control that writes.
 * Everyone else gets the blocked state and nothing is fetched.
 */
export default async function SettingsPage() {
  const g = await phGate({ permission: 'catalog.view', titleKey: 'pharmacy.settings.title', testid: 'settings-forbidden', messages: 'pharmacy.settings' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const owner = roleMay(access.actor, 'settings.manage');
  const manager = access.actor.role === 'BRANCH_MANAGER';
  if (!owner && !manager) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.settings.title')} />
        <div data-testid="settings-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.settings.forbidden.title')} body={t(access.actor.role === null ? 'pharmacy.settings.forbidden.support' : 'pharmacy.settings.forbidden.role')} />
        </div>
      </>
    );
  }
  const [controlled, credit, rate] = await Promise.all([query(getControlled, access.placeInput), query(getCredit, access.placeInput), query(getRate, access.placeInput)]);
  const writable = access.writable('settings.manage');
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.settings.title')} description={t('pharmacy.settings.intro')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {owner && !writable.ok && <WriteBlocked writable={writable} scope="sales" />}
        {roleMay(access.actor, 'staff.manage') && (
          <nav aria-labelledby="set-doctor-h" className="flex min-w-0 max-w-2xl flex-col gap-2" data-testid="settings-doctor-links">
            <h2 id="set-doctor-h" className="text-lg font-semibold text-text">
              {t('pharmacy.settings.links.title')}
            </h2>
            <ul className="flex min-w-0 flex-col divide-y divide-ph-line rounded-[22px] bg-ph-card px-4">
              {[
                { href: '/pharmacy/settings/staff', icon: <Stethoscope aria-hidden className="size-5 shrink-0 text-ph-g6" />, title: 'pharmacy.settings.links.staff', hint: 'pharmacy.settings.links.staffHint', testid: 'settings-link-staff', show: true },
                { href: '/pharmacy/settings/doctor-review', icon: <ClipboardCheck aria-hidden className="size-5 shrink-0 text-ph-g6" />, title: 'pharmacy.settings.links.review', hint: 'pharmacy.settings.links.reviewHint', testid: 'settings-link-review', show: roleMay(access.actor, 'catalog.manage') },
              ]
                .filter((link) => link.show)
                .map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} data-testid={link.testid} className="flex min-h-14 min-w-0 items-center gap-3 py-2 hover:bg-ph-canvas">
                      {link.icon}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-semibold text-ph-text">{t(link.title)}</span>
                        <span className="text-sm text-ph-muted">{t(link.hint)}</span>
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-ph-muted rtl:rotate-180" />
                    </Link>
                  </li>
                ))}
            </ul>
          </nav>
        )}
        <nav aria-labelledby="set-print-h" className="flex min-w-0 max-w-2xl flex-col gap-2" data-testid="settings-print-links">
          <h2 id="set-print-h" className="text-lg font-semibold text-text">
            {t('pharmacy.print.settings.title')}
          </h2>
          <Link href="/pharmacy/print/settings" data-testid="settings-link-print" className="flex min-h-14 min-w-0 items-center gap-3 rounded-[22px] bg-ph-card px-4 py-2 hover:bg-ph-canvas">
            <Printer aria-hidden className="size-5 shrink-0 text-ph-g6" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold text-ph-text">{t('pharmacy.settings.links.print')}</span>
              <span className="text-sm text-ph-muted">{t('pharmacy.settings.links.printHint')}</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-ph-muted rtl:rotate-180" />
          </Link>
        </nav>
        <PharmacySettings
          initial={{ controlledEnabled: controlled.controlledEnabled, controlledMaxQty: controlled.controlledMaxQty, rxRetentionDays: controlled.rxRetentionDays, creditEnabled: credit.creditEnabled, usdRate: rate.usdRate, version: controlled.version }}
          editable={owner && writable.ok}
        />
      </div>
    </>
  );
}
