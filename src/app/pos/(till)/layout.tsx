import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { tillNav } from '@/server/domain/pos/nav';
import { getPosAccess } from '@/server/pos/actor';
import { getPrisma } from '@/server/data/prisma';
import { posEntry } from '@/server/pos/entry';
import { readQrFlags } from '@/server/pos/qr-sheet';
import { getStudioTranslator } from '@/studio/messages';
import { TillNav } from '@/app/pos/_ui/TillNav';

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
  const flags = await readQrFlags(getPrisma(), entry.actor.restaurantId);
  const items = tillNav(entry.actor.role, { qrOrdering: flags.qrOrdering }).map((item) => ({ ...item, badge: item.key === 'requests' ? flags.pendingRequests : 0 }));
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
          <span>
            {entry.actor.name} · {t(`pos.role.${entry.actor.role}`)}
          </span>
          <Link href="/studio/account" className="underline underline-offset-2">
            {t('pos.shell.account')}
          </Link>
        </div>
      </header>
      <TillNav items={items} />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
