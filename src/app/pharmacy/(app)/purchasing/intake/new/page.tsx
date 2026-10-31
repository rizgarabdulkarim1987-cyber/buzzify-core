import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { IntakeUpload } from '@/app/pharmacy/_ui/IntakeUpload';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../../../catalog/access';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.intake.new') };
}

/**
 * A new batch of invoice pictures in the chosen branch. It needs a role that buys and may use the AI, an open pharmacy and
 * one branch chosen; the others get the reason in words and nothing is fetched or uploaded.
 */
export default async function NewIntakePage() {
  const g = await purchasingGate('pharmacy.intake.new', { href: '/pharmacy/purchasing/intake', labelKey: 'pharmacy.intake.back' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const head = <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.intake.new')} description={t('pharmacy.intake.up.intro')} />;
  const reason = (key: string) => (
    <>
      {head}
      <div className="flex flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <p data-testid="intake-new-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t(key)}</span>
        </p>
      </div>
    </>
  );
  if (!g.writable.ok) {
    return (
      <>
        {head}
        <div className="px-4 pb-10 sm:px-8">{g.writeNotice}</div>
      </>
    );
  }
  if (!roleMay(access.actor, 'ai.use')) return reason('pharmacy.intake.noAi');
  if (access.place.branchId === null) return reason('pharmacy.intake.pickBranch');
  const supplierPage = await query(suppliers, { ...access.placeInput, active: true });
  return (
    <>
      {head}
      <IntakeUpload
        userId={access.actor.userId}
        restaurantId={access.placeInput.restaurantId}
        branchId={access.place.branchId}
        branchName={access.place.branchName ?? ''}
        suppliers={supplierPage.items.map((s) => ({ id: s.id, name: s.name }))}
      />
    </>
  );
}
