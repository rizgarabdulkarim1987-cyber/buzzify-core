'use client';

import { Trash2 } from 'lucide-react';
import type { Locale } from '@/lib/locale';
import { MAX_SLICES } from '@/server/domain/wheel';
import type { LocaleTexts } from '@/server/studio/services/about';
import type { WheelCandidate } from '@/server/studio/services/wheel';
import { useT } from '@/studio/i18n';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { isRtl } from '../content/shared';

export interface SliceDraft {
  productId: string;
  label: LocaleTexts;
  weight: string;
}

/** The dishes on the wheel: each with its photo, a weight (and the chance it gives), an optional prize line per language, and a way to remove it. */
export function SlicePicker({
  slices,
  candidates,
  locales,
  onChange,
  error,
}: {
  slices: SliceDraft[];
  candidates: WheelCandidate[];
  locales: Locale[];
  onChange: (next: SliceDraft[]) => void;
  error?: string | undefined;
}) {
  const t = useT();
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const chosen = new Set(slices.map((slice) => slice.productId));
  const free = candidates.filter((candidate) => !chosen.has(candidate.id));
  const total = slices.reduce((sum, slice) => sum + (Number.isInteger(Number(slice.weight)) && Number(slice.weight) > 0 ? Number(slice.weight) : 0), 0);
  const change = (index: number, patch: Partial<SliceDraft>) => onChange(slices.map((slice, at) => (at === index ? { ...slice, ...patch } : slice)));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('wheelPage.count', { count: slices.length })}</p>
      {candidates.length === 0 && <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-muted">{t('wheelPage.noCandidates')}</p>}
      <ul className="flex flex-col gap-3">
        {slices.map((slice, index) => {
          const candidate = byId.get(slice.productId);
          const name = candidate?.name ?? slice.productId;
          const weight = Number(slice.weight);
          const percent = total > 0 && Number.isInteger(weight) && weight > 0 ? Math.round((weight / total) * 100) : 0;
          return (
            <li key={slice.productId} className="flex flex-col gap-3 rounded-md border border-line p-3">
              <div className="flex items-center gap-3">
                {candidate?.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a library thumbnail
                  <img src={candidate.thumb} alt="" className="size-14 shrink-0 rounded-md border border-line object-cover" />
                ) : (
                  <span aria-hidden className="size-14 shrink-0 rounded-md border border-dashed border-line-strong" />
                )}
                <span className="min-w-0 flex-1 break-words text-sm font-medium text-text">{name}</span>
                <IconButton size="sm" icon={<Trash2 aria-hidden />} label={t('wheelPage.remove', { name })} onClick={() => onChange(slices.filter((_, at) => at !== index))} />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex w-28 flex-col gap-1 text-sm text-muted">
                  {t('wheelPage.weight')}
                  <Input type="number" inputMode="numeric" min={1} max={100} step={1} value={slice.weight} onChange={(event) => change(index, { weight: event.target.value })} />
                </label>
                <span className="pb-2 text-sm text-muted">{t('wheelPage.chance', { percent })}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {locales.map((code) => (
                  <label key={code} className="flex flex-col gap-1 text-sm text-muted">
                    {t('wheelPage.label', { language: t(`menus.language.${code}`) })}
                    <Input
                      value={slice.label[code] ?? ''}
                      maxLength={60}
                      lang={code}
                      dir={isRtl(code) ? 'rtl' : 'ltr'}
                      onChange={(event) => change(index, { label: { ...slice.label, [code]: event.target.value } })}
                    />
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {slices.length < MAX_SLICES && free.length > 0 && (
        <Select
          aria-label={t('wheelPage.add')}
          value=""
          options={[{ value: '', label: `${t('wheelPage.add')}…` }, ...free.map((candidate) => ({ value: candidate.id, label: candidate.name }))]}
          onChange={(event) => {
            if (event.target.value) onChange([...slices, { productId: event.target.value, label: {}, weight: '1' }]);
          }}
        />
      )}
      <p className="text-sm text-muted">{t('wheelPage.publishNote')}</p>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
