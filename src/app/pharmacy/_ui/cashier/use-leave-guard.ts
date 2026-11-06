'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The old sale screen's in-app leave guard: while a receipt has lines, a plain left click on a link to another page of this site is
 * stopped and the screen asks first (inline, never a dialog); Leave goes there, Stay stays. A new tab, a modified click and a link
 * to this same page pass. Closing or reloading the tab is the `beforeunload` guard (use-stored-receipts).
 */
export function useLeaveGuard(guard: boolean): { leaveTo: string | null; stay: () => void; go: () => void } {
  const router = useRouter();
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useEffect(() => {
    if (!guard) return;
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.origin !== window.location.origin || anchor.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTo(anchor.pathname + anchor.search);
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, [guard]);
  return {
    leaveTo: guard ? leaveTo : null,
    stay: () => setLeaveTo(null),
    go: () => {
      if (leaveTo) router.push(leaveTo);
      setLeaveTo(null);
    },
  };
}
