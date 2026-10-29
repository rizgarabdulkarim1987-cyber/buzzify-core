'use client';

import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { uploadMedia, type UploadTarget } from '@/studio/media/upload';
import { Button } from '@/studio/ui/Button';

/**
 * A button that sends a picture (or a video, when `accept` allows one) from the computer or phone straight to the media library, then hands
 * back its id. A picture also comes back with a thumbnail made from the file itself; a video has none until it is processed.
 */
export function UploadAsset({
  target,
  accept,
  folder,
  label,
  onUploaded,
}: {
  target: UploadTarget;
  accept: string;
  folder: string;
  label: string;
  onUploaded: (picked: { assetId: string; thumbUrl: string }) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async (file: File) => {
    setProblem(null);
    setProgress(0);
    const result = await uploadMedia(file, target, { onProgress: setProgress, folder });
    setProgress(null);
    if (!result.ok) return setProblem(describeFailure(t, locale, result.error).message);
    onUploaded({ assetId: result.data.assetId, thumbUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' });
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void send(file);
        }}
      />
      <Button disabled={progress !== null} onClick={() => input.current?.click()}>
        <Upload aria-hidden />
        {progress === null ? label : t('introPage.uploading', { percent: Math.round(progress * 100) })}
      </Button>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
