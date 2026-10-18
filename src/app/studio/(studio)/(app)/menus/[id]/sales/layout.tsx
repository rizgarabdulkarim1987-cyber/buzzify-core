import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { getStudioTranslator } from '@/studio/messages';
import { RouteTabs } from '@/studio/ui/RouteTabs';
import { SALES_PAGES } from '@/studio/workspace/sales/pages';

/**
 * The Sales tab (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.4): its own pages under the workspace's
 * tabs, one for each tool, each with its own address.
 */
export default async function SalesLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  const t = getStudioTranslator(actor?.locale ?? 'en');
  const base = `/studio/menus/${id}/sales`;
  const tabs = SALES_PAGES.map((page) => ({ href: `${base}${page.path}`, label: t(page.labelKey), exact: page.path === '' }));
  return (
    <div className="flex max-w-5xl flex-col gap-6 px-4 pb-12 pt-5 sm:px-8">
      <RouteTabs tabs={tabs} label={t('sales.pages')} />
      {children}
    </div>
  );
}
