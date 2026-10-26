import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { tillNav } from '@/server/domain/pos/nav';
import { getPosAccess } from '@/server/pos/actor';
import { currentDevice } from '@/server/pos/device-session';
import { posEntry } from '@/server/pos/entry';
import { canPos } from '@/server/domain/pos/permissions';
import { query } from '@/server/studio/framework/invoke';
import { posAiState } from '@/server/studio/queries/pos-ai';
import { posComplaintBadge } from '@/server/studio/queries/pos-complaints';
import { posQrFlags } from '@/server/studio/queries/pos-requests';
import { getStudioTranslator } from '@/studio/messages';
import { SwitchUserButton } from '@/app/pos/_ui/SwitchUserButton';
import { TillNav } from '@/app/pos/_ui/TillNav';
import { OfflineRedirect } from '@/app/pos/_ui/sync/OfflineRedirect';
import { RegisterSw } from '@/app/pos/_ui/sync/RegisterSw';
import { SyncIndicator } from '@/app/pos/_ui/sync/SyncIndicator';

/**
 * Every till page sits in this frame. Nobody signed in goes to the shared sign-in, a person with no till gets a 404, and a
 * closed gate (restaurant not active, or no live Cashier subscription) shows the reason page instead of the till.
 */
export default async function TillLayout({ children }: { children: ReactNode }) {
  const entry = posEntry(await getPosAccess());
  if (entry.kind === 'signIn') redirect(entry.to);
  if (entry.kind === 'notFound') notFound();
  if (entry.kind === 'inactive') redirect('/pos/inactive');

  const t = getStudioTranslator(entry.actor.locale);
  const sharedDevice = (await currentDevice())?.restaurantId === entry.actor.restaurantId;
  const flags = canPos(entry.actor.role, 'order.handle') ? await query(posQrFlags, {}) : { qrOrdering: false, delivery: false, pendingRequests: 0 };
  const complaints = canPos(entry.actor.role, 'complaint.view') ? await query(posComplaintBadge, {}) : { show: false, count: 0 };
  const ai = canPos(entry.actor.role, 'report.view') ? await query(posAiState, {}) : { enabled: false };
  const items = tillNav(entry.actor.role, { qrOrdering: flags.qrOrdering, delivery: flags.delivery, complaints: complaints.show, ai: ai.enabled }).map((item) => ({ ...item, badge: item.key === 'requests' ? flags.pendingRequests : item.key === 'complaints' ? complaints.count : 0 }));
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <header className="print:hidden flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-8">
        <Link href="/pos" className="text-base font-semibold text-text">
          {t('pos.shell.label')}
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted">
          <SyncIndicator />
          <span>
            {entry.actor.name} · {t(`pos.role.${entry.actor.role}`)}
          </span>
          <Link href="/pos/pin" className="underline underline-offset-2">
            {t('pos.pin.title')}
          </Link>
          {sharedDevice ? <SwitchUserButton /> : null}
          <Link href="/studio/account" className="underline underline-offset-2">
            {t('pos.shell.account')}
          </Link>
        </div>
      </header>
      <RegisterSw />
      <OfflineRedirect />
      <TillNav items={items} />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
