'use client';

import { Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import type { ImportPreview } from '@/server/domain/import-sheet';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Input } from '@/studio/ui/Input';

export interface AiMenuReading {
  importJobId: string;
  preview: ImportPreview;
  /** Items left out because no price could be read for them. */
  skipped: number;
  /** Pictures found for the items, still to be brought in. */
  photos: number;
  /** The source prints its prices in another currency than the menu uses. */
  currencyMismatch: { source: string; menu: string } | null;
}

const FILE_MAX_BYTES = 5 * 1024 * 1024;
type Answer = { data?: ({ ok: true } & AiMenuReading) | { ok: false; code: string }; error?: { message?: string } };

/**
 * Quick entry with AI, in the Studio and at the till: a photo or PDF of another menu, or a link to its page, sent to the
 * server, which reads it into the usual import preview. Nothing is written here; the caller shows the preview and
 * applies or discards it like any other import.
 */
export function AiMenuImport({ endpoint, onRead }: { endpoint: string; onRead: (reading: AiMenuReading) => void }) {
  const t = useT();
  const fileId = useId();
  const linkId = useId();
  const [fileKey, setFileKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  /** The pictures come in a few per request, so no single request is long. A failure here only leaves items without pictures. */
  async function bringPhotos(reading: AiMenuReading) {
    let left = reading.photos;
    for (let round = 0; left > 0 && round < 60; round += 1) {
      setStatus(t('ai.menu.photos', { count: left }));
      try {
        const response = await fetch(`${endpoint}/photos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ importJobId: reading.importJobId }) });
        const body = (await response.json()) as { data?: { remaining?: number } };
        const remaining = body.data?.remaining;
        if (typeof remaining !== 'number' || remaining >= left) return;
        left = remaining;
      } catch {
        return;
      }
    }
  }

  async function read() {
    if (!file && link.trim() === '') return setError(t('ai.menu.chooseInput'));
    if (file && file.size > FILE_MAX_BYTES) return setError(t('ai.menu.error.tooLarge'));
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (file) form.set('file', file);
    else form.set('url', link.trim());
    try {
      const response = await fetch(endpoint, { method: 'POST', body: form });
      const body = (await response.json()) as Answer;
      if (body.data?.ok) {
        await bringPhotos(body.data);
        onRead(body.data);
      }
      else if (body.data) setError(t(`ai.menu.error.${body.data.code}`));
      else setError(body.error?.message === 'tooLarge' ? t('ai.menu.error.tooLarge') : (body.error?.message ?? t('ai.menu.error.invalid')));
    } catch {
      setError(t('ai.menu.error.aiUnavailable'));
    }
    setStatus(null);
    setBusy(false);
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void read();
      }}
    >
      <p className="text-sm text-muted">{t('ai.menu.intro')}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-sm font-medium text-text">
          {t('ai.menu.file')}
        </label>
        <Input
          key={fileKey}
          id={fileId}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={linkId} className="text-sm font-medium text-text">
          {t('ai.menu.link')}
        </label>
        <Input
          id={linkId}
          type="url"
          dir="ltr"
          inputMode="url"
          placeholder="https://…"
          value={link}
          disabled={file !== null}
          onChange={(event) => {
            setLink(event.target.value);
            setError(null);
          }}
        />
      </div>
      <p className="text-sm text-muted">{t('ai.menu.note')}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" icon={<Sparkles aria-hidden />} pending={busy}>
          {t('ai.menu.read')}
        </Button>
        {busy && (
          <span role="status" className="text-sm text-muted">
            {status ?? t('ai.menu.reading')}
          </span>
        )}
        {file && !busy && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFile(null);
              setFileKey((key) => key + 1);
            }}
          >
            {file.name}
          </Button>
        )}
      </div>
    </form>
  );
}
