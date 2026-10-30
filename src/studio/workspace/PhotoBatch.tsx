'use client';

import { Images } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { attachPhotos } from '@/app/studio/_actions/content';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { uploadMedia } from '@/studio/media/upload';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';

/** What `content.attachPhotos` takes in one call. */
const MAX_PHOTOS_PER_CALL = 50;
const PARALLEL = 3;
const ACCEPT = 'image/jpeg,image/png,image/webp';

interface Outcome {
  attached: number;
  kept: number;
  unmatched: string[];
  failed: string[];
}

/**
 * Pictures for many dishes at once: the person picks a folder's worth of photos named after the dishes' addresses, each
 * is uploaded to the media library, and then matched to its dish by name (`content.attachPhotos`).
 */
export function PhotoBatch({ menuId, restaurantId }: { menuId: string; restaurantId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [replace, setReplace] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const run = async () => {
    setOutcome(null);
    setDone(0);
    const uploaded: Array<{ fileName: string; assetId: string }> = [];
    const failed: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const file = files[next++]!;
        const result = await uploadMedia(file, { restaurantId }, { folder: 'dishes' });
        if (result.ok) uploaded.push({ fileName: file.name, assetId: result.data.assetId });
        else failed.push(file.name);
        setDone((count) => (count ?? 0) + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));

    const total: Outcome = { attached: 0, kept: 0, unmatched: [], failed };
    for (let at = 0; at < uploaded.length; at += MAX_PHOTOS_PER_CALL) {
      const result = await attachPhotos({ menuId, photos: uploaded.slice(at, at + MAX_PHOTOS_PER_CALL), replace });
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        break;
      }
      total.attached += result.data.attached.length;
      total.kept += result.data.kept.length;
      total.unmatched.push(...result.data.unmatched);
    }
    setDone(null);
    setOutcome(total);
    setFiles([]);
    router.refresh();
  };

  const busy = done !== null;
  return (
    <div className="flex flex-col gap-3">
      <input
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT}
        disabled={busy}
        onChange={(event) => {
          setFiles(Array.from(event.target.files ?? []));
          setOutcome(null);
        }}
        className="block w-full text-sm file:me-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-surface file:px-4"
      />
      <Checkbox checked={replace} onChange={(event) => setReplace(event.target.checked)} disabled={busy} label={t('data.photos.replace')} />
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<Images aria-hidden />} onClick={() => void run()} disabled={busy || files.length === 0}>
          {t('data.photos.start', { n: files.length })}
        </Button>
        {busy && (
          <progress aria-label={t('data.photos.progress')} value={done} max={files.length} className="h-2 w-48" />
        )}
      </div>
      {outcome && (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p>{t('data.photos.result', { attached: outcome.attached, kept: outcome.kept })}</p>
          {outcome.unmatched.length > 0 && <p className="text-muted">{t('data.photos.unmatched', { names: outcome.unmatched.join(', ') })}</p>}
          {outcome.failed.length > 0 && <p className="text-danger">{t('data.photos.failed', { names: outcome.failed.join(', ') })}</p>}
        </div>
      )}
    </div>
  );
}
