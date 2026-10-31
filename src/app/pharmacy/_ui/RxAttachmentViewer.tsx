'use client';

import { CircleAlert, FileText, Hourglass, Image as ImageIcon, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/studio/i18n';
import { Note, Num, TOUCH_BTN } from './sell-parts';

export interface RxFileRow {
  id: string;
  mime: string;
  sizeBytes: number;
}

const isImage = (mime: string) => mime.startsWith('image/');

/**
 * A prescription's files. The list (id, kind, size) is metadata. The BYTES are fetched only when the person asks to see a file,
 * only through the gated route, and only when they hold `rx.attachment.view`: without it nothing is requested at all and the
 * state says so in words. The route checks the permission again on every read, audits it, and answers with no-store headers; the
 * file is shown from a temporary in-memory link that is released when another file is opened or this view is left.
 */
export function RxAttachmentViewer({ files, allowed, restaurantId, branchId }: { files: RxFileRow[]; allowed: boolean; restaurantId: string; branchId: string | null }) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [shown, setShown] = useState<{ id: string; url: string; mime: string } | null>(null);
  const held = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (held.current) URL.revokeObjectURL(held.current);
    },
    [],
  );

  if (!allowed) {
    return (
      <p data-testid="rx-attachments-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
        <Lock aria-hidden className="text-muted" />
        <span className="min-w-0">{t('pharmacy.rx.view.blocked')}</span>
      </p>
    );
  }
  if (files.length === 0) {
    return (
      <p data-testid="rx-attachments-none" className="flex items-center gap-2.5 py-2 text-sm text-muted">
        <FileText aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.rx.view.none')}
      </p>
    );
  }

  const show = async (file: RxFileRow) => {
    setOpenId(file.id);
    setState('loading');
    if (held.current) URL.revokeObjectURL(held.current);
    held.current = null;
    setShown(null);
    try {
      const query = new URLSearchParams({ restaurantId, ...(branchId ? { branchId } : {}) });
      const response = await fetch(`/api/pharmacy/rx-attachments/${encodeURIComponent(file.id)}?${query.toString()}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      held.current = url;
      setShown({ id: file.id, url, mime: blob.type || file.mime });
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="rx-attachments">
      <ul className="flex flex-col gap-2" aria-label={t('pharmacy.rx.view.files')}>
        {files.map((f, i) => (
          <li key={f.id} data-testid="rx-file-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line px-3 py-2 text-sm">
            {isImage(f.mime) ? <ImageIcon aria-hidden className="size-4 shrink-0" /> : <FileText aria-hidden className="size-4 shrink-0" />}
            <span className="font-medium text-text">{t('pharmacy.rx.view.file', { n: i + 1, kind: t(isImage(f.mime) ? 'pharmacy.rx.file.kind.image' : 'pharmacy.rx.file.kind.pdf') })}</span>
            <span className="text-muted">
              <Num>{(f.sizeBytes / 1024 / 1024).toFixed(2)}</Num> MB
            </span>
            <button type="button" className={`${TOUCH_BTN} ms-auto`} data-testid="rx-file-show" aria-pressed={openId === f.id} onClick={() => void show(f)}>
              {t('pharmacy.rx.view.show')}
            </button>
          </li>
        ))}
      </ul>
      {state === 'loading' && (
        <Note icon={<Hourglass aria-hidden />} role="status">
          {t('pharmacy.rx.view.loading')}
        </Note>
      )}
      {state === 'failed' && (
        <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="rx-view-failed">
          {t('pharmacy.rx.view.failed')}
        </Note>
      )}
      {shown && isImage(shown.mime) && (
        // eslint-disable-next-line @next/next/no-img-element -- a private in-memory blob: next/image cannot load it
        <img src={shown.url} alt={t('pharmacy.rx.view.alt')} data-testid="rx-image" className="max-h-[70vh] w-full max-w-full rounded-md border border-line object-contain" />
      )}
      {shown && !isImage(shown.mime) && (
        <a href={shown.url} target="_blank" rel="noopener noreferrer" data-testid="rx-pdf-link" className={`${TOUCH_BTN} w-fit`}>
          <FileText aria-hidden className="size-4" />
          {t('pharmacy.rx.view.openPdf')}
        </a>
      )}
    </div>
  );
}
