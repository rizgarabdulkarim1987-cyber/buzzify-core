import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { searchString, withPublicMenu, type SearchParams } from '@/server/public-page';
import { complaintGate } from '@/server/pos/complaints-guest';
import { ComplaintForm } from './ComplaintForm';
import { COMPLAINT_TITLE } from './words';

const TABLE_NUMBER = /^\d{1,3}$/;

// A form for one table at one moment: never cached, never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; locale: string; table: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const raw = await params;
  return withPublicMenu(raw, `/t/${encodeURIComponent(raw.table)}/complaint`, searchString(await searchParams), async (route) => {
    if (!TABLE_NUMBER.test(raw.table)) notFound();
    const number = Number(raw.table);
    const gate = await complaintGate(getPrisma(), route.tenant, number);
    if (!gate.open) notFound();
    const words = COMPLAINT_TITLE(route.locale, number);
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            <span dir="auto">{route.tenant.name}</span> · {words.table}
          </p>
          <h1 className="font-display text-3xl text-text">{words.title}</h1>
          <p className="text-base text-muted">{words.intro}</p>
        </header>
        <ComplaintForm slug={route.tenant.slug} table={number} locale={route.locale} />
      </main>
    );
  });
}
