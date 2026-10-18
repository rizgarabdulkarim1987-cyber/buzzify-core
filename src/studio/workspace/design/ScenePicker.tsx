'use client';

import { Box, Check, ImageOff, Sparkles, Upload } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { listMedia } from '@/app/studio/_actions/media';
import type { SceneMedia } from '@/lib/templates/types';
import { sceneFeature, type SceneFileKind } from '@/server/domain/plan-choices';
import { SCENE_MEDIA_KIND } from '@/server/media/kinds';
import type { MediaRow } from '@/server/studio/services/media';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { AssetThumb } from '@/studio/media/AssetThumb';
import { DropZone } from '@/studio/media/DropZone';
import { assetName } from '@/studio/media/MediaGrid';
import { SCENE_ACCEPT, uploadMedia } from '@/studio/media/upload';
import { LockMark, UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';

type Filter = 'all' | 'MODEL' | 'VIDEO' | 'LOTTIE';
const FILTERS: Filter[] = ['all', 'MODEL', 'VIDEO', 'LOTTIE'];

/** The kinds in the order their features stand in the plans' catalog, for the hints under the grid. */
const HINT_ORDER: readonly SceneFileKind[] = ['lottie', 'video', 'model'];

/**
 * Choosing a background file (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 6): the restaurant's scene
 * files and the shared ones, by kind, and a way to upload one here. One is chosen at a time. A file of a kind the
 * restaurant's plan lacks is shown locked and cannot be chosen, with the way to get it under the grid (spec: scene files
 * and plans, 5.1); the stored file stays choosable, since keeping it needs nothing.
 */
export function ScenePicker({
  open,
  onOpenChange,
  restaurantId,
  current,
  stored,
  allowed,
  upgrade,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  /** The file in use, marked in the list. */
  current: string | null;
  /** The file the saved design names, which may be kept whatever the plan. */
  stored: string | null;
  /** The kinds the plan lets the business choose. */
  allowed: readonly SceneFileKind[];
  upgrade: UpgradeInfo;
  onPick: (media: SceneMedia) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [uploading, setUploading] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = (select?: string) =>
    startLoading(async () => {
      const result = await listMedia({ restaurantId, kinds: 'scene', page: 1 });
      if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
      setProblem(null);
      setRows(result.data.rows);
      if (select) setChosen(select);
    });

  // Each opening starts from a fresh list, with the file in use marked until another is chosen.
  useEffect(() => {
    if (!open) return;
    load();
    // Only a new opening reloads; the translator is read when a refusal is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restaurantId]);

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(0);
    const result = await uploadMedia(file, { restaurantId }, { onProgress: (fraction) => setUploading(fraction) });
    setUploading(null);
    if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
    load(result.data.assetId);
  };

  const locked = (row: MediaRow) => row.scene !== null && !allowed.includes(row.scene.kind) && row.id !== stored;
  const selectedId = chosen ?? current;
  const shown = rows.filter((row) => filter === 'all' || row.kind === filter);
  const picked = rows.find((row) => row.id === selectedId && row.scene && !locked(row));
  const lockedKinds = HINT_ORDER.filter((kind) => !allowed.includes(kind));
  const close = (next: boolean) => {
    if (!next) setChosen(null);
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('design.scenePicker.title')}
      description={t('design.scenePicker.intro')}
      width="md"
      footer={
        <>
          <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!picked}
            onClick={() => {
              if (picked?.scene) onPick(picked.scene);
              close(false);
            }}
          >
            {t('design.scenePicker.use')}
          </Button>
        </>
      }
    >
      <DropZone onFiles={(files) => void upload(files)} label={t('design.scenePicker.drop')} disabled={uploading !== null}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t('design.scenePicker.title')} className="flex flex-wrap gap-1">
              {FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    filter === value ? 'border-ink bg-ink text-on-ink' : 'border-line text-text hover:border-line-strong',
                  )}
                >
                  {value !== 'all' && !allowed.includes(SCENE_MEDIA_KIND[value]) && <LockMark feature={sceneFeature(SCENE_MEDIA_KIND[value])} info={upgrade} />}
                  {value === 'all' ? t('design.scenePicker.all') : t(`media.kind.${value}`)}
                </button>
              ))}
            </div>
            <Button size="sm" className="ms-auto" icon={<Upload aria-hidden />} pending={uploading !== null} onClick={() => input.current?.click()}>
              {uploading === null ? t('design.scenePicker.upload') : t('media.library.uploading')}
            </Button>
            <input
              ref={input}
              type="file"
              accept={SCENE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                void upload([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
          </div>
          {problem && (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          )}
          {shown.length === 0 && !loading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <ImageOff aria-hidden className="size-5 text-muted" />
              <p className="text-sm text-muted">{t('design.scenePicker.empty')}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy={loading}>
              {shown.map((row) => {
                const isLocked = locked(row);
                const selected = row.id === selectedId && !isLocked;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={assetName(t, locale, row)}
                      disabled={!row.scene || isLocked}
                      onClick={() => setChosen(row.id)}
                      className={cx(
                        'studio-checker relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border p-1.5 transition-colors',
                        selected ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong',
                        isLocked && 'cursor-not-allowed opacity-50 hover:border-line',
                      )}
                    >
                      <AssetThumb row={row} />
                      {isLocked && row.scene && (
                        <span className="absolute start-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-raised/90">
                          <LockMark feature={sceneFeature(row.scene.kind)} info={upgrade} />
                        </span>
                      )}
                      {selected && (
                        <span className="absolute end-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-ink text-on-ink">
                          <Check aria-hidden className="size-3.5" />
                        </span>
                      )}
                      {row.shared && <span className="absolute end-1.5 bottom-1.5 rounded-sm bg-raised/90 px-1 text-xs text-muted">{t('media.picker.shared')}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {lockedKinds.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              {lockedKinds.map((kind) => (
                <div key={kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-text">{t(`plans.feature.${sceneFeature(kind)}`)}</span>
                  <UpgradeHint feature={sceneFeature(kind)} info={upgrade} />
                </div>
              ))}
            </div>
          )}
        </div>
      </DropZone>
    </Dialog>
  );
}

/** The file in use, small: a video's poster, else the mark of its kind. */
export function SceneFileMark({ media }: { media: SceneMedia }) {
  if (media.kind === 'video') {
    // eslint-disable-next-line @next/next/no-img-element -- the library's own poster rendition
    return <img src={media.poster.url} alt="" className="size-full object-cover" />;
  }
  const Icon = media.kind === 'model' ? Box : Sparkles;
  return <Icon aria-hidden className="size-6 text-muted" strokeWidth={1.5} />;
}
