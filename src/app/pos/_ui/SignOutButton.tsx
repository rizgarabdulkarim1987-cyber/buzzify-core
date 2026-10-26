'use client';

import { LogOut } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { signOut } from '@/app/studio/_actions/session';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';

/** "Sign out" in the till header, as in the Studio's account menu. */
export function SignOutButton() {
  const t = useT();
  const { locale } = useLocale();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await signOut({});
          if (result.ok) return navigateAway(result.data.next);
          toast.error(describeFailure(t, locale, result.error).message);
        })
      }
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-text hover:bg-hover disabled:opacity-60"
    >
      <LogOut aria-hidden size={18} className="rtl:-scale-x-100" />
      {t('nav.signOut')}
    </button>
  );
}
