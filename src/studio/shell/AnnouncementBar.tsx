'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadActiveAnnouncements } from '@/app/studio/_actions/announcements';
import type { ActiveAnnouncement } from '@/lib/announcements';
import { dismissAnnouncement, lastStoredAnnouncements, readDismissed, storeAnnouncements, visibleAnnouncements } from '@/lib/announcement-state';
import { useT } from '@/studio/i18n';

const REFRESH_MS = 60_000;

/**
 * The Buzzify team's announcements, one line under the header: the newest, with "Read all" when there are more or the
 * text is long. Each person dismisses their own on their own device. The list is refreshed every minute and kept for
 * the offline till; nothing here moves or animates, and it sits in the page flow above the content, never over it.
 */
export function AnnouncementBar({ userId, initial }: { userId: string; initial: ActiveAnnouncement[] }) {
  const t = useT();
  const [list, setList] = useState(initial);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Read after mount: the server cannot see this device's storage.
    try {
      const kept = readDismissed(userId, window.localStorage);
      queueMicrotask(() => setDismissed(kept));
    } catch {
      // Storage is not reachable: the bar works for this visit only.
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    setNow(Date.now());
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const result = await loadActiveAnnouncements({});
      if (!result.ok) return;
      setList(result.data);
      storeAnnouncements(userId, result.data, window.localStorage);
    } catch {
      // Offline or the server is away: keep what is shown.
    }
  }, [userId]);

  useEffect(() => {
    storeAnnouncements(userId, initial, window.localStorage);
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
    // `initial` only seeds the first store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refresh]);

  const shown = visibleAnnouncements(list, dismissed, now);
  if (shown.length === 0) return null;
  const [first] = shown;
  const more = shown.length - 1;

  return (
    <section aria-label={t('announcements.bar.label')} className="print:hidden border-b border-line bg-surface px-4 py-2 text-sm text-text sm:px-8">
      <div className="flex items-center gap-3">
        <p className={open ? 'min-w-0 flex-1' : 'min-w-0 flex-1 truncate'}>
          <strong className="font-semibold">{first.title}</strong>
          <span className="text-muted"> · {first.body}</span>
        </p>
        {(more > 0 || first.body.length > 60) && (
          <button type="button" className="shrink-0 underline underline-offset-2" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? t('announcements.bar.hide') : more > 0 ? t('announcements.bar.count', { count: shown.length }) : t('announcements.bar.readAll')}
          </button>
        )}
        <button
          type="button"
          className="shrink-0 underline underline-offset-2"
          onClick={() => setDismissed(dismissAnnouncement(userId, first.id, window.localStorage))}
        >
          {t('announcements.bar.dismiss')}
        </button>
      </div>
      {open && more > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {shown.slice(1).map((item) => (
            <li key={item.id}>
              <strong className="font-semibold">{item.title}</strong>
              <span className="text-muted"> · {item.body}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The offline till page: it has no session, so it shows the list the last person here had, minus what they dismissed. */
export function OfflineAnnouncements() {
  const [last, setLast] = useState<{ userId: string; list: ActiveAnnouncement[] } | null>(null);
  useEffect(() => {
    try {
      const kept = lastStoredAnnouncements(window.localStorage);
      queueMicrotask(() => setLast(kept));
    } catch {
      // Storage is not reachable: nothing to show.
    }
  }, []);
  return last ? <AnnouncementBar userId={last.userId} initial={last.list} /> : null;
}
