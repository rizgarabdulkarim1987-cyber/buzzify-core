import type { Locale } from '@/lib/locale';
import type { Translate } from '@/lib/i18n';
import type { StudioFailure } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';

/**
 * A refusal in words, with what to do next. The server sends a code in `fields.phCode` for the refusals that have a next
 * step (a stale count, someone else counting, a second person needed, ...). When the catalog has a sentence for that code
 * (`<prefix>.fail.<CODE>`) it is shown, with the product and lot filled in from the line the server named; anything else
 * goes through `describeFailure`, which is translated for known sentences and general in Arabic and Sorani.
 */
export function phMessage(
  t: Translate,
  locale: Locale,
  failure: StudioFailure,
  prefix: 'pharmacy.counts' | 'pharmacy.expiry',
  lineOf?: (lineId: string) => { product: string; lot: string } | undefined,
): string {
  const code = failure.fields?.phCode;
  if (code) {
    const key = `${prefix}.fail.${code}`;
    const line = failure.fields?.lineId ? lineOf?.(failure.fields.lineId) : undefined;
    const text = t(key, {
      product: line?.product ?? '',
      lot: line?.lot ?? '',
      have: failure.fields?.have ?? '0',
      difference: failure.fields?.difference ?? '',
    });
    if (text !== key) return text;
  }
  return describeFailure(t, locale, failure).message;
}
