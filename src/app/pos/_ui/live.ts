'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** The page re-read every few seconds while it is visible, and as soon as the person comes back to it. */
export function useLiveRefresh(everyMs: number) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [everyMs, router]);
}

/**
 * A clock that moves every half minute, so the time rings and the minutes keep going between refreshes. It starts at the
 * moment the server read the data (`start`), so the first client render matches the server's HTML.
 */
export function useNow(start: number, everyMs = 30_000): number {
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
