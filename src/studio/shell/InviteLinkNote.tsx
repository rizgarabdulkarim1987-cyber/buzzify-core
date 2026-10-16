'use client';

import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';
import { Input } from '@/studio/ui/Input';
import { isolated } from '@/studio/ui/isolate';

/** An invitation that was just made or renewed: who it is for, and its link. */
export interface IssuedInvitation {
  email: string;
  url: string;
}

/**
 * An invitation's link, shown once: it is stored nowhere, so this is the only time it can be copied. The person who made
 * the invitation can send it another way than the email.
 */
export function InviteLinkNote({ issued, onDismiss }: { issued: IssuedInvitation; onDismiss: () => void }) {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-text">{isolated(t('restaurants.people.linkTitle'), { email: issued.email })}</p>
        <p className="max-w-[64ch] text-sm text-muted">{t('restaurants.people.linkBody')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          dir="ltr"
          value={issued.url}
          aria-label={t('restaurants.people.linkLabel')}
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton value={issued.url} size="md" variant="secondary" />
      </div>
      <Button variant="ghost" size="sm" className="self-start" onClick={onDismiss}>
        {t('restaurants.people.linkDismiss')}
      </Button>
    </div>
  );
}
