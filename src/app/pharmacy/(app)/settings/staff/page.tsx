import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { Note } from '@/app/pharmacy/_ui/sell-parts';
import { StaffDoctorList } from '@/app/pharmacy/_ui/StaffDoctorList';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import type { StaffDoctorList as StaffDoctorData } from '@/server/pharmacy/staff-doctor';
import { list } from '@/server/pharmacy/queries/staff';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.staffDoctor.title') };
}

/**
 * Who may use the AI Doctor (plan Task 9): the people of the pharmacy with their role, branches and switch. Anyone without
 * `staff.manage` gets a 404 before anything is read. A branch manager sees their branches' people with the switches read-only;
 * only the owner flips them (the action checks it again).
 */
export default async function StaffDoctorPage() {
  const g = await phGate({ permission: 'staff.manage', titleKey: 'pharmacy.staffDoctor.title', backTo: { href: '/pharmacy/settings', labelKey: 'pharmacy.staffDoctor.back' }, testid: 'staff-forbidden', messages: 'pharmacy.settings' });
  if (!g.may) notFound();
  const { access, t, back } = g;
  const data = (await query(list, access.placeInput)) as StaffDoctorData;
  const writable = access.writable('staff.manage');
  const editable = data.canEdit && writable.ok;
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.staffDoctor.title')} description={t('pharmacy.staffDoctor.intro')} above={back} />
      <div className="flex min-w-0 max-w-3xl flex-col gap-4 px-4 pb-10 sm:px-8">
        {data.canEdit && !writable.ok && <WriteBlocked writable={writable} scope="sales" />}
        {!data.canEdit && (
          <Note look="ph" icon={<Info aria-hidden />} tone="info" role="status" testId="staff-owner-only">
            {t('pharmacy.staffDoctor.ownerOnly')}
          </Note>
        )}
        {!data.inPlan && (
          <Note look="ph" icon={<Info aria-hidden />} tone="info" testId="staff-not-in-plan">
            {t('pharmacy.staffDoctor.notInPlan')}
          </Note>
        )}
        <StaffDoctorList rows={data.rows} editable={editable} />
      </div>
    </>
  );
}
