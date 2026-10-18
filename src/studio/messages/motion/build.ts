import type { Messages } from '@/lib/i18n';

/**
 * The Motion area's messages are long (a name and a line for each of 150 motions), so each language keeps them in its
 * own file under `motion/` and the main catalogs spread them in. `motions` maps a motion's id to its name and line.
 */
export function motionMessages(chrome: Messages, motions: Record<string, readonly [name: string, description: string]>): Messages {
  const out: Messages = { ...chrome };
  for (const [id, [name, description]] of Object.entries(motions)) {
    out[`motion.${id}.name`] = name;
    out[`motion.${id}.desc`] = description;
  }
  return out;
}
