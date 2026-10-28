'use client';

import { Check, ImageOff, Search } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { listMedia } from '@/app/studio/_actions/media';
import type { MediaRow } from '@/server/studio/services/media';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { Input } from '@/studio/ui/Input';

export interface PickedMedia {
  assetId: string;
  thumbUrl: string;
}

export interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The restaurant whose library is shown, with the shared library beside it; null shows the shared library alone (a Super Admin's). */
  restaurantId: string | null;
  /** What the library lists: pictures by default; `all` adds videos, for a background that may move. */
  kinds?: 'pictures' | 'all';
  onPick: (items: PickedMedia[]) => void;
}

/**
 * Pictures from the media library (spec 11): the restaurant's own and the shared ones, newest first, searchable by alt
 * text and file name. Several can be picked at once; they are added in the order they were picked.
 */
export function MediaPicker({ open, onOpenChange, restaurantId, kinds = 'pictures', onPick }: MediaPickerProps) {
  const t = useT();
  const { locale } = useLocale();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<PickedMedia[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  // Each opening and each search starts from the first page.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      startLoading(async () => {
        const result = await listMedia({ ...(restaurantId ? { restaurantId } : {}), kinds, page: 1, ...(query.trim() ? { q: query.trim() } : {}) });
        if (!result.ok) {
          setProblem(describeFailure(t, locale, result.error).message);
          return;
        }
        setProblem(null);
        setRows(result.data.rows);
        setTotal(result.data.total);
        setPage(1);
      });
    }, 200);
    return () => clearTimeout(timer);
    // Only a new opening, search or library starts over; the translator is read when a refusal is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, restaurantId, kinds]);

  const more = () =>
    startLoading(async () => {
      const result = await listMedia({ ...(restaurantId ? { restaurantId } : {}), kinds, page: page + 1, ...(query.trim() ? { q: query.trim() } : {}) });
      if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
      setRows((current) => [...current, ...result.data.rows]);
      setPage(page + 1);
    });

  const toggle = (row: MediaRow) =>
    setPicked((current) =>
      current.some((entry) => entry.assetId === row.id) ? current.filter((entry) => entry.assetId !== row.id) : [...current, { assetId: row.id, thumbUrl: row.thumbUrl }],
    );

  const close = (next: boolean) => {
    if (!next) setPicked([]);
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('media.picker.title')}
      description={t('media.picker.intro')}
      width="md"
      footer={
        <>
          <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={picked.length === 0}
            onClick={() => {
              onPick(picked);
              close(false);
            }}
          >
            {picked.length === 0 ? t('media.picker.addNone') : t('media.picker.add', { count: picked.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('media.picker.search')}
            placeholder={t('media.picker.search')}
            className="ps-8"
          />
        </div>
        {problem && (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        )}
        {rows.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ImageOff aria-hidden className="size-5 text-muted" />
            <p className="text-sm text-muted">{query.trim() ? t('media.picker.noMatch') : t('media.picker.empty')}</p>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy={loading}>
            {rows.map((row, index) => {
              const order = picked.findIndex((entry) => entry.assetId === row.id);
              const alt = row.alt[locale] || row.alt.en || Object.values(row.alt)[0] || '';
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-pressed={order >= 0}
                    aria-label={alt || t('media.picker.untitled', { n: index + 1 })}
                    onClick={() => toggle(row)}
                    className={cx(
                      'group relative block aspect-square w-full overflow-hidden rounded-md border bg-surface transition-colors',
                      order >= 0 ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- library thumbnails come from storage, already sized */}
                    <img src={row.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
                    {order >= 0 && (
                      <span className="absolute end-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-ink text-on-ink">
                        <Check aria-hidden className="size-3.5" />
                      </span>
                    )}
                    {row.shared && (
                      <span className="absolute bottom-1.5 start-1.5 rounded-sm bg-raised/90 px-1 text-xs text-muted">{t('media.picker.shared')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length < total && (
          <div className="flex justify-center">
            <Button size="sm" variant="ghost" onClick={more} disabled={loading}>
              {t('media.picker.more')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
