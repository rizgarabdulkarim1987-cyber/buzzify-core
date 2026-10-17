'use client';

import { CircleAlert, ImageIcon, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import type { MediaRow } from '@/server/studio/services/media';
import { describeFailure } from '@/studio/errors';
import { formatBytes } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { FilterBar, SearchFilter, useFilterParams } from '@/studio/ui/FilterBar';
import { IconButton } from '@/studio/ui/IconButton';
import { Pagination } from '@/studio/ui/Pagination';
import { Select } from '@/studio/ui/Select';
import { DropZone } from './DropZone';
import { MediaDetails } from './MediaDetails';
import { MediaGrid } from './MediaGrid';
import { uploadMedia } from './upload';

export interface MediaLibraryProps {
  /** The library shown: a restaurant's (its own pictures), or the shared one (null). */
  restaurantId: string | null;
  /** Whether the person may upload, change and delete here. */
  editable: boolean;
  /** The libraries the person may switch to (the Media page), by `library` parameter value; empty on a restaurant's tab. */
  libraries: ReadonlyArray<{ value: string; label: string }>;
  selectedLibrary?: string;
  list: { rows: MediaRow[]; folders: string[]; tags: string[]; total: number; storageBytes: number };
  page: number;
  pageSize: number;
}

interface Upload {
  id: number;
  name: string;
  /** From 0 to 1 while sending; 1 when finished. */
  progress: number;
  problem?: string;
}

const FILTER_PARAMS = ['q', 'folder', 'tag'] as const;

/**
 * A media library (spec 11): its pictures newest first, found by folder, tag or search; several files dropped or
 * picked at once, each with its progress or the reason it was refused; and the chosen picture's details beside the grid.
 * New uploads go into the folder being looked at.
 */
export function MediaLibrary({ restaurantId, editable, libraries, selectedLibrary, list, page, pageSize }: MediaLibraryProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const inputId = useId();
  const { params, set } = useFilterParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const counter = useRef(0);
  const folder = params.get('folder') ?? '';
  const tag = params.get('tag') ?? '';
  const filtered = FILTER_PARAMS.some((name) => params.get(name));
  const selected = list.rows.find((row) => row.id === selectedId) ?? null;

  const upload = async (files: File[]) => {
    const started = files.map((file) => ({ id: ++counter.current, name: file.name, progress: 0 }));
    setUploads((current) => [...current.filter((entry) => entry.progress < 1 || entry.problem), ...started]);
    const update = (id: number, change: Partial<Upload>) => setUploads((current) => current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
    let stored = 0;
    for (const [index, file] of files.entries()) {
      const { id } = started[index]!;
      const result = await uploadMedia(file, restaurantId ? { restaurantId } : { shared: true }, { folder, onProgress: (progress) => update(id, { progress: Math.min(progress, 0.95) }) });
      if (result.ok) {
        stored += 1;
        update(id, { progress: 1 });
      } else update(id, { progress: 1, problem: describeFailure(t, locale, result.error).message });
    }
    if (stored > 0) router.refresh();
    // Finished uploads leave the list after a moment; refusals stay until dismissed, so their reasons can be read.
    setTimeout(() => setUploads((current) => current.filter((entry) => entry.problem || entry.progress < 1 || !started.some((item) => item.id === entry.id))), 2500);
  };

  return (
    <div className="flex flex-col gap-4 px-8 pb-10 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar params={FILTER_PARAMS}>
          {libraries.length > 1 && (
            <Field label={t('media.library.library')} hideLabel className="w-56">
              <Select value={selectedLibrary} onChange={(event) => set({ library: event.target.value, folder: null, tag: null, q: null })} options={[...libraries]} />
            </Field>
          )}
          <SearchFilter placeholder={t('media.library.search')} label={t('media.library.searchLabel')} className="w-60" />
          {list.folders.length > 0 && (
            <Field label={t('media.library.folder')} hideLabel className="w-44">
              <Select
                value={folder}
                onChange={(event) => set({ folder: event.target.value || null })}
                options={[{ value: '', label: t('media.library.allFolders') }, ...list.folders.map((name) => ({ value: name, label: name }))]}
              />
            </Field>
          )}
          {list.tags.length > 0 && (
            <Field label={t('media.library.tag')} hideLabel className="w-40">
              <Select
                value={tag}
                onChange={(event) => set({ tag: event.target.value || null })}
                options={[{ value: '', label: t('media.library.allTags') }, ...list.tags.map((name) => ({ value: name, label: name }))]}
              />
            </Field>
          )}
        </FilterBar>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{t('media.library.storage', { size: formatBytes(list.storageBytes, locale) })}</span>
          {editable && (
            <>
              <label htmlFor={inputId} className={cx(buttonClasses('primary'), 'cursor-pointer has-[:focus-visible]:outline-2')}>
                <Upload aria-hidden />
                {t('media.library.uploadButton')}
              </label>
              <input
                id={inputId}
                type="file"
                multiple
                aria-label={t('media.library.upload')}
                accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml,image/x-icon,.ico"
                className="sr-only"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = '';
                  if (files.length > 0) void upload(files);
                }}
              />
            </>
          )}
        </div>
      </div>

      {uploads.length > 0 && (
        <ul aria-label={t('media.library.uploads')} className="flex flex-col divide-y divide-line rounded-lg border border-line bg-raised">
          {uploads.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div role="status" className="flex min-w-0 flex-1 items-center gap-3">
                {entry.problem ? <CircleAlert aria-hidden className="size-4 shrink-0 text-danger" /> : <Upload aria-hidden className="size-4 shrink-0 text-muted" />}
                <span dir="auto" className="min-w-0 max-w-64 truncate text-text">
                  {entry.name}
                </span>
                {entry.problem ? (
                  <span className="min-w-0 flex-1 text-danger">{entry.problem}</span>
                ) : (
                  <span className="flex flex-1 items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
                      <span className="block h-full rounded-full bg-ink transition-[width] duration-200 ease-out" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
                    </span>
                    <span className="w-20 text-muted">{entry.progress >= 1 ? t('media.library.uploaded') : t('media.library.uploading')}</span>
                  </span>
                )}
              </div>
              {entry.problem && (
                <IconButton label={t('media.library.dismiss')} size="sm" icon={<X aria-hidden />} onClick={() => setUploads((current) => current.filter((item) => item.id !== entry.id))} />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={cx('grid items-start gap-6', selected && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
        <DropZone onFiles={(files) => void upload(files)} label={t('media.library.drop')} disabled={!editable} className="min-h-48">
          {list.rows.length === 0 ? (
            <EmptyState
              icon={<ImageIcon aria-hidden />}
              title={filtered ? t('media.library.noMatch') : t('media.library.emptyTitle')}
              body={filtered ? undefined : editable ? t('media.library.emptyBody') : t('media.library.emptyReadOnly')}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <MediaGrid rows={list.rows} selectedId={selected?.id ?? null} onSelect={(id) => setSelectedId((current) => (current === id ? null : id))} />
              <Pagination page={page} pageSize={pageSize} total={list.total} />
            </div>
          )}
        </DropZone>
        {selected && (
          <div className="lg:sticky lg:top-4">
            <MediaDetails key={selected.id} row={selected} restaurantId={restaurantId} editable={editable} folders={list.folders} onDeleted={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
