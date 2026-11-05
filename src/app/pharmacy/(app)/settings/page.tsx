import { ChevronRight, Lock, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { PharmacySettings } from '@/app/pharmacy/_ui/PharmacySettings';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { get as getControlled } from '@/server/pharmacy/queries/controlled-settings';
import { get as getCredit } from '@/server/pharmacy/queries/credit-settings';
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
  const [controlled, credit] = await Promise.all([query(getControlled, access.placeInput), query(getCredit, access.placeInput)]);
  const writable = access.writable('settings.manage');
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.settings.title')} description={t('pharmacy.settings.intro')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {owner && !writable.ok && <WriteBlocked writable={writable} scope="sales" />}
        <nav aria-labelledby="set-print-h" className="flex min-w-0 max-w-2xl flex-col gap-2" data-testid="settings-print-links">
          <h2 id="set-print-h" className="text-lg font-semibold text-text">
            {t('pharmacy.print.settings.title')}
          </h2>
          <Link href="/pharmacy/print/settings" data-testid="settings-link-print" className="flex min-h-14 min-w-0 items-center gap-3 rounded-md border border-line bg-surface px-4 py-2 hover:bg-canvas">
            <Printer aria-hidden className="size-5 shrink-0 text-muted" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold text-text">{t('pharmacy.settings.links.print')}</span>
              <span className="text-sm text-muted">{t('pharmacy.settings.links.printHint')}</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted rtl:rotate-180" />
          </Link>
        </nav>
        <PharmacySettings
          initial={{ controlledEnabled: controlled.controlledEnabled, controlledMaxQty: controlled.controlledMaxQty, rxRetentionDays: controlled.rxRetentionDays, creditEnabled: credit.creditEnabled, version: controlled.version }}
          editable={owner && writable.ok}
        />
      </div>
    </>
  );
}
