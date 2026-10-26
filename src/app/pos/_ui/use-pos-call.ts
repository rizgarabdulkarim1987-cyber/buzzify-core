'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';

/**
 * Runs a till action from a screen: one at a time, the page re-read when it is done, and a refusal said in the person's
 * language. A refusal of a stale order or total reloads the page too, so the cashier sees what changed instead of retrying
 * the same numbers.
 */
export function usePosCall() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const call = useCallback(
    async <T,>(action: () => Promise<ActionResult<T>>, options: { onOk?: (data: T) => void; quiet?: boolean; keepPage?: boolean } = {}): Promise<ActionResult<T>> => {
      setBusy(true);
      const result = await settle(action);
      setBusy(false);
      if (result.ok) {
        options.onOk?.(result.data);
        if (!options.keepPage) startRefresh(() => router.refresh());
      } else {
        if (!options.quiet) toast.error(describeFailure(t, locale, result.error).message);
        if (result.error.code === 'CONFLICT') startRefresh(() => router.refresh());
      }
      return result;
    },
    [locale, router, t],
  );

  return { call, pending: busy || refreshing };
}
