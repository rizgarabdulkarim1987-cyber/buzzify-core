import { ListChecks } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AssistantWorkspace } from '@/app/pharmacy/_ui/AssistantWorkspace';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { getPhBranches } from '@/server/pharmacy/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.assistant.title') };
}

/**
 * The daily assistant. Every staff role may ask: what comes back depends on what the role may read (a tool it may not use is refused in
 * words). The model is used only with `ai.use` and a budget left; without them the answer is the plain tables. It stays open when the
 * pharmacy is read-only (asking reads); only the suggestions that lead to a draft need an open pharmacy. No patient, customer or
 * prescription data is read or shown here, and nothing typed is kept.
 */
export default async function AssistantPage() {
  const g = await phGate({ permission: 'catalog.view', titleKey: 'pharmacy.assistant.title', testid: 'assistant-forbidden', messages: 'pharmacy.assistant' });
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const all = await getPhBranches(access.actor.restaurantId);
  const branches = all.filter((b) => access.actor.branchIds.includes(b.id));
  const ai = roleMay(access.actor, 'ai.use');
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        title={t('pharmacy.assistant.title')}
        description={t('pharmacy.assistant.intro')}
        actions={
          ai ? (
            <Link href="/pharmacy/assistant/proposals" data-testid="proposals-link" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-text hover:bg-hover">
              <ListChecks aria-hidden className="size-4" />
              {t('pharmacy.assistant.proposals.title')}
            </Link>
          ) : undefined
        }
      />
      <AssistantWorkspace
        branches={branches}
        caps={{ ai, transfer: roleMay(access.actor, 'transfer.manage'), purchase: roleMay(access.actor, 'purchase.manage') }}
        writable={access.writable('ai.use')}
        forecast={roleMay(access.actor, 'report.view')}
      />
    </>
  );
}
