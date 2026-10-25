import { notFound } from 'next/navigation';
import { aiVisibility } from '@/server/domain/pos/ai';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posAiState } from '@/server/studio/queries/pos-ai';
import { getStudioTranslator } from '@/studio/messages';

export type AiSection = 'ask' | 'summary' | 'alerts' | 'supply' | 'complaints' | 'package';

const SECTIONS = [
  { key: 'ask', href: '/pos/ai' },
  { key: 'summary', href: '/pos/ai/summary' },
  { key: 'alerts', href: '/pos/ai/alerts' },
  { key: 'supply', href: '/pos/ai/supply' },
  { key: 'complaints', href: '/pos/ai/complaints' },
  { key: 'package', href: '/pos/ai/package' },
] as const;

/**
 * What every AI page starts with. A role without the permission of a section gets the 404 page (the nav never lists it); a
 * role with it, while the package is off, gets `off: true` and shows the calm "not switched on" state instead of the data.
 * Only the package page exists in both states, for the people who manage settings.
 */
export async function aiPage(section: AiSection) {
  const { actor } = await getPosAccess();
  if (!actor) notFound();
  const may = aiVisibility(actor.role, true);
  const allowed = { ask: may.ask, summary: may.summary, alerts: may.alerts, supply: may.supplyEntry, complaints: may.complaintLabels, package: may.packagePage }[section];
  if (!allowed) notFound();
  const state = await query(posAiState, {});
  const shown = aiVisibility(actor.role, state.enabled);
  const visible = { ask: shown.ask, summary: shown.summary, alerts: shown.alerts, supply: shown.supplyEntry, complaints: shown.complaintLabels, package: shown.packagePage };
  const t = getStudioTranslator(actor.locale);
  return {
    actor,
    t,
    state,
    off: !state.enabled && section !== 'package',
    tabs: SECTIONS.filter((s) => visible[s.key]).map((s) => ({ key: s.key, href: s.href, label: t(`pos.ai.tab.${s.key}`) })),
    mayOpenPackage: may.packagePage,
  };
}
