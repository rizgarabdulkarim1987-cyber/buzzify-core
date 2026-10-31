import { MapPinOff } from 'lucide-react';
import Link from 'next/link';
import type { Translate } from '@/lib/i18n';

/**
 * Shown instead of a pre-filled draft when the accepted assistant suggestion belongs to another branch than the one the person works in now.
 * Nothing is filled in; switching branch is the person's deliberate act (the branch picker).
 */
export function OtherBranchNotice({ t }: { t: Translate }) {
  return (
    <p data-testid="assistant-other-branch" className="mx-4 mb-3 flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text sm:mx-8">
      <MapPinOff aria-hidden className="mt-px size-4 shrink-0 text-muted" />
      <span className="min-w-0">
        {t('pharmacy.assistant.otherBranchNotice')}{' '}
        <Link href="/pharmacy/select" className="inline-flex min-h-11 items-center underline underline-offset-2">
          {t('pharmacy.assistant.otherBranchLink')}
        </Link>
      </span>
    </p>
  );
}
