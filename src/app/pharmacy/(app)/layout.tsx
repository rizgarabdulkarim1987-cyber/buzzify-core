import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getPhAccess, getPhPlaces } from '@/server/pharmacy/actor';
import { phEntry } from '@/server/pharmacy/entry';
import { getStudioTranslator } from '@/studio/messages';
import { Shell } from '@/app/pharmacy/_ui/Shell';
import { StateNotice } from '@/app/pharmacy/_ui/StateNotice';

/**
 * Every pharmacy screen sits in this frame. Nobody signed in goes to the shared sign-in; a person with no pharmacy gets a
 * 404; a person whose place cookie names no place they may use now (none chosen, edited, or no longer theirs) goes to the
 * picker. A closed pharmacy shows its reason instead of the screen; a read-only one shows the screen under a notice.
 */
export default async function PharmacyAppLayout({ children }: { children: ReactNode }) {
  const access = await getPhAccess();
  if (access.signedIn && !access.place) {
    if ((await getPhPlaces()).length === 0) notFound();
    redirect('/pharmacy/select');
  }
  const entry = phEntry(access);
  if (entry.kind === 'signIn') redirect(entry.to);
  if (entry.kind === 'notFound' || !access.actor || !access.place) notFound();

  const t = getStudioTranslator(access.actor.locale);
  const { branchName } = access.place;
  if (entry.kind === 'closed') {
    return (
      <Shell actor={access.actor} branchName={branchName} t={t}>
        <StateNotice kind="closed" reason={entry.reason} t={t} />
      </Shell>
    );
  }
  const notice = entry.kind === 'readOnly' ? <StateNotice kind="readOnly" until={entry.until} t={t} /> : null;
  return (
    <Shell actor={access.actor} branchName={branchName} notice={notice} t={t}>
      {children}
    </Shell>
  );
}
