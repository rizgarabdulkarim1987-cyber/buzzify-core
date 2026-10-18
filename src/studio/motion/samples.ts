import type { Translate } from '@/lib/i18n';
import { resolveParams } from '@/motion/params';
import type { MotionMeta, MotionParams } from '@/motion/types';

/**
 * A motion's parameters as the Studio first shows them: the defaults, with text parameters in the Studio's language
 * ("طازج كل صباح" on an Arabic page), so a designer sees how a typography motion handles their own script.
 */
export function studioDefaults(meta: MotionMeta, t: Translate): MotionParams {
  const given: MotionParams = {};
  for (const [key, spec] of Object.entries(meta.params)) {
    if (spec.type === 'text' && spec.sample) given[key] = t(`motion.sample.${spec.sample}`);
  }
  return resolveParams(meta, given);
}
