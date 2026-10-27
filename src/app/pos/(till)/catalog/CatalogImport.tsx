'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { posImportApply, posImportDiscard, posImportPreview } from '@/app/studio/_actions/pos';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { AiMenuImport } from '@/studio/workspace/AiMenuImport';

interface Shown {
  importJobId: string;
  summary: { new: number; changed: number; unchanged: number; invalid: number };
}

/**
 * Brings in a product list from the cashier's old CSV. The file is read in the browser and sent as text; the server turns
 * it into the Studio's menu sheet and previews it. Nothing is written until the preview is applied.
 */
export function CatalogImport() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(0);

  function fail(error: Parameters<typeof describeFailure>[2]) {
    const lines = error.fields?.rows;
    setProblem([describeFailure(t, locale, error).message, lines ? t('pos.import.rows', { lines }) : null].filter(Boolean).join(' '));
  }

  async function show() {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    setShown(null);
    const result = await settle(async () => posImportPreview({ fileName: file.name, csv: await file.text() }));
    setBusy(false);
    if (result.ok) setShown({ importJobId: result.data.importJobId, summary: result.data.preview.summary });
    else fail(result.error);
  }

  async function finish(apply: boolean) {
    if (!shown) return;
    setBusy(true);
    const result = await settle<unknown>(() => (apply ? posImportApply({ importJobId: shown.importJobId }) : posImportDiscard({ importJobId: shown.importJobId })));
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    setShown(null);
    setFile(null);
    setSkipped(0);
    if (apply) toast.success(t('pos.import.done'));
    router.refresh();
  }

  return (
    <section aria-labelledby="pos-import" className="flex max-w-xl flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="pos-import" className="text-base font-semibold text-text">
          {t('pos.import.title')}
        </h2>
        <p className="text-sm text-muted">{t('pos.import.intro')}</p>
      </div>
      {!shown && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
          <h3 className="text-base font-semibold text-text">{t('ai.menu.title')}</h3>
          <AiMenuImport
            endpoint="/api/pos/ai/menu-import"
            onRead={(reading) => {
              setProblem(null);
              setSkipped(reading.skipped);
              setShown({ importJobId: reading.importJobId, summary: reading.preview.summary });
            }}
          />
        </div>
      )}
      <Field label={t('pos.import.file')}>
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setShown(null);
            setProblem(null);
          }}
        />
      </Field>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      {shown ? (
        <>
          <p className="text-base text-text">{t('pos.import.summary', shown.summary)}</p>
          {skipped > 0 && <p className="text-sm text-muted">{t('ai.menu.skipped', { count: skipped })}</p>}
          <div className="flex gap-2">
            <Button pending={busy} disabled={shown.summary.invalid > 0} onClick={() => void finish(true)}>
              {t('pos.import.apply')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void finish(false)}>
              {t('pos.import.discard')}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" pending={busy} disabled={!file} onClick={() => void show()} className="self-start">
          {t('pos.import.preview')}
        </Button>
      )}
    </section>
  );
}
