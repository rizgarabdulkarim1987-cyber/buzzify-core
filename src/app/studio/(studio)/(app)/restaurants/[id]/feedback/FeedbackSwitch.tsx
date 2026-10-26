'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setMenuFeedback } from '@/app/studio/_actions/feedback';
import { useT } from '@/studio/i18n';
import { useRefuse } from '@/studio/refuse';
import { isolated } from '@/studio/ui/isolate';
import { Switch } from '@/studio/ui/Switch';

/** One menu's box, on or off at once: a menu's guests read the switch live, so nothing is published. */
export function FeedbackSwitch({ menuId, name, enabled }: { menuId: string; name: string; enabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const refuse = useRefuse();
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();

  return (
    <label className="flex items-center justify-between gap-6 rounded-lg border border-line px-4 py-3">
      <span className="min-w-0 text-sm">{isolated(t('feedback.switchLabel', { menu: '{menu}' }), { menu: name })}</span>
      <Switch
        aria-label={t('feedback.switchLabel', { menu: name })}
        checked={on}
        disabled={pending}
        onCheckedChange={(next) => {
          setOn(next);
          start(async () => {
            const result = await setMenuFeedback({ menuId, enabled: next });
            if (!result.ok) {
              setOn(!next);
              toast.error(refuse(result).message ?? '');
              return;
            }
            toast.success(t('feedback.saved'));
            router.refresh();
          });
        }}
      />
    </label>
  );
}
