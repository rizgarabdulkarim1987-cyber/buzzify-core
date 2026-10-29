'use client';

import { FileText, Image as ImageIcon, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState } from 'react';
import { intakeFileUrl } from '@/app/pharmacy/_actions/intake';
import { formatNumber } from '@/lib/pos-format';
import { useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Select } from '@/studio/ui/Select';
import { zoomStep } from './intake-review-logic';
import { Message } from './intake-review-parts';

export interface OriginalFocus {
  fileId: string;
  page: number;
  lineNo: number;
}

export interface IntakeOriginalProps {
  files: Array<{ id: string; status: string; mediaType: string; pages: number }>;
  /** The line the person asked to see on the original. */
  focus: OriginalFocus | null;
  online: boolean;
}

type Loaded = { url: string; at: number };

/**
 * The invoice as it was sent, beside the lines. The picture is asked for (a signed link, five minutes) only when the person
 * presses the button, one file at a time, and again when the link has run out. Zoom is by size buttons, not by gesture, inside
 * a box that scrolls on its own so the page never does. A line asked for names itself ("Row 3 · page 1") because the model
 * gives no coordinates to draw a box on. No motion.
 */
export function IntakeOriginal({ files, focus, online }: IntakeOriginalProps) {
  const t = useT();
  const shown = files.filter((f) => f.status !== 'PURGED' && f.status !== 'REJECTED_QUALITY');
  const [fileId, setFileId] = useState<string | null>(shown[0]?.id ?? null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | 'expired'>('idle');
  const retried = useRef(new Set<string>());

  /** Asks for the signed link; nothing is set before the answer, so an effect may call it. */
  const fetchUrl = async (id: string) => {
    const result = await settle(() => intakeFileUrl({ fileId: id }));
    if (!result.ok) {
      setState('failed');
      return;
    }
    setLoaded((l) => ({ ...l, [id]: { url: (result.data as { url: string }).url, at: Date.now() } }));
    setState('idle');
  };
  const load = async (id: string) => {
    setState('loading');
    await fetchUrl(id);
  };

  // A line asked for on the original: its file and page (adjusted while rendering, not in an effect), A link that has run out is asked for again when the picture fails to open, or by the button.
  const [seen, setSeen] = useState<OriginalFocus | null>(null);
  if (focus !== seen) {
    setSeen(focus);
    if (focus) {
      setFileId(focus.fileId);
      setPage(focus.page);
    }
  }

  const file = shown.find((f) => f.id === fileId) ?? shown[0] ?? null;
  const held = file ? loaded[file.id] : undefined;
  const isPdf = file?.mediaType === 'application/pdf';
  const pageCount = Math.max(1, file?.pages ?? 1);

  return (
    <section aria-labelledby="intake-original-title" data-testid="intake-original" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
      <h3 id="intake-original-title" className="text-md font-semibold text-text">
        {t('pharmacy.intake.rv.original.title')}
      </h3>
      {focus && (
        <p data-testid="original-row-label" className="inline-flex w-fit items-center rounded-sm border border-line-strong bg-raised px-2 py-1 text-sm font-medium text-text">
          {t('pharmacy.intake.rv.original.rowLabel', { n: formatNumber(focus.lineNo), page: formatNumber(focus.page) })}
        </p>
      )}
      {shown.length === 0 || !file ? (
        <Message tone="info">{t('pharmacy.intake.rv.noFileOriginal')}</Message>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {shown.length > 1 && (
              <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
                {t('pharmacy.intake.rv.original.file')}
                <Select
                  size="lg"
                  className="min-h-11"
                  data-testid="original-file"
                  value={file.id}
                  onChange={(e) => {
                    setFileId(e.target.value);
                    setPage(1);
                  }}
                  options={shown.map((f, i) => ({ value: f.id, label: t('pharmacy.intake.fileN', { n: formatNumber(i + 1) }) }))}
                />
              </label>
            )}
            {isPdf && pageCount > 1 && (
              <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
                {t('pharmacy.intake.rv.original.page')}
                <Select
                  size="lg"
                  className="min-h-11"
                  data-testid="original-page"
                  value={String(Math.min(page, pageCount))}
                  onChange={(e) => setPage(Number(e.target.value))}
                  options={Array.from({ length: pageCount }, (_, i) => ({ value: String(i + 1), label: formatNumber(i + 1) }))}
                />
              </label>
            )}
            {held && (
              <Button size="lg" className="min-h-11" icon={<RefreshCw aria-hidden />} data-testid="original-reload" disabled={!online || state === 'loading'} onClick={() => void load(file.id)}>
                {t('pharmacy.intake.rv.original.reload')}
              </Button>
            )}
            {held && !isPdf && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('pharmacy.intake.rv.original.zoom', { percent: formatNumber(zoom) })}>
                <Button size="lg" className="min-h-11" icon={<ZoomOut aria-hidden />} data-testid="original-zoom-out" onClick={() => setZoom((z) => zoomStep(z, 'out'))}>
                  {t('pharmacy.intake.rv.original.zoomOut')}
                </Button>
                <Button size="lg" className="min-h-11" icon={<ZoomIn aria-hidden />} data-testid="original-zoom-in" onClick={() => setZoom((z) => zoomStep(z, 'in'))}>
                  {t('pharmacy.intake.rv.original.zoomIn')}
                </Button>
                <span data-testid="original-zoom" className="text-sm tabular-nums text-muted">
                  {t('pharmacy.intake.rv.original.zoom', { percent: formatNumber(zoom) })}
                </span>
              </div>
            )}
          </div>
          {!held ? (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-sm text-muted">{t('pharmacy.intake.rv.original.hint')}</p>
              <Button size="lg" className="min-h-11 w-fit" icon={isPdf ? <FileText aria-hidden /> : <ImageIcon aria-hidden />} data-testid="original-load" disabled={!online || state === 'loading'} onClick={() => void load(file.id)}>
                {state === 'loading' ? t('pharmacy.intake.reading') : t('pharmacy.intake.showPicture')}
              </Button>
            </div>
          ) : (
            <div
              role="region"
              tabIndex={0}
              aria-label={t('pharmacy.intake.rv.original.title')}
              data-testid="original-box"
              className="max-h-[70vh] min-h-48 overflow-auto rounded-md border border-line bg-raised"
            >
              {isPdf ? (
                <object key={`${file.id}-${page}`} data={`${held.url}#page=${Math.min(page, pageCount)}`} type="application/pdf" aria-label={t('pharmacy.intake.pictureAlt', { n: formatNumber(shown.indexOf(file) + 1) })} className="h-[70vh] w-full">
                  <a href={held.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 p-3 text-sm font-medium text-text underline">
                    <FileText aria-hidden className="size-4" />
                    {t('pharmacy.intake.openPdf')}
                  </a>
                </object>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private file: not an optimisable asset
                <img
                  src={held.url}
                  alt={t('pharmacy.intake.pictureAlt', { n: formatNumber(shown.indexOf(file) + 1) })}
                  style={{ width: `${zoom}%`, maxWidth: 'none' }}
                  className="block h-auto"
                  onError={() => {
                    // The link ran out (or never opened): ask once more for a fresh one, then say so.
                    if (retried.current.has(file.id)) {
                      setState('expired');
                      return;
                    }
                    retried.current.add(file.id);
                    void load(file.id);
                  }}
                />
              )}
            </div>
          )}
          {state === 'failed' && <Message tone="error">{t('pharmacy.intake.pictureFailed')}</Message>}
          {state === 'expired' && <Message tone="error" testId="original-expired">{t('pharmacy.intake.rv.original.expired')}</Message>}
        </>
      )}
    </section>
  );
}
