import { TEMPLATES } from './index';
import { TEMPLATE_IDS, type TemplateId } from './types';

/**
 * The showpiece templates (spec `2026-10-31-project-2-style-control-design.md`, 3.3): the cinematic presets added after
 * the first thirty, which were sold before this feature and stay free. Basic cannot newly choose one; a menu already on
 * one keeps it. Derived once from the presets' own tags, and a test fails if the first thirty or a business type ever
 * lose their free templates.
 */
const FIRST_FREE = 30;

export const PREMIUM_TEMPLATE_IDS: readonly TemplateId[] = TEMPLATE_IDS.slice(FIRST_FREE).filter((id) => TEMPLATES[id].tags.includes('cinematic'));

const PREMIUM = new Set<TemplateId>(PREMIUM_TEMPLATE_IDS);

export function isPremiumTemplate(id: TemplateId): boolean {
  return PREMIUM.has(id);
}
