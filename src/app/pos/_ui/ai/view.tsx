import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { formatNumber, ltr } from '@/lib/pos-format';
import type { Translate } from '@/lib/i18n';
import { EmptyState } from '@/studio/ui/EmptyState';

/** What an AI page shows while the package is off: nothing to use, no disabled buttons, one line on how to get it. */
export function AiOff({ t, showPackageLink }: { t: Translate; showPackageLink: boolean }) {
  return (
    <div className="px-8 pb-8">
      <EmptyState
        icon={<Sparkles aria-hidden />}
        title={t('pos.ai.off.title')}
        body={t('pos.ai.off.body')}
        action={
          showPackageLink ? (
            <Link href="/pos/ai/package" className="inline-flex min-h-12 items-center text-base underline underline-offset-2">
              {t('pos.ai.off.packageLink')}
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}

/** "12 of 50 requests used this month", with a bar that is never the only carrier of the number. */
export function UsageMeter({ t, used, limit }: { t: Translate; used: number; limit: number }) {
  const share = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <p className="text-sm text-text">{t('pos.ai.usage', { used: ltr(formatNumber(used)), limit: ltr(formatNumber(limit)) })}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-ink" style={{ inlineSize: `${share}%` }} />
      </div>
      <p className="text-sm text-muted">{t('pos.ai.usage.hint')}</p>
    </div>
  );
}
