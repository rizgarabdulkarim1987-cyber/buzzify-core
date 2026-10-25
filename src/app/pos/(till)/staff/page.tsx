import type { Metadata } from 'next';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posStaff } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RolesMatrix } from '@/app/pos/_ui/RolesMatrix';
import { AddStaffForm, StaffList } from './StaffForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.staff.title') };
}

/** Who works the till. A role without `staff.manage` gets the 404 page. */
export default async function PosStaffPage() {
  const [people, access, locale] = await Promise.all([query(posStaff, {}), getPosAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  return (
    <>
      <PageHeader title={t('pos.staff.title')} description={t('pos.staff.intro')} />
      <div className="flex flex-col gap-8 px-8 pb-8">
        <StaffList people={people} ownRole={access.actor?.role ?? 'CASHIER'} ownUserId={access.actor?.userId ?? ''} />
        <AddStaffForm ownRole={access.actor?.role ?? 'CASHIER'} />
        <RolesMatrix />
      </div>
    </>
  );
}
