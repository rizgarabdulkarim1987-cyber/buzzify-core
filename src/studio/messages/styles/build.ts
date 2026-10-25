import type { Messages } from '@/lib/i18n';

/** `styles` maps a style's id to its name and one line; the main catalogs spread the result in. */
export function styleMessages(chrome: Messages, styles: Record<string, readonly [name: string, line: string]>): Messages {
  const out: Messages = { ...chrome };
  for (const [id, [name, line]] of Object.entries(styles)) {
    out[`styles.${id}.name`] = name;
    out[`styles.${id}.line`] = line;
  }
  return out;
}
