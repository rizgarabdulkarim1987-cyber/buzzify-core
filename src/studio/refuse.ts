'use client';

import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from './errors';
import { useLocale, useT } from './i18n';
import type { ConfirmProblem } from './ui/ConfirmDialog';

/**
 * Turns a refused action into what a confirmation dialog shows, in the person's language: the messages of the fields the
 * dialog has (`fieldNames`) beside those fields, else one sentence for the whole dialog.
 */
export function useRefuse() {
  const t = useT();
  const { locale } = useLocale();
  return (result: Extract<ActionResult<unknown>, { ok: false }>, fieldNames: readonly string[] = []): ConfirmProblem => {
    const described = describeFailure(t, locale, result.error);
    const fields = Object.fromEntries(Object.entries(described.fields).filter(([name]) => fieldNames.includes(name)));
    return Object.keys(fields).length > 0 ? { fields } : { message: described.message };
  };
}
